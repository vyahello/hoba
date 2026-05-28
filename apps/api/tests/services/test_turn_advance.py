"""Coverage for advance_turn — presence-aware cursor rotation."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.auth.initdata import TelegramUser
from hoba_api.models.participant import Participant
from hoba_api.models.room import Room
from hoba_api.redis_client import presence_remove, presence_set
from hoba_api.services.rooms import SegmentDraft, create_room
from hoba_api.services.spins import advance_turn
from hoba_api.services.users import upsert_from_telegram


async def _make_user_id(db: AsyncSession, tg_id: int) -> int:
    user = await upsert_from_telegram(
        db, TelegramUser(id=tg_id, first_name=f"U{tg_id}"),
    )
    await db.flush()
    return user.id


async def _make_room_with_n_participants(
    db: AsyncSession, n: int, *, tg_offset: int = 1000,
) -> tuple[Room, list[int]]:
    """Create a room with n participants (host + n-1 guests). Returns
    (room, [host_id, *guest_ids]) where the order matches Participant.id
    insertion order — which is what advance_turn walks.
    """
    host_id = await _make_user_id(db, tg_id=tg_offset)
    room = await create_room(
        db,
        host_id=host_id,
        question_text="Q?",
        segments=[SegmentDraft(label="a"), SegmentDraft(label="b")],
    )
    user_ids = [host_id]
    for i in range(1, n):
        guest_id = await _make_user_id(db, tg_id=tg_offset + i)
        db.add(Participant(room_id=room.id, user_id=guest_id, role="guest"))
        user_ids.append(guest_id)
    await db.flush()
    return room, user_ids


async def test_advance_from_null_cursor_picks_first_online_participant(
    db: AsyncSession,
) -> None:
    room, users = await _make_room_with_n_participants(db, 3, tg_offset=2000)
    for u in users:
        await presence_set(room.id, u)
    new_cursor = await advance_turn(db, room)
    assert new_cursor == users[0]
    assert room.current_turn_user_id == users[0]


async def test_advance_skips_disconnected_participant(db: AsyncSession) -> None:
    room, users = await _make_room_with_n_participants(db, 3, tg_offset=2100)
    for u in users:
        await presence_set(room.id, u)
    room.current_turn_user_id = users[0]
    # Drop users[1] from presence — advance should jump to users[2].
    await presence_remove(room.id, users[1])
    new_cursor = await advance_turn(db, room)
    assert new_cursor == users[2]


async def test_advance_wraps_to_first_when_at_end(db: AsyncSession) -> None:
    room, users = await _make_room_with_n_participants(db, 3, tg_offset=2200)
    for u in users:
        await presence_set(room.id, u)
    room.current_turn_user_id = users[2]
    new_cursor = await advance_turn(db, room)
    assert new_cursor == users[0]


async def test_advance_returns_none_when_all_offline(db: AsyncSession) -> None:
    room, users = await _make_room_with_n_participants(db, 3, tg_offset=2300)
    # No presence_set calls — Redis has no presence keys.
    room.current_turn_user_id = users[0]
    new_cursor = await advance_turn(db, room)
    assert new_cursor is None
    assert room.current_turn_user_id is None


async def test_advance_handles_solo_room(db: AsyncSession) -> None:
    room, users = await _make_room_with_n_participants(db, 1, tg_offset=2400)
    await presence_set(room.id, users[0])
    room.current_turn_user_id = users[0]
    new_cursor = await advance_turn(db, room)
    # Only one online participant — cursor lands on them again.
    assert new_cursor == users[0]
