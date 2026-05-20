"""Participant service — join, refresh, leave."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.models.participant import Participant
from hoba_api.models.room import Room
from hoba_api.services.rooms import RoomServiceError

MAX_PARTICIPANTS_PER_ROOM = 50


async def join_room(
    session: AsyncSession, room: Room, user_id: int,
) -> Participant:
    """Idempotent join. Refreshes `last_seen_at` if already a participant.

    Errors: `room_closed`, `kicked`, `room_full`.
    """
    if room.status == "closed":
        raise RoomServiceError("room_closed")
    if room.is_locked and room.host_id != user_id:
        raise RoomServiceError("room_locked")

    existing = (
        await session.execute(
            select(Participant).where(
                Participant.room_id == room.id, Participant.user_id == user_id,
            ),
        )
    ).scalar_one_or_none()

    now = datetime.now(UTC)
    if existing is not None:
        if existing.kicked_at is not None:
            raise RoomServiceError("kicked")
        existing.last_seen_at = now
        return existing

    count = (
        await session.execute(
            select(func.count())
            .select_from(Participant)
            .where(Participant.room_id == room.id),
        )
    ).scalar_one()
    if count >= MAX_PARTICIPANTS_PER_ROOM:
        raise RoomServiceError("room_full")

    participant = Participant(
        room_id=room.id, user_id=user_id, role="guest",
    )
    participant.last_seen_at = now
    session.add(participant)
    await session.flush()
    return participant


async def refresh_presence(
    session: AsyncSession, room_id: int, user_id: int,
) -> None:
    """Update the DB `last_seen_at` (Redis TTL is the live source of truth)."""
    participant = (
        await session.execute(
            select(Participant).where(
                Participant.room_id == room_id,
                Participant.user_id == user_id,
            ),
        )
    ).scalar_one_or_none()
    if participant is None:
        return
    participant.last_seen_at = datetime.now(UTC)


async def list_for_room(
    session: AsyncSession, room_id: int,
) -> list[Participant]:
    rows = await session.execute(
        select(Participant).where(Participant.room_id == room_id),
    )
    return list(rows.scalars().all())
