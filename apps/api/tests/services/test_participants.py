"""Tests for `hoba_api.services.participants`."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.services.participants import join_room, list_for_room
from hoba_api.services.rooms import (
    RoomServiceError,
    SegmentDraft,
    close_room,
    create_room,
)


def _drafts() -> list[SegmentDraft]:
    return [SegmentDraft(label="A"), SegmentDraft(label="B")]


async def _make_user(db: AsyncSession, tg_id: int) -> int:
    from hoba_api.auth.initdata import TelegramUser
    from hoba_api.services.users import upsert_from_telegram

    user = await upsert_from_telegram(
        db, TelegramUser(id=tg_id, first_name=f"User{tg_id}"),
    )
    await db.flush()
    return user.id


async def test_join_room_idempotent(db: AsyncSession) -> None:
    host_id = await _make_user(db, tg_id=10)
    guest_id = await _make_user(db, tg_id=11)
    room = await create_room(
        db, host_id=host_id, question_text="?", segments=_drafts(),
    )
    await db.commit()

    p1 = await join_room(db, room, guest_id)
    await db.commit()
    p2 = await join_room(db, room, guest_id)
    await db.commit()
    assert p1.room_id == p2.room_id
    assert p1.user_id == p2.user_id

    participants = await list_for_room(db, room.id)
    user_ids = {p.user_id for p in participants}
    assert {host_id, guest_id} <= user_ids


async def test_join_room_blocks_kicked(db: AsyncSession) -> None:
    host_id = await _make_user(db, tg_id=12)
    guest_id = await _make_user(db, tg_id=13)
    room = await create_room(
        db, host_id=host_id, question_text="?", segments=_drafts(),
    )
    await db.commit()

    participant = await join_room(db, room, guest_id)
    participant.kicked_at = datetime.now(UTC)
    await db.commit()

    with pytest.raises(RoomServiceError) as exc:
        await join_room(db, room, guest_id)
    assert exc.value.code == "kicked"


async def test_join_room_rejects_closed(db: AsyncSession) -> None:
    host_id = await _make_user(db, tg_id=14)
    guest_id = await _make_user(db, tg_id=15)
    room = await create_room(
        db, host_id=host_id, question_text="?", segments=_drafts(),
    )
    await close_room(db, room, user_id=host_id)
    await db.commit()

    with pytest.raises(RoomServiceError) as exc:
        await join_room(db, room, guest_id)
    assert exc.value.code == "room_closed"
