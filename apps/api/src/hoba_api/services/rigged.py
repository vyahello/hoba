"""Rigged Mode 🎭 (spec §5.5) — host-only segment weighting.

The weights live in the existing `segments.weight` column (which `compute_spin`
already consumes), so weighted spins work with no engine change. Secrecy is
handled at serialization time (`build_room_state` redacts mode + weights for
non-host viewers); this service just validates + persists the host's edits and
flips the room into `rigged`.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.models.question import Question
from hoba_api.models.room import Room
from hoba_api.models.segment import Segment
from hoba_api.services.rooms import RoomServiceError

MIN_WEIGHT = 0
MAX_WEIGHT = 100


async def set_rig_weights(
    session: AsyncSession,
    room: Room,
    *,
    user_id: int,
    weights: dict[int, int],
) -> None:
    """Set per-segment weights (host only) and flip the room into Rigged Mode.

    `weights` maps segment id → 0..100. Segments omitted keep their current
    weight. At least one resulting weight must be > 0. Does NOT change the
    spin policy (that would tip guests off that the room isn't plain Classic).
    """
    if room.host_id != user_id:
        raise RoomServiceError("not_host")
    if room.status == "closed":
        raise RoomServiceError("room_closed")

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
                select(Segment).where(
                    Segment.parent_id == question.id,
                    Segment.parent_type == "question",
                ),
            )
        ).scalars().all(),
    )
    by_id = {s.id: s for s in segments}

    for seg_id, weight in weights.items():
        if seg_id not in by_id:
            raise RoomServiceError("invalid_segment")
        if not (MIN_WEIGHT <= weight <= MAX_WEIGHT):
            raise RoomServiceError("bad_weight")

    # A rig where everything is 0 has no valid outcome — reject it.
    resulting = {
        s.id: weights.get(s.id, s.weight) for s in segments
    }
    if sum(resulting.values()) <= 0:
        raise RoomServiceError("bad_weight")

    for seg_id, weight in weights.items():
        by_id[seg_id].weight = weight
    room.game_mode = "rigged"
    await session.flush()


REVEAL_EMOJI = "🎭"


async def reveal_rig(session: AsyncSession, room: Room, *, user_id: int) -> None:
    """Host reveals the rig (spec §5.5): un-redact for everyone + 🎭 in the title.

    After this, `build_room_state` stops redacting (mode + weights become
    visible to all). Idempotent — re-revealing is a no-op.
    """
    if room.host_id != user_id:
        raise RoomServiceError("not_host")
    if room.game_mode != "rigged":
        raise RoomServiceError("not_rigged")
    if room.rigged_revealed:
        return
    room.rigged_revealed = True
    # Ethical guard: stamp 🎭 into the title (transparency, post-fact).
    title = (room.title or "").rstrip()
    if REVEAL_EMOJI not in title:
        room.title = f"{title} {REVEAL_EMOJI}".strip()
    await session.flush()
