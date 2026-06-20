"""Tests for `hoba_api.services.spins`."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.models.room import Room
from hoba_api.models.segment import Segment
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


def _chaos_roll(event: str) -> Callable[[], float]:
    """An `_rng` for ChaosEngine that forces `event` on a fresh spin
    (candidates == all events). Index-derived, so it stays correct as the
    CHAOS_EVENTS set grows."""
    from hoba_api.modes.chaos import CHAOS_EVENTS

    return lambda: (CHAOS_EVENTS.index(event) + 0.5) / len(CHAOS_EVENTS)


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
    spin_policy: str,
    *,
    host_id: int = 1,
    current_turn: int | None = None,
    status: str = "active",
) -> Room:
    room = Room(
        code="ABC123",
        host_id=host_id,
        status=status,
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


def test_user_can_spin_turn_based_cursor_null_active_denies_everyone() -> None:
    # Active room whose cursor was cleared (advance_turn found no one
    # online) → no one is "the current turn", including the host.
    room = _make_room("turn_based", host_id=1, current_turn=None, status="active")
    assert user_can_spin(room, user_id=1) is False
    assert user_can_spin(room, user_id=99) is False


def test_user_can_spin_turn_based_lobby_null_cursor_allows_host() -> None:
    # Pre-first-spin: a turn_based lobby has a null cursor until the first
    # spin seeds it to host_id. The host must be allowed to kick off,
    # because on_spin_trigger runs this permission check BEFORE
    # trigger_spin gets a chance to seed the cursor — otherwise the room
    # can never start (regression: "Only the host can spin right now"
    # rejecting the host's own first spin).
    room = _make_room("turn_based", host_id=1, current_turn=None, status="lobby")
    assert user_can_spin(room, user_id=1) is True
    assert user_can_spin(room, user_id=99) is False


def test_user_can_spin_unknown_policy_denies() -> None:
    room = _make_room("not_a_policy", host_id=1)
    assert user_can_spin(room, user_id=1) is False


async def test_trigger_spin_sets_initial_cursor_on_lobby_to_active_turn_based(
    db: AsyncSession,
) -> None:
    """Host's first spin in a turn_based room sets cursor = host_id."""
    host_id = await _make_user(db, tg_id=51)
    room = await create_room(
        db,
        host_id=host_id,
        question_text="Q?",
        segments=_drafts(2),
        spin_policy="turn_based",
    )
    assert room.status == "lobby"
    assert room.current_turn_user_id is None
    await trigger_spin(db, room=room, user_id=host_id)
    assert room.status == "active"
    assert room.current_turn_user_id == host_id


async def test_trigger_spin_elimination_spins_over_living_only(
    db: AsyncSession,
) -> None:
    host_id = await _make_user(db, tg_id=300)
    room = await create_room(
        db, host_id=host_id, question_text="Q?",
        segments=_drafts(3), spin_policy="anyone", game_mode="elimination",
    )
    await db.refresh(room, ["questions"])
    q = next(qq for qq in room.questions if qq.is_active)
    segs = (await db.execute(
        select(Segment).where(Segment.parent_id == q.id,
                              Segment.parent_type == "question")
        .order_by(Segment.position)
    )).scalars().all()
    segs[0].eliminated_at = datetime.now(UTC)  # only 2 living
    await db.flush()

    spin = await trigger_spin(db, room=room, user_id=host_id)
    # Winner must be one of the living segments, never the eliminated one.
    assert spin.result_segment_id in {segs[1].id, segs[2].id}
    # 2 living -> dramatic multiplier baked into stored duration.
    assert spin.mode_state_snapshot["mode_effects"] == {"dramatic": True}


async def test_trigger_spin_elimination_rejects_when_one_living(
    db: AsyncSession,
) -> None:
    host_id = await _make_user(db, tg_id=301)
    room = await create_room(
        db, host_id=host_id, question_text="Q?",
        segments=_drafts(2), spin_policy="anyone", game_mode="elimination",
    )
    await db.refresh(room, ["questions"])
    q = next(qq for qq in room.questions if qq.is_active)
    segs = (await db.execute(
        select(Segment).where(Segment.parent_id == q.id,
                              Segment.parent_type == "question")
        .order_by(Segment.position)
    )).scalars().all()
    segs[0].eliminated_at = datetime.now(UTC)  # 1 living
    await db.flush()
    with pytest.raises(RoomServiceError) as exc:
        await trigger_spin(db, room=room, user_id=host_id)
    assert exc.value.code == "too_few_segments"


async def test_trigger_spin_punishment_is_normal_spin(
    db: AsyncSession,
) -> None:
    # Punishment v2: the spin itself is a normal spin — no card is drawn
    # at trigger (the draw moved to settle via resolve_predictions), and
    # the snapshot no longer carries a "punishment" block.
    host_id = await _make_user(db, tg_id=400)
    room = await create_room(
        db, host_id=host_id, question_text="Q?", segments=_drafts(3),
        spin_policy="anyone", game_mode="punishment", punishment_deck="mild",
    )
    await db.commit()
    spin = await trigger_spin(db, room=room, user_id=host_id)
    await db.commit()
    assert "punishment" not in spin.mode_state_snapshot
    assert room.punishment_cards is None


async def test_trigger_spin_chaos_reverse_flips_angle_backward(
    db: AsyncSession, monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Force the chaos engine to roll "reverse" (idx 2 of 8 → roll in
    # [0.25, 0.375)). The service must re-target the final angle below the
    # start so the wheel animates counter-clockwise, still landing a valid
    # sector.
    from hoba_api.modes.registry import engine_for

    monkeypatch.setattr(engine_for("chaos"), "_rng", _chaos_roll("reverse"))
    host_id = await _make_user(db, tg_id=600)
    room = await create_room(
        db, host_id=host_id, question_text="Q?", segments=_drafts(4),
        spin_policy="anyone", game_mode="chaos",
    )
    await db.commit()
    spin = await trigger_spin(db, room=room, user_id=host_id)
    await db.commit()
    assert spin.mode_state_snapshot["mode_effects"] == {"chaos_event": "reverse"}
    # Started at 0, so a CCW spin of ≥5 turns lands well below zero.
    assert spin.final_angle_deg <= -5 * 360
    assert 0 <= segment_under_pointer(spin.final_angle_deg, 4) < 4


async def test_trigger_spin_chaos_nudge_changes_result_and_records_pre_angle(
    db: AsyncSession, monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Force "nudge_fwd" (idx 4 of 8 → roll in [0.5, 0.625)). The recorded
    # result must be one sector forward of the natural landing, and the
    # pre-nudge stop angle must be carried for the client choreography.
    from hoba_api.modes.registry import engine_for

    monkeypatch.setattr(engine_for("chaos"), "_rng", _chaos_roll("nudge_fwd"))
    host_id = await _make_user(db, tg_id=601)
    room = await create_room(
        db, host_id=host_id, question_text="Q?", segments=_drafts(4),
        spin_policy="anyone", game_mode="chaos",
    )
    await db.commit()
    spin = await trigger_spin(db, room=room, user_id=host_id)
    await db.commit()
    effects = spin.mode_state_snapshot["mode_effects"]
    assert effects["chaos_event"] == "nudge_fwd"
    pre_angle = effects["nudge_from_angle"]
    sector = 360.0 / 4
    # Final angle is one sector below the pre-nudge stop (forward = pointer
    # advances one segment), and lands on a valid sector.
    assert abs(spin.final_angle_deg - (pre_angle - sector)) < 1e-6
    assert 0 <= segment_under_pointer(spin.final_angle_deg, 4) < 4


async def test_trigger_spin_chaos_slow_burn_trims_turns(
    db: AsyncSession, monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Force "slow_burn" (idx 1 of 8 → roll in [0.125, 0.25)). The spin should
    # travel only a few turns (not the usual ≥5) so the slow duration reads as
    # a crawl, while still landing a valid sector.
    from hoba_api.modes.chaos import SLOW_BURN_TURNS
    from hoba_api.modes.registry import engine_for

    monkeypatch.setattr(engine_for("chaos"), "_rng", _chaos_roll("slow_burn"))
    host_id = await _make_user(db, tg_id=603)
    room = await create_room(
        db, host_id=host_id, question_text="Q?", segments=_drafts(4),
        spin_policy="anyone", game_mode="chaos",
    )
    await db.commit()
    spin = await trigger_spin(db, room=room, user_id=host_id)
    await db.commit()
    assert spin.mode_state_snapshot["mode_effects"]["chaos_event"] == "slow_burn"
    # Started at 0 → final is between SLOW_BURN_TURNS and SLOW_BURN_TURNS+1 turns
    # (the trimmed turn count), well under the normal ≥5-turn minimum.
    assert SLOW_BURN_TURNS * 360 <= spin.final_angle_deg < (SLOW_BURN_TURNS + 1) * 360
    assert 0 <= segment_under_pointer(spin.final_angle_deg, 4) < 4


async def test_trigger_spin_chaos_blind_pointer_lands_under_pointer(
    db: AsyncSession, monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Force "blind_pointer" (idx 6 of 8 → roll in [0.75, 0.875)). The recorded
    # result must be the segment under the random pointer angle.
    from hoba_api.modes.registry import engine_for

    monkeypatch.setattr(engine_for("chaos"), "_rng", _chaos_roll("blind_pointer"))
    host_id = await _make_user(db, tg_id=602)
    room = await create_room(
        db, host_id=host_id, question_text="Q?", segments=_drafts(4),
        spin_policy="anyone", game_mode="chaos",
    )
    await db.commit()
    spin = await trigger_spin(db, room=room, user_id=host_id)
    await db.commit()
    effects = spin.mode_state_snapshot["mode_effects"]
    assert effects["chaos_event"] == "blind_pointer"
    pointer_deg = effects["pointer_deg"]
    assert 0.0 <= pointer_deg < 360.0
    living = spin.mode_state_snapshot["living_segment_ids"]
    sector = 360.0 / len(living)
    idx = int(((pointer_deg - spin.final_angle_deg) % 360.0) // sector) % len(living)
    assert spin.result_segment_id == living[idx]


async def test_trigger_spin_chaos_roaming_pointer_keeps_wheel_still(
    db: AsyncSession, monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Force "roaming_pointer" (idx 7 of 8 → roll in [0.875, 1.0)). The wheel
    # must not move — the final angle equals the starting angle — while the
    # result is still a valid segment (the client roams the pointer to it).
    from hoba_api.modes.registry import engine_for

    monkeypatch.setattr(engine_for("chaos"), "_rng", _chaos_roll("roaming_pointer"))
    host_id = await _make_user(db, tg_id=604)
    room = await create_room(
        db, host_id=host_id, question_text="Q?", segments=_drafts(4),
        spin_policy="anyone", game_mode="chaos",
    )
    await db.commit()
    # First spin starts at angle 0 → roaming keeps it at 0.
    spin = await trigger_spin(db, room=room, user_id=host_id)
    await db.commit()
    assert spin.mode_state_snapshot["mode_effects"]["chaos_event"] == "roaming_pointer"
    assert spin.final_angle_deg == 0.0
    assert spin.result_segment_id in spin.mode_state_snapshot["living_segment_ids"]


def test_best_of_n_leaders() -> None:
    from hoba_api.services.spins import best_of_n_leaders

    assert best_of_n_leaders({}) == []
    assert best_of_n_leaders({1: 3, 2: 1}) == [1]
    assert sorted(best_of_n_leaders({1: 2, 2: 2, 3: 1})) == [1, 2]


async def test_trigger_spin_single_attempt_no_bon(db: AsyncSession) -> None:
    host_id = await _make_user(db, tg_id=503)
    room = await create_room(
        db, host_id=host_id, question_text="Q?", segments=_drafts(3),
        spin_policy="anyone", game_mode="classic", spin_count=1,
    )
    await db.commit()
    spin = await trigger_spin(db, room=room, user_id=host_id)
    await db.commit()
    assert "series" not in spin.mode_state_snapshot
    assert room.bon_winner_segment_id is None


async def test_trigger_spin_round_over_blocks(db: AsyncSession) -> None:
    host_id = await _make_user(db, tg_id=504)
    room = await create_room(
        db, host_id=host_id, question_text="Q?", segments=_drafts(3),
        spin_policy="anyone", game_mode="classic", spin_count=3,
    )
    await db.commit()
    room.bon_winner_segment_id = 1
    await db.flush()
    with pytest.raises(RoomServiceError) as exc:
        await trigger_spin(db, room=room, user_id=host_id)
    assert exc.value.code == "round_over"
