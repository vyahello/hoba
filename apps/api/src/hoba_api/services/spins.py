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

    if not user_can_spin(room, user_id):
        raise RoomServiceError("not_allowed_to_spin")

    question = (
        await session.execute(
            select(Question).where(
                Question.room_id == room.id, Question.is_active.is_(True),
            ),
        )
    ).scalar_one_or_none()
    if question is None:
        raise RoomServiceError("no_active_question")

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
        )
        .scalars()
        .all(),
    )
    if len(segments) < MIN_SEGMENTS_TO_SPIN:
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

    # Mulberry32 expects a 32-bit seed; use the low 31 bits of os entropy.
    seed = secrets.randbits(31)
    raw_weights = [float(s.weight) for s in segments]
    weights: list[float] | None = (
        None if all(w == 1.0 for w in raw_weights) else raw_weights
    )
    result = compute_spin(
        segment_count=len(segments),
        seed=seed,
        starting_angle_deg=starting_angle_deg,
        weights=weights,
    )

    winning_segment = segments[result.result_segment_index]
    started_at = datetime.now(UTC)
    spin = Spin(
        question_id=question.id,
        triggered_by=user_id,
        result_segment_id=winning_segment.id,
        final_angle_deg=result.final_angle_deg,
        duration_ms=result.duration_ms,
        seed=seed,
        mode_state_snapshot={},
        started_at=started_at,
        settled_at=started_at + timedelta(milliseconds=result.duration_ms),
    )
    session.add(spin)

    if room.status == "lobby":
        room.status = "active"

    await session.flush()
    return spin


def user_can_spin(room: Room, user_id: int) -> bool:
    if room.spin_policy == "anyone":
        return True
    if room.spin_policy == "host_only":
        return room.host_id == user_id
    if room.spin_policy == "turn_based":
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
