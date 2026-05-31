"""Saved-wheel library service (spec §8 / F10).

A wheel's options are Segment rows (parent_type="wheel"). "Use as room"
copies them into a fresh room via `create_room` and bumps `use_count`.
Reuses `RoomServiceError` so the REST layer maps codes uniformly.
"""

from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.models.room import Room
from hoba_api.models.segment import Segment
from hoba_api.models.wheel import Wheel
from hoba_api.services.rooms import (
    MAX_SEGMENTS,
    MIN_SEGMENTS,
    RoomServiceError,
    SegmentDraft,
    create_room,
)


def _validate(title: str, segments: list[SegmentDraft]) -> None:
    if not title.strip():
        raise RoomServiceError("empty_title")
    if not MIN_SEGMENTS <= len(segments) <= MAX_SEGMENTS:
        raise RoomServiceError("bad_segment_count")


async def _add_segments(
    session: AsyncSession, wheel_id: int, segments: list[SegmentDraft],
) -> None:
    for i, draft in enumerate(segments):
        session.add(
            Segment(
                parent_id=wheel_id,
                parent_type="wheel",
                label=draft.label.strip(),
                emoji=draft.emoji,
                color_seed=draft.color_seed,
                weight=draft.weight,
                position=i,
            ),
        )


async def create_wheel(
    session: AsyncSession, *, owner_id: int, title: str, segments: list[SegmentDraft],
) -> Wheel:
    _validate(title, segments)
    wheel = Wheel(owner_id=owner_id, title=title.strip())
    session.add(wheel)
    await session.flush()
    await _add_segments(session, wheel.id, segments)
    await session.flush()
    return wheel


async def list_wheels(session: AsyncSession, owner_id: int) -> list[Wheel]:
    rows = await session.execute(
        select(Wheel).where(Wheel.owner_id == owner_id).order_by(Wheel.created_at.desc()),
    )
    return list(rows.scalars().all())


async def get_wheel(session: AsyncSession, wheel_id: int) -> Wheel | None:
    return (
        await session.execute(select(Wheel).where(Wheel.id == wheel_id))
    ).scalar_one_or_none()


async def update_wheel(
    session: AsyncSession,
    wheel: Wheel,
    *,
    owner_id: int,
    title: str,
    segments: list[SegmentDraft],
) -> Wheel:
    if wheel.owner_id != owner_id:
        raise RoomServiceError("not_owner")
    _validate(title, segments)
    # Replace the segment set wholesale.
    await session.execute(
        delete(Segment).where(
            Segment.parent_type == "wheel", Segment.parent_id == wheel.id,
        ),
    )
    wheel.title = title.strip()
    await _add_segments(session, wheel.id, segments)
    await session.flush()
    return wheel


async def delete_wheel(session: AsyncSession, wheel: Wheel, *, owner_id: int) -> None:
    if wheel.owner_id != owner_id:
        raise RoomServiceError("not_owner")
    await session.delete(wheel)
    await session.flush()


async def use_wheel(
    session: AsyncSession,
    wheel: Wheel,
    *,
    owner_id: int,
    game_mode: str = "classic",
    punishment_deck: str | None = None,
    spin_count: int = 1,
) -> Room:
    """Instantiate the wheel as a fresh room (caller becomes host) + bump uses."""
    if wheel.owner_id != owner_id:
        raise RoomServiceError("not_owner")
    drafts = [
        SegmentDraft(
            label=s.label, emoji=s.emoji, color_seed=s.color_seed, weight=s.weight,
        )
        for s in wheel.segments
    ]
    room = await create_room(
        session,
        host_id=owner_id,
        question_text=wheel.title,
        segments=drafts,
        game_mode=game_mode,
        punishment_deck=punishment_deck,
        spin_count=spin_count,
    )
    wheel.use_count += 1
    await session.flush()
    return room
