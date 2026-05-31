"""Room cleanup task (spec §12 — "room cleanup cron").

Closes rooms that have gone stale — no participant seen within the cutoff
window. Rooms are ephemeral party sessions; an abandoned one sitting in
`lobby`/`active` forever is just noise (and a tiny attack surface). Closing
is non-destructive: history is kept, the room simply can't be re-entered.

Run from a host cron, e.g. hourly:

    docker compose exec api python -m hoba_api.tasks.cleanup

Override the window with `HOBA_CLEANUP_AFTER_HOURS` (default 24).
"""

from __future__ import annotations

import asyncio
import os
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.db import SessionLocal
from hoba_api.models.participant import Participant
from hoba_api.models.room import Room

DEFAULT_STALE_AFTER_HOURS = 24


async def close_stale_rooms(
    session: AsyncSession, *, older_than_hours: int = DEFAULT_STALE_AFTER_HOURS,
) -> int:
    """Close every non-closed room idle past the cutoff. Returns the count closed.

    "Idle" = newest participant `last_seen_at` (fallback `created_at`) older
    than the cutoff. Commits the change.
    """
    cutoff = datetime.now(UTC) - timedelta(hours=older_than_hours)
    rooms = (
        await session.execute(select(Room).where(Room.status != "closed"))
    ).scalars().all()

    closed = 0
    for room in rooms:
        last_seen = (
            await session.execute(
                select(func.max(Participant.last_seen_at)).where(
                    Participant.room_id == room.id,
                ),
            )
        ).scalar_one_or_none()
        last_activity = last_seen or room.created_at
        # Guard against naive timestamps from older rows.
        if last_activity.tzinfo is None:
            last_activity = last_activity.replace(tzinfo=UTC)
        if last_activity < cutoff:
            room.status = "closed"
            room.closed_at = datetime.now(UTC)
            closed += 1

    if closed:
        await session.commit()
    return closed


async def _main() -> None:
    hours = int(os.environ.get("HOBA_CLEANUP_AFTER_HOURS", DEFAULT_STALE_AFTER_HOURS))
    async with SessionLocal() as session:
        closed = await close_stale_rooms(session, older_than_hours=hours)
    print(f"room-cleanup: closed {closed} stale room(s) (>{hours}h idle)")


if __name__ == "__main__":
    asyncio.run(_main())
