"""Tests for `hoba_api.services.punishment` (prediction-wager logic).

Design: docs/superpowers/specs/2026-05-30-punishment-prediction-wager-design.md
"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.models.question import Question
from hoba_api.models.room import Room
from hoba_api.models.segment import Segment
from hoba_api.modes.punishment_decks import CARDS_PER_DECK
from hoba_api.services import punishment
from hoba_api.services.rooms import RoomServiceError, SegmentDraft, create_room


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


async def _segment_ids(db: AsyncSession, room: Room) -> list[int]:
    question = (
        await db.execute(
            select(Question).where(
                Question.room_id == room.id, Question.is_active.is_(True),
            ),
        )
    ).scalar_one()
    seg_ids = list(
        (
            await db.execute(
                select(Segment.id)
                .where(
                    Segment.parent_id == question.id,
                    Segment.parent_type == "question",
                )
                .order_by(Segment.position),
            )
        )
        .scalars()
        .all(),
    )
    return seg_ids


async def _make_punishment_room(
    db: AsyncSession, *, tg_base: int, segments: int = 4,
) -> tuple[Room, list[int]]:
    host_id = await _make_user(db, tg_id=tg_base)
    room = await create_room(
        db,
        host_id=host_id,
        question_text="?",
        segments=_drafts(segments),
        game_mode="punishment",
        punishment_deck="mild",
    )
    await db.commit()
    seg_ids = await _segment_ids(db, room)
    return room, seg_ids


# --- lock_prediction -------------------------------------------------------


async def test_lock_prediction_stores(db: AsyncSession) -> None:
    room, seg_ids = await _make_punishment_room(db, tg_base=100)

    await punishment.lock_prediction(db, room, user_id=7, segment_id=seg_ids[0])

    assert room.punishment_predictions == {"7": seg_ids[0]}


async def test_lock_prediction_overwrites_on_relock(db: AsyncSession) -> None:
    room, seg_ids = await _make_punishment_room(db, tg_base=110)

    await punishment.lock_prediction(db, room, user_id=7, segment_id=seg_ids[0])
    await punishment.lock_prediction(db, room, user_id=7, segment_id=seg_ids[1])

    assert room.punishment_predictions == {"7": seg_ids[1]}


async def test_lock_prediction_rejects_when_resolved(db: AsyncSession) -> None:
    room, seg_ids = await _make_punishment_room(db, tg_base=120)
    room.punishment_cards = {}
    await db.commit()

    with pytest.raises(RoomServiceError) as exc:
        await punishment.lock_prediction(db, room, user_id=7, segment_id=seg_ids[0])
    assert exc.value.code == "round_resolved"


async def test_lock_prediction_rejects_unknown_segment(db: AsyncSession) -> None:
    room, seg_ids = await _make_punishment_room(db, tg_base=130)
    bad_segment = max(seg_ids) + 9999

    with pytest.raises(RoomServiceError) as exc:
        await punishment.lock_prediction(db, room, user_id=7, segment_id=bad_segment)
    assert exc.value.code == "invalid_segment"


# --- drop_prediction -------------------------------------------------------


async def test_drop_prediction_removes(db: AsyncSession) -> None:
    room, seg_ids = await _make_punishment_room(db, tg_base=140)
    await punishment.lock_prediction(db, room, user_id=7, segment_id=seg_ids[0])
    await punishment.lock_prediction(db, room, user_id=8, segment_id=seg_ids[1])

    await punishment.drop_prediction(db, room, user_id=7)

    assert room.punishment_predictions == {"8": seg_ids[1]}


async def test_drop_prediction_empties_to_none(db: AsyncSession) -> None:
    room, seg_ids = await _make_punishment_room(db, tg_base=150)
    await punishment.lock_prediction(db, room, user_id=7, segment_id=seg_ids[0])

    await punishment.drop_prediction(db, room, user_id=7)

    assert room.punishment_predictions is None


async def test_drop_prediction_noop_when_absent(db: AsyncSession) -> None:
    room, seg_ids = await _make_punishment_room(db, tg_base=160)
    await punishment.lock_prediction(db, room, user_id=7, segment_id=seg_ids[0])

    await punishment.drop_prediction(db, room, user_id=999)

    assert room.punishment_predictions == {"7": seg_ids[0]}


# --- all_present_locked / waiting_on --------------------------------------


def test_all_present_locked_truth_table() -> None:
    preds = {"1": 10, "2": 11}
    assert punishment.all_present_locked(preds, {1, 2}) is True
    assert punishment.all_present_locked(preds, {1, 2, 3}) is False
    assert punishment.all_present_locked(preds, set()) is False
    assert punishment.all_present_locked(None, {1}) is False
    assert punishment.all_present_locked({}, {1}) is False
    # A locked id that's no longer present doesn't block.
    assert punishment.all_present_locked(preds, {1}) is True


def test_waiting_on_sorted_missing_ids() -> None:
    preds = {"2": 11}
    assert punishment.waiting_on(preds, {1, 2, 3}) == [1, 3]
    assert punishment.waiting_on(None, {3, 1, 2}) == [1, 2, 3]
    assert punishment.waiting_on(preds, {2}) == []
    assert punishment.waiting_on({}, set()) == []


# --- resolve_predictions ---------------------------------------------------


async def test_resolve_deals_card_to_each_loser(db: AsyncSession) -> None:
    room, seg_ids = await _make_punishment_room(db, tg_base=200)
    result = seg_ids[0]
    # 7 correct, 8 + 9 wrong.
    room.punishment_predictions = {
        "7": result,
        "8": seg_ids[1],
        "9": seg_ids[2],
    }
    await db.commit()

    cards = await punishment.resolve_predictions(
        db, room, result_segment_id=result, host_lang="en",
    )

    assert set(cards.keys()) == {"8", "9"}
    for entry in cards.values():
        assert entry["deck"] == "mild"
        assert entry["done"] is False
        assert isinstance(entry["text"], str) and entry["text"]
        assert isinstance(entry["card_index"], int)
    assert room.punishment_cards == cards
    assert room.punishment_result_segment_id == result


async def test_resolve_no_card_for_correct_guessers(db: AsyncSession) -> None:
    room, seg_ids = await _make_punishment_room(db, tg_base=210)
    result = seg_ids[0]
    room.punishment_predictions = {"7": result, "8": seg_ids[1]}
    await db.commit()

    cards = await punishment.resolve_predictions(
        db, room, result_segment_id=result, host_lang="en",
    )

    assert "7" not in cards
    assert "8" in cards


async def test_resolve_empty_when_everyone_correct(db: AsyncSession) -> None:
    room, seg_ids = await _make_punishment_room(db, tg_base=220)
    result = seg_ids[0]
    room.punishment_predictions = {"7": result, "8": result}
    await db.commit()

    cards = await punishment.resolve_predictions(
        db, room, result_segment_id=result, host_lang="en",
    )

    assert cards == {}
    assert room.punishment_cards == {}
    assert room.punishment_result_segment_id == result


async def test_resolve_distinct_cards_for_many_losers(db: AsyncSession) -> None:
    room, seg_ids = await _make_punishment_room(db, tg_base=230)
    result = seg_ids[0]
    # 7 losers, all wrong (predicting a non-result segment).
    wrong = seg_ids[1]
    room.punishment_predictions = {str(uid): wrong for uid in range(1, 8)}
    await db.commit()
    assert CARDS_PER_DECK >= 7  # all should fit within one deck

    cards = await punishment.resolve_predictions(
        db, room, result_segment_id=result, host_lang="en",
    )

    assert len(cards) == 7
    indices = [entry["card_index"] for entry in cards.values()]
    assert len(set(indices)) == 7  # all distinct


# --- mark_card_done --------------------------------------------------------


async def test_mark_card_done_flips_and_tallies(db: AsyncSession) -> None:
    room, seg_ids = await _make_punishment_room(db, tg_base=300)
    room.punishment_predictions = {"8": seg_ids[1]}
    await db.commit()
    await punishment.resolve_predictions(
        db, room, result_segment_id=seg_ids[0], host_lang="en",
    )
    assert room.punishment_done_count == 0

    ok = await punishment.mark_card_done(db, room, user_id=8)

    assert ok is True
    assert room.punishment_cards is not None
    assert room.punishment_cards["8"]["done"] is True
    assert room.punishment_done_count == 1


async def test_mark_card_done_false_for_unknown(db: AsyncSession) -> None:
    room, seg_ids = await _make_punishment_room(db, tg_base=310)
    room.punishment_predictions = {"8": seg_ids[1]}
    await db.commit()
    await punishment.resolve_predictions(
        db, room, result_segment_id=seg_ids[0], host_lang="en",
    )

    ok = await punishment.mark_card_done(db, room, user_id=999)

    assert ok is False
    assert room.punishment_done_count == 0


async def test_mark_card_done_false_when_already_done(db: AsyncSession) -> None:
    room, seg_ids = await _make_punishment_room(db, tg_base=320)
    room.punishment_predictions = {"8": seg_ids[1]}
    await db.commit()
    await punishment.resolve_predictions(
        db, room, result_segment_id=seg_ids[0], host_lang="en",
    )
    assert await punishment.mark_card_done(db, room, user_id=8) is True

    ok = await punishment.mark_card_done(db, room, user_id=8)

    assert ok is False
    assert room.punishment_done_count == 1


# --- reset_round -----------------------------------------------------------


async def test_reset_round_clears_fields_keeps_tally(db: AsyncSession) -> None:
    room, seg_ids = await _make_punishment_room(db, tg_base=400)
    room.punishment_predictions = {"8": seg_ids[1]}
    await db.commit()
    await punishment.resolve_predictions(
        db, room, result_segment_id=seg_ids[0], host_lang="en",
    )
    await punishment.mark_card_done(db, room, user_id=8)
    assert room.punishment_done_count == 1

    await punishment.reset_round(db, room)

    assert room.punishment_predictions is None
    assert room.punishment_cards is None
    assert room.punishment_result_segment_id is None
    assert room.punishment_done_count == 1  # tally persists across rounds
