"""Saved-wheel library (spec §8 / F10) — CRUD, ownership, use-as-room."""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.services.rooms import RoomServiceError, SegmentDraft
from hoba_api.services.wheels import (
    create_wheel,
    delete_wheel,
    get_wheel,
    list_wheels,
    update_wheel,
    use_wheel,
)


async def _make_user(db: AsyncSession, tg_id: int) -> int:
    from hoba_api.auth.initdata import TelegramUser
    from hoba_api.services.users import upsert_from_telegram

    user = await upsert_from_telegram(db, TelegramUser(id=tg_id, first_name=f"U{tg_id}"))
    await db.flush()
    return user.id


def _drafts(n: int) -> list[SegmentDraft]:
    return [SegmentDraft(label=f"Opt {i}", emoji="🎯", color_seed=i % 12) for i in range(n)]


async def test_create_and_list_wheels(db: AsyncSession) -> None:
    owner = await _make_user(db, tg_id=900)
    w = await create_wheel(db, owner_id=owner, title="Dinner", segments=_drafts(3))
    await db.commit()
    assert w.id is not None

    wheels = await list_wheels(db, owner)
    assert [x.title for x in wheels] == ["Dinner"]
    assert len(wheels[0].segments) == 3
    assert wheels[0].use_count == 0
    assert wheels[0].is_public is False


async def test_list_is_scoped_to_owner(db: AsyncSession) -> None:
    a = await _make_user(db, tg_id=901)
    b = await _make_user(db, tg_id=902)
    await create_wheel(db, owner_id=a, title="A's", segments=_drafts(2))
    await db.commit()
    assert await list_wheels(db, b) == []


async def test_create_rejects_bad_input(db: AsyncSession) -> None:
    owner = await _make_user(db, tg_id=903)
    with pytest.raises(RoomServiceError) as exc:
        await create_wheel(db, owner_id=owner, title="", segments=_drafts(2))
    assert exc.value.code == "empty_title"
    with pytest.raises(RoomServiceError) as exc2:
        await create_wheel(db, owner_id=owner, title="X", segments=_drafts(1))
    assert exc2.value.code == "bad_segment_count"


async def test_update_replaces_segments(db: AsyncSession) -> None:
    owner = await _make_user(db, tg_id=904)
    w = await create_wheel(db, owner_id=owner, title="Old", segments=_drafts(3))
    await db.commit()
    await update_wheel(db, w, owner_id=owner, title="New", segments=_drafts(5))
    await db.commit()
    fresh = await get_wheel(db, w.id)
    assert fresh is not None
    assert fresh.title == "New"
    assert len(fresh.segments) == 5


async def test_update_and_delete_require_owner(db: AsyncSession) -> None:
    owner = await _make_user(db, tg_id=905)
    other = await _make_user(db, tg_id=906)
    w = await create_wheel(db, owner_id=owner, title="Mine", segments=_drafts(2))
    await db.commit()
    with pytest.raises(RoomServiceError) as exc:
        await update_wheel(db, w, owner_id=other, title="Hacked", segments=_drafts(2))
    assert exc.value.code == "not_owner"
    with pytest.raises(RoomServiceError) as exc2:
        await delete_wheel(db, w, owner_id=other)
    assert exc2.value.code == "not_owner"


async def test_delete_removes_wheel(db: AsyncSession) -> None:
    owner = await _make_user(db, tg_id=907)
    w = await create_wheel(db, owner_id=owner, title="Temp", segments=_drafts(2))
    await db.commit()
    wid = w.id
    await delete_wheel(db, w, owner_id=owner)
    await db.commit()
    assert await get_wheel(db, wid) is None


async def test_use_wheel_creates_room_and_bumps_count(db: AsyncSession) -> None:
    owner = await _make_user(db, tg_id=908)
    w = await create_wheel(db, owner_id=owner, title="What to eat?", segments=_drafts(4))
    await db.commit()
    # Re-fetch so segments are eager-loaded (async forbids lazy-load), as the
    # endpoint does via get_wheel before calling use_wheel.
    loaded = await get_wheel(db, w.id)
    assert loaded is not None
    room = await use_wheel(db, loaded, user_id=owner, game_mode="classic")
    await db.commit()
    assert room.host_id == owner
    assert room.game_mode == "classic"
    fresh = await get_wheel(db, w.id)
    assert fresh is not None
    assert fresh.use_count == 1
