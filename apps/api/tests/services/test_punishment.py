"""Tests for `hoba_api.services.punishment` (v3 turn-based personal-bet race).

See docs/game-modes.md for the current mechanic.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.models.participant import Participant
from hoba_api.models.question import Question
from hoba_api.models.room import Room
from hoba_api.models.segment import Segment
from hoba_api.redis_client import presence_set
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
    return list(
        (
            await db.execute(
                select(Segment.id)
                .where(
                    Segment.parent_id == question.id,
                    Segment.parent_type == "question",
                )
                .order_by(Segment.position),
            )
        ).scalars().all(),
    )


async def _make_room(
    db: AsyncSession, *, tg_base: int, players: int = 2, n: int = 3,
) -> tuple[Room, list[int], list[int]]:
    """Create a punishment room with `players` joined participants + N matches.

    Returns (room, segment_ids, user_ids). All users are marked present.
    """
    host_id = await _make_user(db, tg_id=tg_base)
    room = await create_room(
        db,
        host_id=host_id,
        question_text="?",
        segments=_drafts(4),
        game_mode="punishment",
        punishment_deck="mild",
        spin_count=n,
    )
    user_ids = [host_id]
    for i in range(1, players):
        uid = await _make_user(db, tg_id=tg_base + i)
        db.add(Participant(room_id=room.id, user_id=uid, role="guest"))
        user_ids.append(uid)
    await db.commit()
    for uid in user_ids:
        await presence_set(room.id, uid)
    seg_ids = await _segment_ids(db, room)
    return room, seg_ids, user_ids


# --- betting --------------------------------------------------------------


async def test_place_bet_stores_and_overwrites(db: AsyncSession) -> None:
    room, seg, users = await _make_room(db, tg_base=100)
    await punishment.place_bet(db, room, users[0], seg[0])
    assert room.punishment_predictions == {str(users[0]): seg[0]}
    await punishment.place_bet(db, room, users[0], seg[1])
    assert room.punishment_predictions == {str(users[0]): seg[1]}


async def test_place_bet_rejects_after_start(db: AsyncSession) -> None:
    room, seg, users = await _make_room(db, tg_base=110)
    room.status = "active"
    await db.commit()
    with pytest.raises(RoomServiceError) as exc:
        await punishment.place_bet(db, room, users[0], seg[0])
    assert exc.value.code == "game_started"


async def test_place_bet_rejects_unknown_segment(db: AsyncSession) -> None:
    room, seg, users = await _make_room(db, tg_base=120)
    with pytest.raises(RoomServiceError) as exc:
        await punishment.place_bet(db, room, users[0], max(seg) + 999)
    assert exc.value.code == "invalid_segment"


async def test_all_present_bet_truth_table() -> None:
    bets = {"1": 10, "2": 11}
    assert punishment.all_present_bet(bets, {1, 2}) is True
    assert punishment.all_present_bet(bets, {1, 2, 3}) is False
    assert punishment.all_present_bet(None, {1}) is False
    assert punishment.all_present_bet({}, set()) is False


# --- turn order + resolve -------------------------------------------------


async def test_start_game_seeds_first_bettor(db: AsyncSession) -> None:
    room, seg, users = await _make_room(db, tg_base=200)
    await punishment.place_bet(db, room, users[0], seg[0])
    await punishment.place_bet(db, room, users[1], seg[1])
    await punishment.start_game(db, room)
    assert room.current_turn_user_id in users


async def test_resolve_lucky_increments_and_advances(db: AsyncSession) -> None:
    room, seg, users = await _make_room(db, tg_base=210, n=3)
    await punishment.place_bet(db, room, users[0], seg[0])
    await punishment.place_bet(db, room, users[1], seg[1])
    await punishment.start_game(db, room)
    spinner = room.current_turn_user_id
    assert spinner is not None
    bet = room.punishment_predictions[str(spinner)]

    outcome = await punishment.resolve_turn(
        db, room, spinner, result_segment_id=bet, host_lang="en",
    )

    assert outcome["kind"] == "lucky"
    assert room.punishment_match_counts == {str(spinner): 1}
    assert room.current_turn_user_id != spinner  # advanced
    assert room.punishment_winner_user_id is None


async def test_resolve_miss_deals_card_and_holds_turn(db: AsyncSession) -> None:
    room, seg, users = await _make_room(db, tg_base=220, n=3)
    await punishment.place_bet(db, room, users[0], seg[0])
    await punishment.place_bet(db, room, users[1], seg[1])
    await punishment.start_game(db, room)
    spinner = room.current_turn_user_id
    assert spinner is not None
    missed = seg[2]  # not anyone's bet

    outcome = await punishment.resolve_turn(
        db, room, spinner, result_segment_id=missed, host_lang="en",
    )

    assert outcome["kind"] == "punish"
    card = outcome["card"]
    assert isinstance(card, dict) and card["text"]
    assert outcome["resolved"] is False
    assert room.current_turn_user_id == spinner  # turn HELD until resolved


async def test_resolve_lucky_to_n_sets_winner(db: AsyncSession) -> None:
    room, seg, users = await _make_room(db, tg_base=230, n=3)
    await punishment.place_bet(db, room, users[0], seg[0])
    await punishment.place_bet(db, room, users[1], seg[1])
    await punishment.start_game(db, room)
    winner = users[0]
    # Already at N-1 matches; one more lucky hit wins.
    room.punishment_match_counts = {str(winner): 2}
    room.current_turn_user_id = winner
    await db.commit()

    await punishment.resolve_turn(db, room, winner, seg[0], "en")

    assert room.punishment_match_counts[str(winner)] == 3
    assert room.punishment_winner_user_id == winner


# --- resolve_punishment (done / refuse) -----------------------------------


async def test_done_advances_and_counts_dare(db: AsyncSession) -> None:
    room, seg, users = await _make_room(db, tg_base=300, n=3)
    await punishment.place_bet(db, room, users[0], seg[0])
    await punishment.place_bet(db, room, users[1], seg[1])
    await punishment.start_game(db, room)
    spinner = room.current_turn_user_id
    assert spinner is not None
    await punishment.resolve_turn(db, room, spinner, seg[2], "en")  # miss

    ok = await punishment.resolve_punishment(db, room, spinner, refuse=False)

    assert ok is True
    assert room.punishment_done_count == 1
    assert room.punishment_last_outcome is not None
    assert room.punishment_last_outcome["resolved"] is True
    assert room.current_turn_user_id != spinner  # advanced


async def test_refuse_decrements_count(db: AsyncSession) -> None:
    room, seg, users = await _make_room(db, tg_base=310, n=3)
    await punishment.place_bet(db, room, users[0], seg[0])
    await punishment.place_bet(db, room, users[1], seg[1])
    await punishment.start_game(db, room)
    spinner = room.current_turn_user_id
    assert spinner is not None
    # First earn a point (land on the spinner's own bet) so refuse is allowed.
    own_bet = room.punishment_predictions[str(spinner)]
    await punishment.resolve_turn(db, room, spinner, own_bet, "en")
    room.current_turn_user_id = spinner
    await db.commit()
    await punishment.resolve_turn(db, room, spinner, seg[2], "en")  # miss
    assert room.punishment_match_counts[str(spinner)] == 1

    ok = await punishment.resolve_punishment(db, room, spinner, refuse=True)

    assert ok is True
    assert room.punishment_match_counts[str(spinner)] == 0
    assert room.punishment_done_count == 0  # refusal isn't a performed dare


async def test_refuse_blocked_at_zero(db: AsyncSession) -> None:
    room, seg, users = await _make_room(db, tg_base=320, n=3)
    await punishment.place_bet(db, room, users[0], seg[0])
    await punishment.place_bet(db, room, users[1], seg[1])
    await punishment.start_game(db, room)
    spinner = room.current_turn_user_id
    assert spinner is not None
    await punishment.resolve_turn(db, room, spinner, seg[2], "en")  # miss, count 0

    with pytest.raises(RoomServiceError) as exc:
        await punishment.resolve_punishment(db, room, spinner, refuse=True)
    assert exc.value.code == "cannot_refuse"


async def test_resolve_punishment_noop_for_non_pending(db: AsyncSession) -> None:
    room, seg, users = await _make_room(db, tg_base=330, n=3)
    await punishment.place_bet(db, room, users[0], seg[0])
    await punishment.place_bet(db, room, users[1], seg[1])
    await punishment.start_game(db, room)

    ok = await punishment.resolve_punishment(db, room, users[0], refuse=False)

    assert ok is False


# --- reset_game -----------------------------------------------------------


async def test_reset_game_clears_round_keeps_done_count(db: AsyncSession) -> None:
    room, seg, users = await _make_room(db, tg_base=400, n=3)
    await punishment.place_bet(db, room, users[0], seg[0])
    await punishment.place_bet(db, room, users[1], seg[1])
    await punishment.start_game(db, room)
    spinner = room.current_turn_user_id
    assert spinner is not None
    await punishment.resolve_turn(db, room, spinner, seg[2], "en")
    await punishment.resolve_punishment(db, room, spinner, refuse=False)
    assert room.punishment_done_count == 1
    room.status = "active"

    await punishment.reset_game(db, room)

    assert room.punishment_predictions is None
    assert room.punishment_match_counts is None
    assert room.punishment_winner_user_id is None
    assert room.punishment_last_outcome is None
    assert room.current_turn_user_id is None
    assert room.status == "lobby"
    assert room.punishment_done_count == 1  # cumulative stat persists
