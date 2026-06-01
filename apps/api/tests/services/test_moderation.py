"""Stage G slice 1 — host moderation: kick, lock, anonymous mode, mode change."""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.anon import generate_nickname
from hoba_api.auth.initdata import TelegramUser
from hoba_api.services.participants import (
    approve_participant,
    join_room,
    kick_participant,
)
from hoba_api.services.room_state import build_room_state
from hoba_api.services.rooms import (
    RoomServiceError,
    SegmentDraft,
    create_room,
    get_room_by_code,
    update_room,
)
from hoba_api.services.users import upsert_from_telegram


async def _user(db: AsyncSession, tg_id: int, lang: str = "en") -> int:
    user = await upsert_from_telegram(
        db, TelegramUser(id=tg_id, first_name=f"Real{tg_id}", language_code=lang),
    )
    await db.flush()
    return user.id


def _drafts(n: int) -> list[SegmentDraft]:
    return [SegmentDraft(label=f"Opt {i}", color_seed=i % 12) for i in range(n)]


async def _room(db: AsyncSession, host: int) -> str:
    room = await create_room(
        db, host_id=host, question_text="Q?", segments=_drafts(3),
    )
    await db.flush()
    return room.code


# --- nickname generator ---------------------------------------------------


def test_nickname_deterministic_and_localized() -> None:
    en = generate_nickname(1, 42, "en")
    assert en == generate_nickname(1, 42, "en")  # stable
    uk = generate_nickname(1, 42, "uk")
    assert " " in en and " " in uk
    assert en != uk  # localized
    # Different room → (generally) different alias for the same user.
    assert generate_nickname(2, 42, "en") != en or generate_nickname(1, 43, "en") != en
    # Unknown locale falls back to EN.
    assert generate_nickname(1, 42, "fr") == en


# --- kick -----------------------------------------------------------------


async def test_kick_blocks_rejoin(db: AsyncSession) -> None:
    host = await _user(db, 1001)
    guest = await _user(db, 1002)
    code = await _room(db, host)
    room = await get_room_by_code(db, code)
    assert room is not None
    await join_room(db, room, guest)
    await db.flush()

    kicked = await kick_participant(db, room, host_id=host, target_user_id=guest)
    assert kicked.kicked_at is not None
    with pytest.raises(RoomServiceError) as exc:
        await join_room(db, room, guest)
    assert exc.value.code == "kicked"


async def test_kick_requires_host_and_not_self(db: AsyncSession) -> None:
    host = await _user(db, 1003)
    guest = await _user(db, 1004)
    code = await _room(db, host)
    room = await get_room_by_code(db, code)
    assert room is not None
    await join_room(db, room, guest)
    await db.flush()

    with pytest.raises(RoomServiceError) as e1:
        await kick_participant(db, room, host_id=guest, target_user_id=host)
    assert e1.value.code == "not_host"
    with pytest.raises(RoomServiceError) as e2:
        await kick_participant(db, room, host_id=host, target_user_id=host)
    assert e2.value.code == "cannot_kick_self"
    with pytest.raises(RoomServiceError) as e3:
        await kick_participant(db, room, host_id=host, target_user_id=999999)
    assert e3.value.code == "not_in_room"


# --- lock -----------------------------------------------------------------


async def test_lock_blocks_guest_join(db: AsyncSession) -> None:
    host = await _user(db, 1005)
    guest = await _user(db, 1006)
    code = await _room(db, host)
    room = await get_room_by_code(db, code)
    assert room is not None
    await update_room(db, room, user_id=host, patch={"is_locked": True})
    await db.flush()
    with pytest.raises(RoomServiceError) as exc:
        await join_room(db, room, guest)
    assert exc.value.code == "room_locked"
    # The host can still (re-)enter their own locked room.
    await join_room(db, room, host)


# --- anonymous mode -------------------------------------------------------


async def test_anonymous_mode_redacts_names(db: AsyncSession) -> None:
    host = await _user(db, 1007, lang="uk")
    guest = await _user(db, 1008)
    code = await _room(db, host)
    room = await get_room_by_code(db, code)
    assert room is not None
    await join_room(db, room, guest)
    await update_room(db, room, user_id=host, patch={"is_anonymous": True})
    await db.commit()

    fresh = await get_room_by_code(db, code)
    assert fresh is not None
    state = await build_room_state(db, fresh, current_user_id=host)
    names = {p.display_name for p in state.participants}
    assert "Real1007" not in names and "Real1008" not in names
    # Host's viewer language is UK → nicknames localized to UK.
    for p in state.participants:
        assert p.display_name == generate_nickname(fresh.id, p.user_id, "uk")


async def test_non_anonymous_shows_real_names(db: AsyncSession) -> None:
    host = await _user(db, 1009)
    code = await _room(db, host)
    room = await get_room_by_code(db, code)
    assert room is not None
    state = await build_room_state(db, room, current_user_id=host)
    assert state.participants[0].display_name == "Real1009"


# --- mid-room mode change -------------------------------------------------


async def test_join_approval_flow(db: AsyncSession) -> None:
    host = await _user(db, 1020)
    guest = await _user(db, 1021)
    code = await _room(db, host)
    room = await get_room_by_code(db, code)
    assert room is not None
    await update_room(db, room, user_id=host, patch={"requires_approval": True})
    await db.flush()

    # Guest joins → pending (not approved).
    p = await join_room(db, room, guest)
    await db.commit()
    assert p.approved is False

    fresh = await get_room_by_code(db, code)
    assert fresh is not None
    # Host's snapshot: pending guest is OUT of the roster, IN pending list.
    host_state = await build_room_state(db, fresh, current_user_id=host)
    assert guest not in [pp.user_id for pp in host_state.participants]
    assert guest in [pp.user_id for pp in host_state.pending_participants]
    # Guest's own snapshot: me_pending true, sees no pending list.
    guest_state = await build_room_state(db, fresh, current_user_id=guest)
    assert guest_state.me_pending is True
    assert guest_state.pending_participants == []

    # Approve → now a normal participant.
    await approve_participant(db, fresh, host_id=host, target_user_id=guest)
    await db.commit()
    after = await build_room_state(db, fresh, current_user_id=host)
    assert guest in [pp.user_id for pp in after.participants]
    assert after.pending_participants == []


async def test_approve_requires_host(db: AsyncSession) -> None:
    host = await _user(db, 1022)
    guest = await _user(db, 1023)
    code = await _room(db, host)
    room = await get_room_by_code(db, code)
    assert room is not None
    await update_room(db, room, user_id=host, patch={"requires_approval": True})
    await join_room(db, room, guest)
    await db.commit()
    with pytest.raises(RoomServiceError) as exc:
        await approve_participant(db, room, host_id=guest, target_user_id=guest)
    assert exc.value.code == "not_host"


async def test_join_without_approval_is_immediate(db: AsyncSession) -> None:
    host = await _user(db, 1024)
    guest = await _user(db, 1025)
    code = await _room(db, host)
    room = await get_room_by_code(db, code)
    assert room is not None
    room.requires_approval = False  # rooms now require approval by default
    await db.flush()
    p = await join_room(db, room, guest)
    await db.commit()
    assert p.approved is True


async def test_mode_change_resets_round_state(db: AsyncSession) -> None:
    host = await _user(db, 1010)
    code = await _room(db, host)  # classic
    room = await get_room_by_code(db, code)
    assert room is not None
    # Simulate progress that must be wiped on a mode switch.
    room.bon_attempts = 2
    room.bon_tally = {"5": 2}
    room.punishment_winner_user_id = host
    await db.flush()

    await update_room(db, room, user_id=host, patch={"game_mode": "punishment"})
    await db.commit()
    assert room.game_mode == "punishment"
    assert room.bon_attempts == 0
    assert room.bon_tally is None
    assert room.punishment_winner_user_id is None
    assert room.punishment_unique_bets is True
    assert room.punishment_deck == "mild"
