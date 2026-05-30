"""Coverage for build_room_state — participant display names.

Regression guard: `Participant.display_name` is never populated at
write time, so the snapshot must derive each participant's name from
the joined `User.first_name`. Without this the client only ever sees
null names (e.g. the turn status line falls back to the generic
"waiting for next player" instead of "waiting for {name}").
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.auth.initdata import TelegramUser
from hoba_api.models.participant import Participant
from hoba_api.services.room_state import build_room_state
from hoba_api.services.rooms import SegmentDraft, create_room, get_room_by_code
from hoba_api.services.users import upsert_from_telegram


async def test_participants_carry_user_first_name(db: AsyncSession) -> None:
    host = await upsert_from_telegram(
        db, TelegramUser(id=9001, first_name="Volodymyr"),
    )
    await db.flush()
    room = await create_room(
        db,
        host_id=host.id,
        question_text="Q?",
        segments=[SegmentDraft(label="a"), SegmentDraft(label="b")],
    )
    guest = await upsert_from_telegram(
        db, TelegramUser(id=9002, first_name="Anna"),
    )
    await db.flush()
    db.add(Participant(room_id=room.id, user_id=guest.id, role="guest"))
    await db.commit()

    fetched = await get_room_by_code(db, room.code)
    assert fetched is not None
    state = await build_room_state(db, fetched, current_user_id=host.id)

    names = {p.user_id: p.display_name for p in state.participants}
    assert names[host.id] == "Volodymyr"
    assert names[guest.id] == "Anna"


async def test_segment_out_carries_is_eliminated(db: AsyncSession) -> None:
    from datetime import UTC, datetime

    from hoba_api.models.segment import Segment

    host = await upsert_from_telegram(db, TelegramUser(id=9101, first_name="H"))
    await db.flush()
    room = await create_room(
        db, host_id=host.id, question_text="Q?",
        segments=[SegmentDraft(label="a"), SegmentDraft(label="b")],
    )
    await db.commit()
    fetched = await get_room_by_code(db, room.code)
    assert fetched is not None
    # Eliminate the first segment directly.
    q = next(qq for qq in fetched.questions if qq.is_active)
    seg = (await db.execute(
        select(Segment).where(Segment.parent_id == q.id,
                              Segment.parent_type == "question")
        .order_by(Segment.position)
    )).scalars().first()
    seg.eliminated_at = datetime.now(UTC)
    await db.commit()

    state = await build_room_state(db, fetched, current_user_id=host.id)
    flags = {s.id: s.is_eliminated for s in state.active_question.segments}
    assert flags[seg.id] is True
    assert sum(1 for v in flags.values() if not v) == 1


async def test_room_out_exposes_punishment_fields(db: AsyncSession) -> None:
    host = await upsert_from_telegram(db, TelegramUser(id=7710, first_name="H"))
    await db.flush()
    room = await create_room(
        db, host_id=host.id, question_text="Q?",
        segments=[SegmentDraft(label="a"), SegmentDraft(label="b")],
        game_mode="punishment",
    )
    await db.commit()
    fetched = await get_room_by_code(db, room.code)
    assert fetched is not None
    state = await build_room_state(db, fetched, current_user_id=host.id)
    assert state.room.punishment_deck == "mild"
    assert state.room.punishment_done_count == 0


async def test_build_room_state_redacts_predictions_while_predicting(
    db: AsyncSession,
) -> None:
    host = await upsert_from_telegram(db, TelegramUser(id=7720, first_name="H"))
    await db.flush()
    room = await create_room(
        db, host_id=host.id, question_text="Q?",
        segments=[SegmentDraft(label="a"), SegmentDraft(label="b")],
        game_mode="punishment",
    )
    await db.commit()
    fetched = await get_room_by_code(db, room.code)
    assert fetched is not None
    fetched.punishment_predictions = {"1": 10, "2": 11}
    fetched.punishment_cards = None
    await db.commit()

    state = await build_room_state(db, fetched, current_user_id=2)
    assert state.room.punishment_locked_user_ids == [1, 2]
    assert state.room.punishment_my_prediction == 11
    # Other players' picks must stay hidden while predicting.
    assert state.room.punishment_predictions is None
    assert state.room.punishment_result_segment_id is None
    assert state.room.punishment_cards is None


async def test_build_room_state_reveals_predictions_when_resolved(
    db: AsyncSession,
) -> None:
    host = await upsert_from_telegram(db, TelegramUser(id=7730, first_name="H"))
    await db.flush()
    room = await create_room(
        db, host_id=host.id, question_text="Q?",
        segments=[SegmentDraft(label="a"), SegmentDraft(label="b")],
        game_mode="punishment",
    )
    await db.commit()
    fetched = await get_room_by_code(db, room.code)
    assert fetched is not None
    fetched.punishment_predictions = {"1": 10, "2": 11}
    fetched.punishment_cards = {
        "1": {"text": "x", "deck": "mild", "card_index": 0, "done": False},
    }
    fetched.punishment_result_segment_id = 11
    await db.commit()

    state = await build_room_state(db, fetched, current_user_id=2)
    assert state.room.punishment_predictions == {"1": 10, "2": 11}
    assert state.room.punishment_result_segment_id == 11
    assert state.room.punishment_cards is not None
    assert state.room.punishment_cards["1"].text == "x"
    # No longer needed once revealed.
    assert state.room.punishment_my_prediction is None
