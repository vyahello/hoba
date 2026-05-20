"""Tests for `hoba_api.services.rooms`."""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.models.participant import Participant
from hoba_api.models.question import Question
from hoba_api.models.room import Room
from hoba_api.models.segment import Segment
from hoba_api.services.rooms import (
    RoomServiceError,
    SegmentDraft,
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
