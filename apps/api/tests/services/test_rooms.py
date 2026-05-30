"""Tests for `hoba_api.services.rooms`."""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.models.participant import Participant
from hoba_api.models.question import Question
from hoba_api.models.segment import Segment
from hoba_api.services.rooms import (
    RoomServiceError,
    SegmentDraft,
    _derive_spin_policy,
    close_room,
    create_room,
    generate_room_code,
    get_room_by_code,
    update_room,
)


def _drafts(n: int = 3) -> list[SegmentDraft]:
    return [SegmentDraft(label=f"Option {i}", color_seed=i % 12) for i in range(n)]


async def _make_user(db: AsyncSession, tg_id: int) -> int:
    from hoba_api.auth.initdata import TelegramUser
    from hoba_api.services.users import upsert_from_telegram

    user = await upsert_from_telegram(
        db, TelegramUser(id=tg_id, first_name=f"User{tg_id}"),
    )
    await db.flush()
    return user.id


def test_room_code_format() -> None:
    code = generate_room_code()
    assert len(code) == 6
    assert all(c in "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" for c in code)


async def test_create_room_persists_full_graph(db: AsyncSession) -> None:
    host_id = await _make_user(db, tg_id=1)
    room = await create_room(
        db,
        host_id=host_id,
        question_text="Where to eat?",
        segments=_drafts(4),
        title="Lunch wheel",
    )
    await db.commit()

    assert room.code is not None
    assert len(room.code) == 6
    assert room.host_id == host_id
    assert room.status == "lobby"

    # Host should be a Participant
    participants = (
        (await db.execute(select(Participant).where(Participant.room_id == room.id)))
        .scalars()
        .all()
    )
    assert len(participants) == 1
    assert participants[0].role == "host"

    # One active Question
    questions = (
        (await db.execute(select(Question).where(Question.room_id == room.id)))
        .scalars()
        .all()
    )
    assert len(questions) == 1
    assert questions[0].text == "Where to eat?"
    assert questions[0].is_active is True

    # 4 Segments
    segments = (
        (
            await db.execute(
                select(Segment).where(
                    Segment.parent_id == questions[0].id,
                    Segment.parent_type == "question",
                ),
            )
        )
        .scalars()
        .all()
    )
    assert len(segments) == 4


async def test_create_room_rejects_too_few_segments(db: AsyncSession) -> None:
    host_id = await _make_user(db, tg_id=2)
    with pytest.raises(RoomServiceError) as exc:
        await create_room(
            db, host_id=host_id, question_text="x", segments=_drafts(1),
        )
    assert exc.value.code == "bad_segment_count"


async def test_create_room_rejects_empty_question(db: AsyncSession) -> None:
    host_id = await _make_user(db, tg_id=3)
    with pytest.raises(RoomServiceError) as exc:
        await create_room(
            db, host_id=host_id, question_text="   ", segments=_drafts(2),
        )
    assert exc.value.code == "empty_question"


async def test_get_room_by_code_case_insensitive(db: AsyncSession) -> None:
    host_id = await _make_user(db, tg_id=4)
    room = await create_room(
        db, host_id=host_id, question_text="?", segments=_drafts(2),
    )
    await db.commit()
    fetched = await get_room_by_code(db, room.code.lower())
    assert fetched is not None
    assert fetched.id == room.id


async def test_close_room_only_by_host(db: AsyncSession) -> None:
    host_id = await _make_user(db, tg_id=5)
    other_id = await _make_user(db, tg_id=6)
    room = await create_room(
        db, host_id=host_id, question_text="?", segments=_drafts(2),
    )
    await db.commit()

    with pytest.raises(RoomServiceError) as exc:
        await close_room(db, room, user_id=other_id)
    assert exc.value.code == "not_host"

    await close_room(db, room, user_id=host_id)
    await db.commit()
    assert room.status == "closed"
    assert room.closed_at is not None


async def test_update_room_host_only(db: AsyncSession) -> None:
    host_id = await _make_user(db, tg_id=7)
    other_id = await _make_user(db, tg_id=8)
    room = await create_room(
        db, host_id=host_id, question_text="?", segments=_drafts(2),
    )
    await db.commit()

    with pytest.raises(RoomServiceError) as exc:
        await update_room(db, room, user_id=other_id, patch={"title": "X"})
    assert exc.value.code == "not_host"

    await update_room(
        db, room, user_id=host_id, patch={"title": "Hello", "spin_policy": "anyone"},
    )
    await db.commit()
    assert room.title == "Hello"
    assert room.spin_policy == "anyone"


# --- update_room cursor lifecycle ------------------------------------------


async def test_update_room_to_turn_based_while_active_sets_cursor_to_host(
    db: AsyncSession,
) -> None:
    host_id = await _make_user(db, tg_id=201)
    room = await create_room(
        db, host_id=host_id, question_text="Q?", segments=_drafts(2),
        spin_policy="anyone",
    )
    room.status = "active"
    await db.flush()
    assert room.current_turn_user_id is None
    await update_room(
        db, room, user_id=host_id, patch={"spin_policy": "turn_based"},
    )
    assert room.spin_policy == "turn_based"
    assert room.current_turn_user_id == host_id


async def test_update_room_to_turn_based_while_in_lobby_leaves_cursor_null(
    db: AsyncSession,
) -> None:
    host_id = await _make_user(db, tg_id=202)
    room = await create_room(
        db, host_id=host_id, question_text="Q?", segments=_drafts(2),
        spin_policy="anyone",
    )
    # status stays "lobby" — first spin will seed cursor on lobby→active.
    await update_room(
        db, room, user_id=host_id, patch={"spin_policy": "turn_based"},
    )
    assert room.spin_policy == "turn_based"
    assert room.current_turn_user_id is None


async def test_update_room_away_from_turn_based_clears_cursor(
    db: AsyncSession,
) -> None:
    host_id = await _make_user(db, tg_id=203)
    room = await create_room(
        db, host_id=host_id, question_text="Q?", segments=_drafts(2),
        spin_policy="turn_based",
    )
    room.status = "active"
    room.current_turn_user_id = host_id
    await db.flush()
    await update_room(
        db, room, user_id=host_id, patch={"spin_policy": "anyone"},
    )
    assert room.spin_policy == "anyone"
    assert room.current_turn_user_id is None


async def test_update_room_game_mode_does_not_touch_cursor(
    db: AsyncSession,
) -> None:
    host_id = await _make_user(db, tg_id=204)
    room = await create_room(
        db, host_id=host_id, question_text="Q?", segments=_drafts(2),
        spin_policy="turn_based",
    )
    room.status = "active"
    room.current_turn_user_id = host_id
    await db.flush()
    await update_room(
        db, room, user_id=host_id, patch={"game_mode": "elimination"},
    )
    assert room.game_mode == "elimination"
    assert room.current_turn_user_id == host_id


# --- _derive_spin_policy ----------------------------------------------------


def test_derive_spin_policy_explicit_wins_for_classic() -> None:
    assert _derive_spin_policy("host_only", "classic") == "host_only"


def test_derive_spin_policy_explicit_wins_for_punishment() -> None:
    # Explicit value beats mode default even when mode is non-classic.
    assert _derive_spin_policy("anyone", "punishment") == "anyone"


def test_derive_spin_policy_default_for_classic() -> None:
    # No explicit spin_policy + classic mode → "anyone" (party-game default).
    assert _derive_spin_policy(None, "classic") == "anyone"


def test_derive_spin_policy_default_for_elimination() -> None:
    assert _derive_spin_policy(None, "elimination") == "host_only"


def test_derive_spin_policy_default_for_punishment() -> None:
    # Punishment is host-triggered (host spins after everyone locks a
    # prediction), so its default policy is host_only.
    assert _derive_spin_policy(None, "punishment") == "host_only"


def test_derive_spin_policy_default_for_chaos() -> None:
    assert _derive_spin_policy(None, "chaos") == "anyone"


def test_derive_spin_policy_default_for_rigged() -> None:
    assert _derive_spin_policy(None, "rigged") == "host_only"


# --- create_room with game_mode --------------------------------------------


async def test_create_room_with_game_mode_persists_field(db: AsyncSession) -> None:
    host_id = await _make_user(db, tg_id=101)
    room = await create_room(
        db,
        host_id=host_id,
        question_text="Q?",
        segments=_drafts(2),
        game_mode="elimination",
    )
    assert room.game_mode == "elimination"


async def test_create_room_punishment_defaults_to_host_only(db: AsyncSession) -> None:
    host_id = await _make_user(db, tg_id=102)
    room = await create_room(
        db,
        host_id=host_id,
        question_text="Q?",
        segments=_drafts(2),
        game_mode="punishment",
    )
    assert room.spin_policy == "host_only"


async def test_create_room_explicit_spin_policy_wins_over_mode(
    db: AsyncSession,
) -> None:
    host_id = await _make_user(db, tg_id=103)
    room = await create_room(
        db,
        host_id=host_id,
        question_text="Q?",
        segments=_drafts(2),
        game_mode="punishment",
        spin_policy="anyone",
    )
    assert room.spin_policy == "anyone"
    assert room.game_mode == "punishment"


async def test_create_room_classic_default_unchanged(db: AsyncSession) -> None:
    host_id = await _make_user(db, tg_id=104)
    room = await create_room(
        db,
        host_id=host_id,
        question_text="Q?",
        segments=_drafts(2),
    )
    assert room.game_mode == "classic"
    assert room.spin_policy == "anyone"


async def test_create_room_rejects_unknown_game_mode(db: AsyncSession) -> None:
    host_id = await _make_user(db, tg_id=105)
    with pytest.raises(RoomServiceError) as exc:
        await create_room(
            db,
            host_id=host_id,
            question_text="Q?",
            segments=_drafts(2),
            game_mode="not_a_mode",
        )
    assert exc.value.code == "bad_game_mode"


async def test_create_room_spin_count(db) -> None:  # type: ignore[no-untyped-def]
    import pytest

    from hoba_api.auth.initdata import TelegramUser
    from hoba_api.services.rooms import (
        RoomServiceError,
        SegmentDraft,
        create_room,
    )
    from hoba_api.services.users import upsert_from_telegram

    host = await upsert_from_telegram(db, TelegramUser(id=7800, first_name="H"))
    await db.flush()
    room = await create_room(
        db, host_id=host.id, question_text="Q?",
        segments=[SegmentDraft(label="a"), SegmentDraft(label="b")],
        spin_count=3,
    )
    assert room.spin_count == 3
    with pytest.raises(RoomServiceError) as exc:
        await create_room(
            db, host_id=host.id, question_text="Q?",
            segments=[SegmentDraft(label="a"), SegmentDraft(label="b")],
            spin_count=2,
        )
    assert exc.value.code == "bad_spin_count"
