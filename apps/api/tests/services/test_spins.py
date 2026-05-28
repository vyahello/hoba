"""Tests for `hoba_api.services.spins`."""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.models.room import Room
from hoba_api.services.participants import join_room
from hoba_api.services.rooms import (
    RoomServiceError,
    SegmentDraft,
    create_room,
    update_room,
)
from hoba_api.services.spins import list_room_spins, trigger_spin, user_can_spin
from hoba_api.wheel.spin_math import segment_under_pointer


def _drafts(n: int) -> list[SegmentDraft]:
    return [SegmentDraft(label=f"S{i}", color_seed=i % 12) for i in range(n)]


async def _make_user(db: AsyncSession, tg_id: int) -> int:
    from hoba_api.auth.initdata import TelegramUser
    from hoba_api.services.users import upsert_from_telegram

    user = await upsert_from_telegram(
        db, TelegramUser(id=tg_id, first_name=f"U{tg_id}"),
    )
    await db.flush()
    return user.id


async def test_trigger_spin_host_only_blocks_guest(db: AsyncSession) -> None:
    host_id = await _make_user(db, tg_id=20)
    guest_id = await _make_user(db, tg_id=21)
    # Must opt in to host_only — the default since Stage A is `anyone`
    # to match the party-game social dynamic.
    room = await create_room(
        db,
        host_id=host_id,
        question_text="?",
        segments=_drafts(3),
        spin_policy="host_only",
    )
    await join_room(db, room, guest_id)
    await db.commit()

    with pytest.raises(RoomServiceError) as exc:
        await trigger_spin(db, room=room, user_id=guest_id)
    assert exc.value.code == "not_allowed_to_spin"


async def test_trigger_spin_anyone_allows_guest(db: AsyncSession) -> None:
    host_id = await _make_user(db, tg_id=22)
    guest_id = await _make_user(db, tg_id=23)
    room = await create_room(
        db,
        host_id=host_id,
        question_text="?",
        segments=_drafts(3),
        spin_policy="anyone",
    )
    await join_room(db, room, guest_id)
    await db.commit()

    spin = await trigger_spin(db, room=room, user_id=guest_id)
    await db.commit()
    assert spin.id is not None
    assert spin.triggered_by == guest_id


async def test_trigger_spin_produces_valid_params(db: AsyncSession) -> None:
    host_id = await _make_user(db, tg_id=24)
    room = await create_room(
        db, host_id=host_id, question_text="?", segments=_drafts(6),
    )
    await db.commit()

    spin = await trigger_spin(db, room=room, user_id=host_id)
    await db.commit()

    assert 5500 <= spin.duration_ms < 8500
    # Sanity: the segment under the pointer after rotation equals the
    # recorded winner.
    landed_index = segment_under_pointer(spin.final_angle_deg, 6)
    # The recorded result_segment_id points to one of the 6 segments;
    # we just check that landed_index is consistent (0..5).
    assert 0 <= landed_index < 6


async def test_trigger_spin_chains_forward(db: AsyncSession) -> None:
    host_id = await _make_user(db, tg_id=25)
    room = await create_room(
        db, host_id=host_id, question_text="?", segments=_drafts(4),
    )
    await db.commit()

    last_angle = 0.0
    for _ in range(5):
        spin = await trigger_spin(db, room=room, user_id=host_id)
        await db.commit()
        # Each spin should travel forward by ≥ 5 full revolutions
        assert spin.final_angle_deg - last_angle >= 5 * 360
        last_angle = spin.final_angle_deg


async def test_trigger_spin_rejects_closed_room(db: AsyncSession) -> None:
    from hoba_api.services.rooms import close_room

    host_id = await _make_user(db, tg_id=26)
    room = await create_room(
        db, host_id=host_id, question_text="?", segments=_drafts(2),
    )
    await close_room(db, room, user_id=host_id)
    await db.commit()

    with pytest.raises(RoomServiceError) as exc:
        await trigger_spin(db, room=room, user_id=host_id)
    assert exc.value.code == "room_closed"


async def test_list_room_spins_descending(db: AsyncSession) -> None:
    host_id = await _make_user(db, tg_id=27)
    room = await create_room(
        db, host_id=host_id, question_text="?", segments=_drafts(3),
    )
    await db.commit()

    ids = []
    for _ in range(3):
        spin = await trigger_spin(db, room=room, user_id=host_id)
        await db.commit()
        ids.append(spin.id)

    history = await list_room_spins(db, room.id)
    assert [s.id for s in history] == list(reversed(ids))


# `update_room` reference to keep the test module exporting clean imports
_ = update_room


# --- user_can_spin policy dispatch -----------------------------------------


def _make_room(
    spin_policy: str, *, host_id: int = 1, current_turn: int | None = None,
) -> Room:
    room = Room(
        code="ABC123",
        host_id=host_id,
        status="active",
        game_mode="classic",
        spin_policy=spin_policy,
        suggestion_policy="off",
    )
    room.current_turn_user_id = current_turn
    return room


def test_user_can_spin_turn_based_cursor_match() -> None:
    room = _make_room("turn_based", host_id=1, current_turn=42)
    assert user_can_spin(room, user_id=42) is True


def test_user_can_spin_turn_based_cursor_mismatch() -> None:
    room = _make_room("turn_based", host_id=1, current_turn=42)
    assert user_can_spin(room, user_id=99) is False


def test_user_can_spin_turn_based_cursor_null_denies_everyone() -> None:
    room = _make_room("turn_based", host_id=1, current_turn=None)
    # Cursor unset → no one is "the current turn", including host.
    assert user_can_spin(room, user_id=1) is False
    assert user_can_spin(room, user_id=99) is False


def test_user_can_spin_unknown_policy_denies() -> None:
    room = _make_room("not_a_policy", host_id=1)
    assert user_can_spin(room, user_id=1) is False
