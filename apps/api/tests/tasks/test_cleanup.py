"""Room cleanup task (spec §12)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.auth.initdata import TelegramUser
from hoba_api.models.participant import Participant
from hoba_api.services.rooms import SegmentDraft, create_room, get_room_by_code
from hoba_api.services.users import upsert_from_telegram
from hoba_api.tasks.cleanup import close_stale_rooms


async def _user(db: AsyncSession, tg_id: int) -> int:
    user = await upsert_from_telegram(db, TelegramUser(id=tg_id, first_name="U"))
    await db.flush()
    return user.id


def _drafts(n: int) -> list[SegmentDraft]:
    return [SegmentDraft(label=f"Opt {i}") for i in range(n)]


async def _age_room(db: AsyncSession, room_id: int, hours: int) -> None:
    old = datetime.now(UTC) - timedelta(hours=hours)
    participants = (
        await db.execute(select(Participant).where(Participant.room_id == room_id))
    ).scalars().all()
    for p in participants:
        p.last_seen_at = old
    await db.flush()


async def test_closes_idle_room_keeps_fresh_one(db: AsyncSession) -> None:
    host = await _user(db, 2001)
    stale = await create_room(db, host_id=host, question_text="Old?", segments=_drafts(2))
    fresh = await create_room(db, host_id=host, question_text="New?", segments=_drafts(2))
    await db.flush()
    await _age_room(db, stale.id, hours=48)
    await db.commit()

    closed = await close_stale_rooms(db, older_than_hours=24)
    assert closed == 1
    stale_after = await get_room_by_code(db, stale.code)
    fresh_after = await get_room_by_code(db, fresh.code)
    assert stale_after is not None and stale_after.status == "closed"
    assert fresh_after is not None and fresh_after.status != "closed"


async def test_skips_already_closed(db: AsyncSession) -> None:
    host = await _user(db, 2002)
    room = await create_room(db, host_id=host, question_text="Q?", segments=_drafts(2))
    room.status = "closed"
    await db.commit()
    assert await close_stale_rooms(db, older_than_hours=0) == 0
