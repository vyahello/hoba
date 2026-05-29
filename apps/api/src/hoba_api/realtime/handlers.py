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

from hoba_api.auth.initdata import (
    InvalidInitData,
    parse_telegram_user,
    validate_init_data,
)
from hoba_api.config import settings
from hoba_api.db import SessionLocal
from hoba_api.models.room import Room
from hoba_api.realtime.server import NAMESPACE
from hoba_api.redis_client import (
    cooldown_take,
    presence_remove,
    presence_set,
    rate_limit_take,
)
from hoba_api.services.participants import join_room, refresh_presence
from hoba_api.services.room_state import build_room_state
from hoba_api.services.rooms import RoomServiceError, get_room_by_code
from hoba_api.services.spins import advance_turn, trigger_spin, user_can_spin
from hoba_api.services.users import cache_user_after_commit, resolve_telegram_user

log = structlog.get_logger("hoba_api.realtime")

REACTIONS_PER_WINDOW = 10
REACTIONS_WINDOW_SECONDS = 30
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
    await sio.emit(
        "spin:settled",
        {
            "spin_id": spin_id,
            "result_segment_id": result_segment_id,
            "mode_aftereffects": {},
        },
        room=room_code,
        namespace=NAMESPACE,
    )
    # Turn-based: advance the cursor and broadcast the new value so all
    # clients see whose turn it is now. Re-fetch the room because policy
    # may have changed during the spin animation; skip advance if so.
    async with SessionLocal() as session:
        room = await session.get(Room, room_id)
        if room is None or room.spin_policy != "turn_based":
            return
        new_cursor = await advance_turn(session, room)
        await session.commit()
    await sio.emit(
        "room:updated",
        {"patch": {"current_turn_user_id": new_cursor}},
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
        sess.pop("room_id", None)
        sess.pop("room_code", None)
        await sio.save_session(sid, sess, namespace=NAMESPACE)

    @sio.on("spin:trigger", namespace=NAMESPACE)
    async def on_spin_trigger(sid: str, _data: dict[str, Any]) -> None:
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
            # Permission check before the throttles. A guest in a
            # host_only room (e.g. after the host flipped policy
            # mid-room and the guest's snapshot hasn't caught up)
            # must NOT burn the 1.5 s cooldown slot for the room —
            # otherwise their next tap returns rate_limited instead
            # of the more accurate not_allowed_to_spin.
            if not user_can_spin(room, user_id):
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
            spin_payload = {
                "spin_id": spin.id,
                "question_id": spin.question_id,
                "triggered_by": spin.triggered_by,
                "result_segment_id": spin.result_segment_id,
                "final_angle_deg": spin.final_angle_deg,
                "duration_ms": spin.duration_ms,
                "seed": spin.seed,
                "started_at_server": spin.started_at.isoformat(),
                "mode_effects": {},
            }
            spin_id = spin.id
            result_segment_id = spin.result_segment_id
            duration_ms = spin.duration_ms

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
