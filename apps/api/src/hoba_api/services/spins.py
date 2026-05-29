"""Spin service — server-authoritative spin generation + persistence."""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.models.participant import Participant
from hoba_api.models.question import Question
from hoba_api.models.room import Room
from hoba_api.models.segment import Segment
from hoba_api.models.spin import Spin
from hoba_api.models.user import User
from hoba_api.modes import engine_for
from hoba_api.modes.base import SpinContext
from hoba_api.modes.punishment_decks import CARDS_PER_DECK, deck_cards
from hoba_api.redis_client import presence_user_ids
from hoba_api.services.rooms import RoomServiceError
from hoba_api.wheel.spin_math import compute_spin

MIN_SEGMENTS_TO_SPIN = 2


async def trigger_spin(
    session: AsyncSession, *, room: Room, user_id: int,
) -> Spin:
    """Compute + persist a spin. Enforces `spin_policy` and segment count."""
    if room.status == "closed":
        raise RoomServiceError("room_closed")

    # In turn_based rooms, the very first spin (still in lobby) sets the
    # cursor to host_id so the host can kick things off. After that the
    # cursor advances on each spin:settled.
    if (
        room.spin_policy == "turn_based"
        and room.status == "lobby"
        and room.current_turn_user_id is None
    ):
        room.current_turn_user_id = room.host_id

    if not user_can_spin(room, user_id):
        raise RoomServiceError("not_allowed_to_spin")

    if room.game_mode == "punishment" and room.punishment_active_card is not None:
        raise RoomServiceError("card_pending")

    question = (
        await session.execute(
            select(Question).where(
                Question.room_id == room.id, Question.is_active.is_(True),
            ),
        )
    ).scalar_one_or_none()
    if question is None:
        raise RoomServiceError("no_active_question")

    all_segments = list(
        (
            await session.execute(
                select(Segment)
                .where(
                    Segment.parent_id == question.id,
                    Segment.parent_type == "question",
                )
                .order_by(Segment.position),
            )
        )
        .scalars()
        .all(),
    )

    engine = engine_for(room.game_mode)
    ctx = SpinContext(room=room, question=question, segments=all_segments)
    decision = engine.on_spin_request(ctx)
    spin_segments = decision.segments
    if len(spin_segments) < MIN_SEGMENTS_TO_SPIN:
        raise RoomServiceError("too_few_segments")

    last_spin = (
        await session.execute(
            select(Spin)
            .where(Spin.question_id == question.id)
            .order_by(Spin.id.desc())
            .limit(1),
        )
    ).scalar_one_or_none()
    starting_angle_deg = last_spin.final_angle_deg if last_spin is not None else 0.0

    seed = secrets.randbits(31)
    raw_weights = [float(s.weight) for s in spin_segments]
    weights: list[float] | None = (
        None if all(w == 1.0 for w in raw_weights) else raw_weights
    )
    result = compute_spin(
        segment_count=len(spin_segments),
        seed=seed,
        starting_angle_deg=starting_angle_deg,
        weights=weights,
    )
    duration_ms = round(result.duration_ms * decision.duration_multiplier)

    winning_segment = spin_segments[result.result_segment_index]
    started_at = datetime.now(UTC)
    spin = Spin(
        question_id=question.id,
        triggered_by=user_id,
        result_segment_id=winning_segment.id,
        final_angle_deg=result.final_angle_deg,
        duration_ms=duration_ms,
        seed=seed,
        mode_state_snapshot={
            "living_segment_ids": [s.id for s in spin_segments],
            "mode_effects": decision.effects,
        },
        started_at=started_at,
        settled_at=started_at + timedelta(milliseconds=duration_ms),
    )
    session.add(spin)

    if room.status == "lobby":
        room.status = "active"

    await session.flush()

    if room.game_mode == "punishment":
        deck = room.punishment_deck or "mild"
        host = await session.get(User, room.host_id)
        lang = host.language_code if host is not None else "en"
        idx = await _draw_punishment_index(session, question.id)
        # Reassign a NEW dict — SQLAlchemy JSON tracks identity, not
        # in-place mutation.
        snapshot = dict(spin.mode_state_snapshot)
        snapshot["punishment"] = {"deck": deck, "lang": lang, "card_index": idx}
        spin.mode_state_snapshot = snapshot
        room.punishment_active_card = {
            "text": deck_cards(deck, lang)[idx],
            "deck": deck,
            "victim_segment_id": winning_segment.id,
            "spin_id": spin.id,
        }
        await session.flush()

    return spin


async def _draw_punishment_index(
    session: AsyncSession, question_id: int,
) -> int:
    """Pick a card index not yet drawn for this question (without
    replacement). When all CARDS_PER_DECK have been drawn, reshuffle (the
    pool resets to the full range). Drawn set = prior spins'
    mode_state_snapshot['punishment']['card_index'] for this question."""
    rows = (
        await session.execute(
            select(Spin.mode_state_snapshot).where(Spin.question_id == question_id),
        )
    ).scalars().all()
    drawn: set[int] = set()
    for snap in rows:
        if not isinstance(snap, dict):
            continue
        pun = snap.get("punishment")
        if isinstance(pun, dict):
            idx = pun.get("card_index")
            if isinstance(idx, int):
                drawn.add(idx)
    pool = [i for i in range(CARDS_PER_DECK) if i not in drawn]
    if not pool:
        pool = list(range(CARDS_PER_DECK))
    return secrets.choice(pool)


def user_can_spin(room: Room, user_id: int) -> bool:
    if room.spin_policy == "anyone":
        return True
    if room.spin_policy == "host_only":
        return room.host_id == user_id
    if room.spin_policy == "turn_based":
        # Pre-first-spin: a turn_based lobby keeps a null cursor until the
        # first spin seeds it to host_id. The host must be the effective
        # turn-holder so they can kick off. This check runs in
        # on_spin_trigger BEFORE trigger_spin's seed logic, so without
        # this branch the host's own first spin is rejected and the room
        # never starts. Mirrors the frontend `effectiveTurnUserId`.
        if room.current_turn_user_id is None and room.status == "lobby":
            return room.host_id == user_id
        return room.current_turn_user_id == user_id
    return False


async def advance_turn(
    session: AsyncSession, room: Room,
) -> int | None:
    """Advance `room.current_turn_user_id` to the next online participant.

    Walks Participant rows ordered by joined_at (= join order; user_id is
    the tiebreaker). Starts at the slot after `room.current_turn_user_id`,
    or at slot 0 if the cursor is None. Skips any participant whose
    presence key is missing from Redis. Wraps around past the end.
    Returns the new cursor (or None if no one is online). Mutates
    `room.current_turn_user_id` in place; caller commits.
    """
    rows: list[int] = list(
        (
            await session.execute(
                select(Participant.user_id)
                .where(Participant.room_id == room.id)
                .order_by(Participant.joined_at, Participant.user_id),
            )
        ).scalars().all(),
    )
    if not rows:
        room.current_turn_user_id = None
        return None
    online = await presence_user_ids(room.id)
    if not online:
        room.current_turn_user_id = None
        return None

    if room.current_turn_user_id is None:
        start = 0
    else:
        try:
            start = rows.index(room.current_turn_user_id) + 1
        except ValueError:
            start = 0
    n = len(rows)
    for offset in range(n):
        candidate = rows[(start + offset) % n]
        if candidate in online:
            room.current_turn_user_id = candidate
            return candidate
    room.current_turn_user_id = None
    return None


async def list_room_spins(
    session: AsyncSession, room_id: int, limit: int = 50,
) -> list[Spin]:
    rows = await session.execute(
        select(Spin)
        .join(Question, Spin.question_id == Question.id)
        .where(Question.room_id == room_id)
        .order_by(Spin.id.desc())
        .limit(limit),
    )
    return list(rows.scalars().all())
