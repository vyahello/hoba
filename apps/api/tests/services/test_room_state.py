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


async def test_build_room_state_exposes_public_punishment_state(
    db: AsyncSession,
) -> None:
    """v3: bets, match counts, winner and last outcome are all PUBLIC."""
    host = await upsert_from_telegram(db, TelegramUser(id=9101, first_name="H"))
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
    fetched.punishment_match_counts = {"1": 2}
    fetched.punishment_winner_user_id = 1
    fetched.punishment_last_outcome = {
        "spinner_id": 1,
        "result_segment_id": 10,
        "kind": "lucky",
        "card": None,
        "resolved": True,
    }
    await db.commit()

    state = await build_room_state(db, fetched, current_user_id=2)

    assert state.room.punishment_bets == {"1": 10, "2": 11}
    assert state.room.punishment_match_counts == {"1": 2}
    assert state.room.punishment_winner_user_id == 1
    assert state.room.punishment_last_outcome is not None
    assert state.room.punishment_last_outcome.kind == "lucky"


async def test_build_room_state_exposes_punish_card_outcome(
    db: AsyncSession,
) -> None:
    host = await upsert_from_telegram(db, TelegramUser(id=9201, first_name="H"))
    await db.flush()
    room = await create_room(
        db, host_id=host.id, question_text="Q?",
        segments=[SegmentDraft(label="a"), SegmentDraft(label="b")],
        game_mode="punishment",
    )
    await db.commit()
    fetched = await get_room_by_code(db, room.code)
    assert fetched is not None
    fetched.punishment_last_outcome = {
        "spinner_id": 2,
        "result_segment_id": 11,
        "kind": "punish",
        "card": {"text": "do a dance", "deck": "mild", "card_index": 3},
        "resolved": False,
    }
    await db.commit()

    state = await build_room_state(db, fetched, current_user_id=2)

    outcome = state.room.punishment_last_outcome
    assert outcome is not None
    assert outcome.kind == "punish"
    assert outcome.card is not None
    assert outcome.card.text == "do a dance"
    assert outcome.resolved is False


async def test_bot_appears_in_standings(db: AsyncSession) -> None:
    """When the solo bot is in the race, build_room_state must inject it as a
    participant (this is the path the lock PATCH returns — guard the 500)."""
    from hoba_api.bot import BOT_USER_ID

    host = await upsert_from_telegram(db, TelegramUser(id=9300, first_name="Solo"))
    await db.flush()
    room = await create_room(
        db, host_id=host.id, question_text="Chaos?",
        segments=[SegmentDraft(label="a"), SegmentDraft(label="b"), SegmentDraft(label="c")],
        game_mode="chaos", spin_count=3,
    )
    # Simulate post-start state: host + bot have bets, game active, locked.
    from hoba_api.services.punishment import _active_segment_ids
    seg = sorted(await _active_segment_ids(db, room))
    room.punishment_predictions = {str(host.id): seg[0], str(BOT_USER_ID): seg[1]}
    room.status = "active"
    room.is_locked = True
    room.current_turn_user_id = BOT_USER_ID
    # A Chaos/bot miss → kind "miss". This is what 500'd build_room_state
    # (PunishmentOutcomeOut rejected "miss") on e.g. the lock PATCH.
    room.punishment_last_outcome = {
        "spinner_id": host.id,
        "result_segment_id": seg[2],
        "kind": "miss",
        "card": None,
        "resolved": True,
        "pending_approval": False,
        "approver_user_id": None,
    }
    await db.commit()

    fetched = await get_room_by_code(db, room.code)
    assert fetched is not None
    state = await build_room_state(db, fetched, current_user_id=host.id)

    assert state.room.punishment_last_outcome is not None
    assert state.room.punishment_last_outcome.kind == "miss"
    ids = {p.user_id for p in state.participants}
    assert BOT_USER_ID in ids
    bot = next(p for p in state.participants if p.user_id == BOT_USER_ID)
    assert bot.display_name  # has a name
