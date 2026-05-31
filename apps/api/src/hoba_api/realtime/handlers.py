"""Socket.IO event handlers for `/rooms` namespace.

Every handler is wrapped in `register_handlers(sio)` so the registration
happens once at app import, with clear deps. Per spec §7 events.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any
from urllib.parse import parse_qs

import socketio
import structlog
from sqlalchemy import select

from hoba_api.auth.initdata import (
    InvalidInitData,
    parse_telegram_user,
    validate_init_data,
)
from hoba_api.config import settings
from hoba_api.db import SessionLocal
from hoba_api.models.question import Question
from hoba_api.models.room import Room
from hoba_api.models.segment import Segment
from hoba_api.models.spin import Spin
from hoba_api.models.user import User
from hoba_api.modes import engine_for
from hoba_api.modes.base import SpinContext
from hoba_api.realtime.server import NAMESPACE
from hoba_api.redis_client import (
    cooldown_take,
    presence_remove,
    presence_set,
    presence_user_ids,
    rate_limit_take,
)
from hoba_api.services.participants import join_room, refresh_presence
from hoba_api.services.punishment import (
    all_present_bet,
    approve_punishment,
    drop_bet,
    place_bet,
    reject_punishment,
    reset_game,
    resolve_punishment,
    resolve_turn,
    start_game,
)
from hoba_api.services.room_state import build_room_state
from hoba_api.services.rooms import RoomServiceError, get_room_by_code
from hoba_api.services.spins import (
    advance_turn,
    best_of_n_leaders,
    trigger_spin,
    user_can_spin,
)
from hoba_api.services.users import cache_user_after_commit, resolve_telegram_user

log = structlog.get_logger("hoba_api.realtime")

REACTIONS_PER_WINDOW = settings.reactions_per_window
REACTIONS_WINDOW_SECONDS = settings.reactions_window_seconds
SPIN_ANNOUNCE_DELAY_SECONDS = 0.3
# Per spec §14: 30 spins/room/hour + a 1.5 s per-room cooldown so the
# SPIN hub can't be thumb-mashed. Both keyed by room_id so multiple
# rooms don't share the same throttle.
SPIN_COOLDOWN_MS = 1500
SPIN_RATE_LIMIT_MAX = 30
SPIN_RATE_LIMIT_WINDOW_SECONDS = 3600


def _spin_cooldown_key(room_id: int) -> str:
    return f"cooldown:spin:{room_id}"


def _spin_rate_limit_key(room_id: int) -> str:
    return f"rate:spins:{room_id}"

_background_tasks: set[asyncio.Task[Any]] = set()


def _schedule(coro: Any) -> None:
    """Run a background coroutine without losing its reference (GC)."""
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


def _extract_init_data(
    environ: dict[str, Any], auth: dict[str, Any] | None,
) -> str | None:
    """Pull `initData` from either `auth` (socket.io-client) or query string."""
    if auth and isinstance(auth, dict):
        candidate = auth.get("initData")
        if isinstance(candidate, str) and candidate:
            return candidate
    query_raw = environ.get("QUERY_STRING", "")
    if not isinstance(query_raw, str) or not query_raw:
        return None
    values = parse_qs(query_raw).get("initData", [])
    if values and values[0]:
        first = values[0]
        return first if isinstance(first, str) else None
    return None


async def _authenticate(environ: dict[str, Any], auth: dict[str, Any] | None) -> int | None:
    """Validate initData and upsert the user — returns user_id or None."""
    init_data = _extract_init_data(environ, auth)
    if init_data is None or not settings.telegram_bot_token:
        return None
    try:
        fields = validate_init_data(
            init_data,
            settings.telegram_bot_token,
            max_age_seconds=settings.init_data_max_age_seconds,
        )
        tg_user = parse_telegram_user(fields)
    except InvalidInitData as exc:
        log.info("ws.auth.rejected", code=exc.code)
        return None
    async with SessionLocal() as session:
        user = await resolve_telegram_user(session, tg_user)
        await session.commit()
        await cache_user_after_commit(user)
        return user.id


async def _emit_settled(
    sio: socketio.AsyncServer,
    room_code: str,
    room_id: int,
    spin_id: int,
    result_segment_id: int,
    duration_ms: int,
) -> None:
    await asyncio.sleep(duration_ms / 1000)

    mode_aftereffects: dict[str, Any] = {}
    new_cursor: int | None = None
    advanced = False
    punishment_patch: dict[str, Any] | None = None
    bon_patch: dict[str, Any] | None = None

    async with SessionLocal() as session:
        room = await session.get(Room, room_id)
        if room is not None:
            engine = engine_for(room.game_mode)
            question = (
                await session.execute(
                    select(Question).where(
                        Question.room_id == room.id,
                        Question.is_active.is_(True),
                    ),
                )
            ).scalar_one_or_none()
            if question is not None:
                segments = list(
                    (
                        await session.execute(
                            select(Segment)
                            .where(
                                Segment.parent_id == question.id,
                                Segment.parent_type == "question",
                            )
                            .order_by(Segment.position),
                        )
                    ).scalars().all(),
                )
                winner = next(
                    (s for s in segments if s.id == result_segment_id), None,
                )
                if winner is not None:
                    ctx = SpinContext(room=room, question=question, segments=segments)
                    effects = engine.on_spin_settled(ctx, winner)
                    if effects.eliminate_segment_ids:
                        now = datetime.now(UTC)
                        to_kill = set(effects.eliminate_segment_ids)
                        for seg in segments:
                            if seg.id in to_kill:
                                seg.eliminated_at = now
                        living = [s for s in segments if s.eliminated_at is None]
                        survivor_id = (
                            living[0].id
                            if effects.round_over and len(living) == 1
                            else None
                        )
                        mode_aftereffects = {
                            "eliminated_segment_id": effects.eliminate_segment_ids[0],
                            "remaining": len(living),
                            "round_over": effects.round_over,
                            "survivor_segment_id": survivor_id,
                        }
            if room.game_mode == "punishment":
                host = await session.get(User, room.host_id)
                host_lang = (host.language_code if host is not None else None) or "en"
                spin = await session.get(Spin, spin_id)
                spinner_id = spin.triggered_by if spin is not None else None
                if spinner_id is not None:
                    outcome = await resolve_turn(
                        session, room, spinner_id, result_segment_id, host_lang,
                    )
                    mode_aftereffects = {"punishment_outcome": outcome}
                    punishment_patch = {
                        "punishment_match_counts": room.punishment_match_counts,
                        "punishment_winner_user_id": room.punishment_winner_user_id,
                        "punishment_last_outcome": outcome,
                        "current_turn_user_id": room.current_turn_user_id,
                    }

            # Best-of-N (Classic + Chaos, spin_count > 1): recompute the round from
            # the committed Spin rows rather than incrementing shared
            # counters. _emit_settled runs as overlapping background tasks,
            # so an increment-based count races: a late stale patch (e.g.
            # attempts=4, winner=null) can arrive after the finalizing patch
            # and blank the winner on clients (the "5/5, no winner" bug).
            # Counting committed spins is order-independent — every settle
            # after the Nth spin commits converges to the same result.
            if (
                room.game_mode in ("classic", "chaos")
                and room.spin_count > 1
                and question is not None
            ):
                baseline = room.bon_round_start_spin_id or 0
                round_seg_ids = list(
                    (
                        await session.execute(
                            select(Spin.result_segment_id).where(
                                Spin.question_id == question.id,
                                Spin.id > baseline,
                            ),
                        )
                    ).scalars().all(),
                )
                counts: dict[int, int] = {}
                for seg_id in round_seg_ids:
                    counts[seg_id] = counts.get(seg_id, 0) + 1
                leaders = best_of_n_leaders(counts)
                winner_id = (
                    leaders[0]
                    if len(round_seg_ids) >= room.spin_count and len(leaders) == 1
                    else None
                )
                room.bon_attempts = len(round_seg_ids)
                room.bon_tally = {str(k): v for k, v in counts.items()}
                room.bon_winner_segment_id = winner_id
                bon_patch = {
                    "bon_attempts": room.bon_attempts,
                    "bon_tally": room.bon_tally,
                    "bon_winner_segment_id": winner_id,
                }

            # Punishment runs its own turn logic in resolve_turn (it must NOT
            # advance on an unresolved dare), so only the generic modes advance
            # the cursor here.
            if room.spin_policy == "turn_based" and room.game_mode != "punishment":
                new_cursor = await advance_turn(session, room)
                advanced = True
            await session.commit()

    await sio.emit(
        "spin:settled",
        {
            "spin_id": spin_id,
            "result_segment_id": result_segment_id,
            "mode_aftereffects": mode_aftereffects,
        },
        room=room_code,
        namespace=NAMESPACE,
    )
    if advanced:
        await sio.emit(
            "room:updated",
            {"patch": {"current_turn_user_id": new_cursor}},
            room=room_code,
            namespace=NAMESPACE,
        )
    if punishment_patch is not None:
        await sio.emit(
            "room:updated",
            {"patch": punishment_patch},
            room=room_code,
            namespace=NAMESPACE,
        )
    if bon_patch is not None:
        await sio.emit(
            "room:updated",
            {"patch": bon_patch},
            room=room_code,
            namespace=NAMESPACE,
        )


def register_handlers(sio: socketio.AsyncServer) -> None:
    """Wire every `/rooms` namespace event handler."""

    @sio.on("connect", namespace=NAMESPACE)
    async def on_connect(
        sid: str, environ: dict[str, Any], auth: dict[str, Any] | None,
    ) -> bool:
        user_id = await _authenticate(environ, auth)
        if user_id is None:
            return False  # reject connection
        await sio.save_session(sid, {"user_id": user_id}, namespace=NAMESPACE)
        log.info("ws.connect", sid=sid, user_id=user_id)
        return True

    @sio.on("disconnect", namespace=NAMESPACE)
    async def on_disconnect(sid: str) -> None:
        try:
            sess = await sio.get_session(sid, namespace=NAMESPACE)
        except KeyError:
            return
        user_id = sess.get("user_id")
        room_id = sess.get("room_id")
        room_code = sess.get("room_code")
        if user_id is not None and room_id is not None:
            await presence_remove(room_id, user_id)
            if room_code is not None:
                await sio.emit(
                    "room:participant_left",
                    {"user_id": user_id},
                    room=room_code,
                    namespace=NAMESPACE,
                    skip_sid=sid,
                )
                # Mirror the room:leave drop-on-leave: a player who
                # disconnects mid-prediction must leave the required-guess
                # set so the host's all-locked gate can still resolve.
                async with SessionLocal() as session:
                    room = await session.get(Room, room_id)
                    if (
                        room is not None
                        and room.game_mode == "punishment"
                        and room.status == "lobby"
                        and str(user_id) in (room.punishment_predictions or {})
                    ):
                        await drop_bet(session, room, user_id)
                        bets = dict(room.punishment_predictions or {})
                        await sio.emit(
                            "room:updated",
                            {"patch": {"punishment_bets": bets}},
                            room=room_code,
                            namespace=NAMESPACE,
                        )
        log.info("ws.disconnect", sid=sid, user_id=user_id)

    @sio.on("room:join", namespace=NAMESPACE)
    async def on_room_join(sid: str, data: dict[str, Any]) -> None:
        sess = await sio.get_session(sid, namespace=NAMESPACE)
        user_id = sess.get("user_id")
        if user_id is None:
            await sio.emit("error", {"code": "unauthenticated"}, to=sid, namespace=NAMESPACE)
            return
        code = (data or {}).get("code", "")
        if not isinstance(code, str) or not code:
            await sio.emit("error", {"code": "bad_payload"}, to=sid, namespace=NAMESPACE)
            return

        async with SessionLocal() as session:
            room = await get_room_by_code(session, code)
            if room is None:
                await sio.emit(
                    "error", {"code": "room_not_found"}, to=sid, namespace=NAMESPACE,
                )
                return
            try:
                await join_room(session, room, user_id)
            except RoomServiceError as exc:
                await sio.emit("error", {"code": exc.code}, to=sid, namespace=NAMESPACE)
                return
            await session.commit()
            await session.refresh(room)
            state = (
                await build_room_state(session, room, current_user_id=user_id)
            ).model_dump(mode="json")
            room_id = room.id
            room_code = room.code

        sess["room_id"] = room_id
        sess["room_code"] = room_code
        await sio.save_session(sid, sess, namespace=NAMESPACE)

        await sio.enter_room(sid, room_code, namespace=NAMESPACE)
        await presence_set(room_id, user_id)

        await sio.emit("room:state", state, to=sid, namespace=NAMESPACE)
        await sio.emit(
            "room:participant_joined",
            {"user_id": user_id},
            room=room_code,
            namespace=NAMESPACE,
            skip_sid=sid,
        )
        log.info("ws.room.join", user_id=user_id, code=room_code)

    @sio.on("room:leave", namespace=NAMESPACE)
    async def on_room_leave(sid: str) -> None:
        sess = await sio.get_session(sid, namespace=NAMESPACE)
        user_id = sess.get("user_id")
        room_id = sess.get("room_id")
        room_code = sess.get("room_code")
        if user_id is None or room_code is None:
            return
        await sio.leave_room(sid, room_code, namespace=NAMESPACE)
        if room_id is not None:
            await presence_remove(room_id, user_id)
        await sio.emit(
            "room:participant_left",
            {"user_id": user_id},
            room=room_code,
            namespace=NAMESPACE,
            skip_sid=sid,
        )
        # Punishment: drop the departing player's prediction while the round
        # is still predicting so the host's "waiting on" list shrinks. Only
        # broadcast when the locked set actually changed.
        if room_id is not None:
            async with SessionLocal() as session:
                room = await session.get(Room, room_id)
                if (
                    room is not None
                    and room.game_mode == "punishment"
                    and room.status == "lobby"
                    and str(user_id) in (room.punishment_predictions or {})
                ):
                    await drop_bet(session, room, user_id)
                    bets = dict(room.punishment_predictions or {})
                    await sio.emit(
                        "room:updated",
                        {"patch": {"punishment_bets": bets}},
                        room=room_code,
                        namespace=NAMESPACE,
                    )
        sess.pop("room_id", None)
        sess.pop("room_code", None)
        await sio.save_session(sid, sess, namespace=NAMESPACE)

    @sio.on("spin:trigger", namespace=NAMESPACE)
    async def on_spin_trigger(sid: str, data: dict[str, Any] | None = None) -> None:
        sess = await sio.get_session(sid, namespace=NAMESPACE)
        user_id = sess.get("user_id")
        room_code = sess.get("room_code")
        room_id = sess.get("room_id")
        if user_id is None or room_code is None or room_id is None:
            await sio.emit("error", {"code": "not_in_room"}, to=sid, namespace=NAMESPACE)
            return

        async with SessionLocal() as session:
            room = await get_room_by_code(session, room_code)
            if room is None:
                await sio.emit(
                    "error", {"code": "room_not_found"}, to=sid, namespace=NAMESPACE,
                )
                return
            # Punishment v3 gate: turn-based personal-bet race. Players spin
            # in turn; a miss deals a dare that BLOCKS the turn until resolved.
            # This whole block stands in for the generic user_can_spin check
            # (which is run for every other mode in the elif just below).
            if room.game_mode == "punishment":
                if room.punishment_winner_user_id is not None:
                    await sio.emit(
                        "error", {"code": "game_over"}, to=sid, namespace=NAMESPACE,
                    )
                    return
                outcome = room.punishment_last_outcome
                if (
                    outcome is not None
                    and outcome.get("kind") == "punish"
                    and not outcome.get("resolved")
                ):
                    await sio.emit(
                        "error",
                        {"code": "punishment_pending"},
                        to=sid,
                        namespace=NAMESPACE,
                    )
                    return
                # Betting phase (lobby): everyone present must bet, then seed
                # the turn cursor to the first eligible bettor.
                if room.status == "lobby":
                    present = await presence_user_ids(room_id)
                    if not all_present_bet(room.punishment_predictions, present):
                        await sio.emit(
                            "error",
                            {"code": "bets_pending"},
                            to=sid,
                            namespace=NAMESPACE,
                        )
                        return
                    await start_game(session, room)
                    await session.commit()
                if room.current_turn_user_id != user_id:
                    await sio.emit(
                        "error",
                        {"code": "not_your_turn"},
                        to=sid,
                        namespace=NAMESPACE,
                    )
                    return
            elif not user_can_spin(room, user_id):
                # Permission check before the throttles. A guest in a
                # host_only room (e.g. after the host flipped policy
                # mid-room and the guest's snapshot hasn't caught up)
                # must NOT burn the 1.5 s cooldown slot for the room —
                # otherwise their next tap returns rate_limited instead
                # of the more accurate not_allowed_to_spin.
                await sio.emit(
                    "error",
                    {"code": "not_allowed_to_spin"},
                    to=sid,
                    namespace=NAMESPACE,
                )
                return

            # Permission OK — now the throttles. Cooldown is cheaper
            # than the hourly counter and rejects repeat-tap floods
            # before they burn a slot in the hourly cap.
            if not await cooldown_take(
                _spin_cooldown_key(room_id), ttl_ms=SPIN_COOLDOWN_MS,
            ):
                await sio.emit(
                    "error", {"code": "rate_limited"}, to=sid, namespace=NAMESPACE,
                )
                return
            if not await rate_limit_take(
                _spin_rate_limit_key(room_id),
                max_in_window=SPIN_RATE_LIMIT_MAX,
                window_seconds=SPIN_RATE_LIMIT_WINDOW_SECONDS,
            ):
                await sio.emit(
                    "error", {"code": "rate_limited"}, to=sid, namespace=NAMESPACE,
                )
                return

            was_lobby = room.status == "lobby"
            try:
                spin = await trigger_spin(session, room=room, user_id=user_id)
            except RoomServiceError as exc:
                await sio.emit("error", {"code": exc.code}, to=sid, namespace=NAMESPACE)
                return
            await session.commit()
            # trigger_spin flips lobby->active on the first spin (and, for
            # turn_based, seeds the cursor to host_id). Capture the post-spin
            # values so we can broadcast the transition — otherwise every
            # other client keeps a stale snapshot.room.status of "lobby"
            # until a reconnect.
            status_changed = was_lobby and room.status != "lobby"
            status_after = room.status
            cursor_after = room.current_turn_user_id
            series = spin.mode_state_snapshot.get("series", [])
            spin_payload = {
                "spin_id": spin.id,
                "question_id": spin.question_id,
                "triggered_by": spin.triggered_by,
                "result_segment_id": spin.result_segment_id,
                "final_angle_deg": spin.final_angle_deg,
                "duration_ms": spin.duration_ms,
                "seed": spin.seed,
                "started_at_server": spin.started_at.isoformat(),
                "mode_effects": spin.mode_state_snapshot.get("mode_effects", {}),
                "series": series,
                "winner_segment_id": spin.result_segment_id,
            }
            spin_id = spin.id
            result_segment_id = spin.result_segment_id
            # Settle must cover the whole series (best-of-N), not one spin.
            duration_ms = (
                sum(int(e["duration_ms"]) for e in series)
                if isinstance(series, list) and series
                else spin.duration_ms
            )

        if status_changed:
            await sio.emit(
                "room:updated",
                {
                    "patch": {
                        "status": status_after,
                        "current_turn_user_id": cursor_after,
                    },
                },
                room=room_code,
                namespace=NAMESPACE,
            )

        await sio.emit(
            "spin:announced",
            {
                "spin_id": spin_id,
                "triggered_by": user_id,
                "countdown_ms": int(SPIN_ANNOUNCE_DELAY_SECONDS * 1000),
            },
            room=room_code,
            namespace=NAMESPACE,
        )
        await asyncio.sleep(SPIN_ANNOUNCE_DELAY_SECONDS)
        await sio.emit("spin:started", spin_payload, room=room_code, namespace=NAMESPACE)
        _schedule(
            _emit_settled(
                sio, room_code, room_id, spin_id, result_segment_id, duration_ms,
            ),
        )

    @sio.on("round:reset", namespace=NAMESPACE)
    async def on_round_reset(sid: str) -> None:
        sess = await sio.get_session(sid, namespace=NAMESPACE)
        user_id = sess.get("user_id")
        room_code = sess.get("room_code")
        room_id = sess.get("room_id")
        if user_id is None or room_code is None or room_id is None:
            await sio.emit("error", {"code": "not_in_room"}, to=sid, namespace=NAMESPACE)
            return
        async with SessionLocal() as session:
            room = await session.get(Room, room_id)
            if room is None:
                await sio.emit(
                    "error", {"code": "room_not_found"}, to=sid, namespace=NAMESPACE,
                )
                return
            if room.host_id != user_id:
                await sio.emit("error", {"code": "not_host"}, to=sid, namespace=NAMESPACE)
                return
            if room.game_mode == "punishment":
                # New game: clear bets/counts/winner/outcome, back to lobby so
                # players re-bet (cumulative done_count is preserved).
                await reset_game(session, room)
            question = (
                await session.execute(
                    select(Question).where(
                        Question.room_id == room.id,
                        Question.is_active.is_(True),
                    ),
                )
            ).scalar_one_or_none()
            if question is not None:
                segments = (
                    await session.execute(
                        select(Segment).where(
                            Segment.parent_id == question.id,
                            Segment.parent_type == "question",
                        ),
                    )
                ).scalars().all()
                for seg in segments:
                    seg.eliminated_at = None
            await session.commit()
        await sio.emit("round:reset", {}, room=room_code, namespace=NAMESPACE)
        log.info("ws.round.reset", user_id=user_id, code=room_code)

    @sio.on("punishment:bet", namespace=NAMESPACE)
    async def on_punishment_bet(sid: str, data: dict[str, Any]) -> None:
        sess = await sio.get_session(sid, namespace=NAMESPACE)
        user_id = sess.get("user_id")
        room_code = sess.get("room_code")
        room_id = sess.get("room_id")
        if user_id is None or room_code is None or room_id is None:
            await sio.emit("error", {"code": "not_in_room"}, to=sid, namespace=NAMESPACE)
            return
        async with SessionLocal() as session:
            room = await session.get(Room, room_id)
            if room is None:
                await sio.emit(
                    "error", {"code": "room_not_found"}, to=sid, namespace=NAMESPACE,
                )
                return
            try:
                await place_bet(
                    session, room, user_id, int((data or {})["segment_id"]),
                )
            except RoomServiceError as exc:
                await sio.emit("error", {"code": exc.code}, to=sid, namespace=NAMESPACE)
                return
            bets = dict(room.punishment_predictions or {})
        # Bets are PUBLIC (anti-cheat) — everyone sees who bet on what.
        await sio.emit(
            "room:updated",
            {"patch": {"punishment_bets": bets}},
            room=room_code,
            namespace=NAMESPACE,
        )
        log.info("ws.punishment.bet", user_id=user_id, code=room_code)

    @sio.on("punishment:resolve", namespace=NAMESPACE)
    async def on_punishment_resolve(sid: str, data: dict[str, Any]) -> None:
        sess = await sio.get_session(sid, namespace=NAMESPACE)
        user_id = sess.get("user_id")
        room_code = sess.get("room_code")
        room_id = sess.get("room_id")
        if user_id is None or room_code is None or room_id is None:
            await sio.emit("error", {"code": "not_in_room"}, to=sid, namespace=NAMESPACE)
            return
        refuse = bool((data or {}).get("refuse", False))
        async with SessionLocal() as session:
            room = await session.get(Room, room_id)
            if room is None:
                return  # nothing pending — no-op
            try:
                changed = await resolve_punishment(
                    session, room, user_id, refuse=refuse,
                )
            except RoomServiceError as exc:
                await sio.emit("error", {"code": exc.code}, to=sid, namespace=NAMESPACE)
                return
            if not changed:
                return  # no pending punishment for this user — silent no-op
            patch = {
                "punishment_match_counts": room.punishment_match_counts,
                "punishment_last_outcome": room.punishment_last_outcome,
                "punishment_done_count": room.punishment_done_count,
                "current_turn_user_id": room.current_turn_user_id,
            }
        await sio.emit(
            "room:updated",
            {"patch": patch},
            room=room_code,
            namespace=NAMESPACE,
        )
        log.info(
            "ws.punishment.resolve", user_id=user_id, refuse=refuse, code=room_code,
        )

    @sio.on("punishment:approve", namespace=NAMESPACE)
    async def on_punishment_approve(sid: str, data: dict[str, Any] | None = None) -> None:
        sess = await sio.get_session(sid, namespace=NAMESPACE)
        user_id = sess.get("user_id")
        room_code = sess.get("room_code")
        room_id = sess.get("room_id")
        if user_id is None or room_code is None or room_id is None:
            await sio.emit("error", {"code": "not_in_room"}, to=sid, namespace=NAMESPACE)
            return
        async with SessionLocal() as session:
            room = await session.get(Room, room_id)
            if room is None:
                return
            changed = await approve_punishment(session, room, user_id)
            if not changed:
                await sio.emit(
                    "error", {"code": "not_approver"}, to=sid, namespace=NAMESPACE,
                )
                return
            patch = {
                "punishment_last_outcome": room.punishment_last_outcome,
                "punishment_done_count": room.punishment_done_count,
                "punishment_done_counts": room.punishment_done_counts,
                "current_turn_user_id": room.current_turn_user_id,
            }
        await sio.emit(
            "room:updated",
            {"patch": patch},
            room=room_code,
            namespace=NAMESPACE,
        )
        log.info("ws.punishment.approve", user_id=user_id, code=room_code)

    @sio.on("punishment:reject", namespace=NAMESPACE)
    async def on_punishment_reject(sid: str, data: dict[str, Any] | None = None) -> None:
        sess = await sio.get_session(sid, namespace=NAMESPACE)
        user_id = sess.get("user_id")
        room_code = sess.get("room_code")
        room_id = sess.get("room_id")
        if user_id is None or room_code is None or room_id is None:
            await sio.emit("error", {"code": "not_in_room"}, to=sid, namespace=NAMESPACE)
            return
        async with SessionLocal() as session:
            room = await session.get(Room, room_id)
            if room is None:
                return
            changed = await reject_punishment(session, room, user_id)
            if not changed:
                await sio.emit(
                    "error", {"code": "not_approver"}, to=sid, namespace=NAMESPACE,
                )
                return
            patch = {"punishment_last_outcome": room.punishment_last_outcome}
        await sio.emit(
            "room:updated",
            {"patch": patch},
            room=room_code,
            namespace=NAMESPACE,
        )
        log.info("ws.punishment.reject", user_id=user_id, code=room_code)

    @sio.on("bon:reset", namespace=NAMESPACE)
    async def on_bon_reset(sid: str) -> None:
        sess = await sio.get_session(sid, namespace=NAMESPACE)
        user_id = sess.get("user_id")
        room_code = sess.get("room_code")
        room_id = sess.get("room_id")
        if user_id is None or room_code is None or room_id is None:
            await sio.emit("error", {"code": "not_in_room"}, to=sid, namespace=NAMESPACE)
            return
        async with SessionLocal() as session:
            room = await session.get(Room, room_id)
            if room is None:
                await sio.emit(
                    "error", {"code": "room_not_found"}, to=sid, namespace=NAMESPACE,
                )
                return
            if room.host_id != user_id:
                await sio.emit("error", {"code": "not_host"}, to=sid, namespace=NAMESPACE)
                return
            # Baseline = latest spin of the active question, so only future
            # spins count toward the new round.
            active_q = (
                await session.execute(
                    select(Question.id).where(
                        Question.room_id == room.id,
                        Question.is_active.is_(True),
                    ),
                )
            ).scalar_one_or_none()
            latest_spin_id = 0
            if active_q is not None:
                latest_spin_id = (
                    await session.execute(
                        select(Spin.id)
                        .where(Spin.question_id == active_q)
                        .order_by(Spin.id.desc())
                        .limit(1),
                    )
                ).scalar_one_or_none() or 0
            room.bon_round_start_spin_id = latest_spin_id
            room.bon_attempts = 0
            room.bon_tally = None
            room.bon_winner_segment_id = None
            await session.commit()
        await sio.emit(
            "room:updated",
            {
                "patch": {
                    "bon_attempts": 0,
                    "bon_tally": None,
                    "bon_winner_segment_id": None,
                },
            },
            room=room_code,
            namespace=NAMESPACE,
        )
        await sio.emit("bon:reset", {}, room=room_code, namespace=NAMESPACE)
        log.info("ws.bon.reset", user_id=user_id, code=room_code)

    @sio.on("reaction:send", namespace=NAMESPACE)
    async def on_reaction_send(sid: str, data: dict[str, Any]) -> None:
        sess = await sio.get_session(sid, namespace=NAMESPACE)
        user_id = sess.get("user_id")
        room_code = sess.get("room_code")
        if user_id is None or room_code is None:
            return
        emoji = (data or {}).get("emoji", "")
        if not isinstance(emoji, str) or not emoji or len(emoji) > 16:
            return
        allowed = await rate_limit_take(
            f"react:{user_id}",
            max_in_window=REACTIONS_PER_WINDOW,
            window_seconds=REACTIONS_WINDOW_SECONDS,
        )
        if not allowed:
            await sio.emit("error", {"code": "rate_limited"}, to=sid, namespace=NAMESPACE)
            return
        await sio.emit(
            "reaction:received",
            {
                "emoji": emoji,
                "user_id": user_id,
                "at": datetime.now(UTC).isoformat(),
            },
            room=room_code,
            namespace=NAMESPACE,
        )

    @sio.on("presence:ping", namespace=NAMESPACE)
    async def on_presence_ping(sid: str) -> None:
        sess = await sio.get_session(sid, namespace=NAMESPACE)
        user_id = sess.get("user_id")
        room_id = sess.get("room_id")
        if user_id is None or room_id is None:
            return
        await presence_set(room_id, user_id)
        async with SessionLocal() as session:
            await refresh_presence(session, room_id, user_id)
            await session.commit()
