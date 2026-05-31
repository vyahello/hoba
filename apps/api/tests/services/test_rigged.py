"""Rigged Mode 🎭 (spec §5.5) — host weighting, secrecy redaction, RNG fairness."""

from __future__ import annotations

import random

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.models.participant import Participant
from hoba_api.services.rigged import reveal_rig, set_rig_weights
from hoba_api.services.room_state import build_room_state
from hoba_api.services.rooms import (
    RoomServiceError,
    SegmentDraft,
    create_room,
    get_room_by_code,
)
from hoba_api.services.spins import trigger_spin
from hoba_api.wheel.spin_math import pick_segment_index


def _drafts(n: int) -> list[SegmentDraft]:
    return [SegmentDraft(label=f"S{i}", color_seed=i % 12) for i in range(n)]


async def _make_user(db: AsyncSession, tg_id: int) -> int:
    from hoba_api.auth.initdata import TelegramUser
    from hoba_api.services.users import upsert_from_telegram

    user = await upsert_from_telegram(db, TelegramUser(id=tg_id, first_name=f"U{tg_id}"))
    await db.flush()
    return user.id


async def _seg_ids(db: AsyncSession, room_id: int) -> list[int]:
    from sqlalchemy import select

    from hoba_api.models.question import Question
    from hoba_api.models.segment import Segment

    q = (
        await db.execute(select(Question).where(Question.room_id == room_id))
    ).scalar_one()
    rows = (
        await db.execute(
            select(Segment)
            .where(Segment.parent_id == q.id, Segment.parent_type == "question")
            .order_by(Segment.position),
        )
    ).scalars().all()
    return [s.id for s in rows]


async def test_set_rig_weights_requires_host(db: AsyncSession) -> None:
    host_id = await _make_user(db, tg_id=700)
    guest_id = await _make_user(db, tg_id=701)
    room = await create_room(db, host_id=host_id, question_text="?", segments=_drafts(3))
    await db.commit()
    seg = await _seg_ids(db, room.id)
    with pytest.raises(RoomServiceError) as exc:
        await set_rig_weights(db, room, user_id=guest_id, weights={seg[0]: 90})
    assert exc.value.code == "not_host"


async def test_set_rig_weights_sets_weights_and_mode(db: AsyncSession) -> None:
    host_id = await _make_user(db, tg_id=702)
    room = await create_room(db, host_id=host_id, question_text="?", segments=_drafts(3))
    await db.commit()
    seg = await _seg_ids(db, room.id)
    await set_rig_weights(db, room, user_id=host_id, weights={seg[0]: 80, seg[1]: 0})
    await db.commit()
    # Host view: real mode + weights. Re-fetch via get_room_by_code so the
    # questions/segments relationships are loaded (async forbids lazy-load),
    # mirroring how the REST endpoints call build_room_state.
    room = await get_room_by_code(db, room.code)
    assert room is not None
    state = await build_room_state(db, room, current_user_id=host_id)
    assert state.room.game_mode == "rigged"
    weights = {s.id: s.weight for s in state.active_question.segments}
    assert weights[seg[0]] == 80
    assert weights[seg[1]] == 0


async def test_set_rig_weights_rejects_all_zero(db: AsyncSession) -> None:
    host_id = await _make_user(db, tg_id=703)
    room = await create_room(db, host_id=host_id, question_text="?", segments=_drafts(2))
    await db.commit()
    seg = await _seg_ids(db, room.id)
    with pytest.raises(RoomServiceError) as exc:
        await set_rig_weights(db, room, user_id=host_id, weights={seg[0]: 0, seg[1]: 0})
    assert exc.value.code == "bad_weight"


async def test_set_rig_weights_rejects_bad_inputs(db: AsyncSession) -> None:
    host_id = await _make_user(db, tg_id=704)
    room = await create_room(db, host_id=host_id, question_text="?", segments=_drafts(2))
    await db.commit()
    seg = await _seg_ids(db, room.id)
    with pytest.raises(RoomServiceError) as exc:
        await set_rig_weights(db, room, user_id=host_id, weights={seg[0]: 200})
    assert exc.value.code == "bad_weight"
    with pytest.raises(RoomServiceError) as exc2:
        await set_rig_weights(db, room, user_id=host_id, weights={999999: 50})
    assert exc2.value.code == "invalid_segment"


async def test_rig_is_hidden_from_guests_until_reveal(db: AsyncSession) -> None:
    host_id = await _make_user(db, tg_id=705)
    guest_id = await _make_user(db, tg_id=706)
    room = await create_room(db, host_id=host_id, question_text="?", segments=_drafts(3))
    db.add(Participant(room_id=room.id, user_id=guest_id, role="guest"))
    await db.commit()
    seg = await _seg_ids(db, room.id)
    await set_rig_weights(db, room, user_id=host_id, weights={seg[0]: 95, seg[1]: 5, seg[2]: 0})
    await db.commit()

    # Guest sees a plain Classic room — no rigged mode, uniform weights.
    room = await get_room_by_code(db, room.code)
    assert room is not None
    guest_state = await build_room_state(db, room, current_user_id=guest_id)
    assert guest_state.room.game_mode == "classic"
    assert all(s.weight == 1 for s in guest_state.active_question.segments)

    # After the host reveals, the rig is exposed to everyone.
    room.rigged_revealed = True
    await db.commit()
    room = await get_room_by_code(db, room.code)
    assert room is not None
    revealed = await build_room_state(db, room, current_user_id=guest_id)
    assert revealed.room.game_mode == "rigged"
    weights = {s.id: s.weight for s in revealed.active_question.segments}
    assert weights[seg[0]] == 95


async def test_reveal_requires_host_and_rigged(db: AsyncSession) -> None:
    host_id = await _make_user(db, tg_id=710)
    guest_id = await _make_user(db, tg_id=711)
    room = await create_room(db, host_id=host_id, question_text="?", segments=_drafts(2))
    await db.commit()
    # Not rigged yet → can't reveal.
    with pytest.raises(RoomServiceError) as exc:
        await reveal_rig(db, room, user_id=host_id)
    assert exc.value.code == "not_rigged"
    # Rig it, then a non-host can't reveal.
    seg = await _seg_ids(db, room.id)
    await set_rig_weights(db, room, user_id=host_id, weights={seg[0]: 90})
    with pytest.raises(RoomServiceError) as exc2:
        await reveal_rig(db, room, user_id=guest_id)
    assert exc2.value.code == "not_host"


async def test_reveal_unredacts_and_stamps_title(db: AsyncSession) -> None:
    host_id = await _make_user(db, tg_id=712)
    guest_id = await _make_user(db, tg_id=713)
    room = await create_room(
        db, host_id=host_id, question_text="?", segments=_drafts(3), title="Lunch",
    )
    db.add(Participant(room_id=room.id, user_id=guest_id, role="guest"))
    await db.commit()
    seg = await _seg_ids(db, room.id)
    await set_rig_weights(db, room, user_id=host_id, weights={seg[0]: 90, seg[1]: 10})
    await reveal_rig(db, room, user_id=host_id)
    await db.commit()

    room = await get_room_by_code(db, room.code)
    assert room is not None
    guest_state = await build_room_state(db, room, current_user_id=guest_id)
    assert guest_state.room.game_mode == "rigged"
    assert guest_state.room.rigged_revealed is True
    assert "🎭" in (guest_state.room.title or "")
    weights = {s.id: s.weight for s in guest_state.active_question.segments}
    assert weights[seg[0]] == 90


async def test_rigged_spin_count_increments_and_is_redacted(db: AsyncSession) -> None:
    host_id = await _make_user(db, tg_id=714)
    guest_id = await _make_user(db, tg_id=715)
    room = await create_room(db, host_id=host_id, question_text="?", segments=_drafts(3))
    db.add(Participant(room_id=room.id, user_id=guest_id, role="guest"))
    await db.commit()
    seg = await _seg_ids(db, room.id)
    await set_rig_weights(db, room, user_id=host_id, weights={seg[0]: 100, seg[1]: 0, seg[2]: 0})
    await trigger_spin(db, room=room, user_id=host_id)
    await trigger_spin(db, room=room, user_id=host_id)
    await db.commit()

    room = await get_room_by_code(db, room.code)
    assert room is not None
    host_state = await build_room_state(db, room, current_user_id=host_id)
    assert host_state.room.rigged_spin_count == 2
    # Hidden from guests pre-reveal (would otherwise leak the rig).
    guest_state = await build_room_state(db, room, current_user_id=guest_id)
    assert guest_state.room.rigged_spin_count == 0


def test_weighted_rng_stays_within_two_percent() -> None:
    # CI fairness guard (roadmap Stage E): a heavily weighted segment must
    # actually land at ~its declared share, within ±2% over many spins.
    weights = [70.0, 20.0, 10.0]
    total = sum(weights)
    rng = random.Random(20260531).random
    n = 40000
    counts = [0, 0, 0]
    for _ in range(n):
        counts[pick_segment_index(3, rng, weights)] += 1
    for i, w in enumerate(weights):
        observed = counts[i] / n
        expected = w / total
        assert abs(observed - expected) < 0.02, (i, observed, expected)
