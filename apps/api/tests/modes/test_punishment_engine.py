"""PunishmentEngine — pure pass-through (no eliminate, no duration change)."""

from __future__ import annotations

from hoba_api.models.room import Room
from hoba_api.models.segment import Segment
from hoba_api.modes.base import SpinContext
from hoba_api.modes.punishment import PunishmentEngine
from hoba_api.modes.registry import engine_for


def _seg(seg_id: int, pos: int) -> Segment:
    return Segment(
        id=seg_id, parent_id=1, parent_type="question",
        label=f"s{seg_id}", color_seed=0, weight=1, position=pos,
    )


def _ctx(segs: list[Segment]) -> SpinContext:
    room = Room(
        code="ABC123", host_id=1, status="active",
        game_mode="punishment", spin_policy="anyone", suggestion_policy="off",
    )
    return SpinContext(room=room, question=None, segments=segs)


def test_punishment_visible_all_no_eliminate() -> None:
    segs = [_seg(1, 0), _seg(2, 1)]
    e = PunishmentEngine()
    ctx = _ctx(segs)
    assert e.get_visible_segments(ctx) == segs
    d = e.on_spin_request(ctx)
    assert d.segments == segs
    assert d.duration_multiplier == 1.0
    assert d.effects == {}
    eff = e.on_spin_settled(ctx, segs[0])
    assert eff.eliminate_segment_ids == []
    assert eff.round_over is False
    assert e.is_round_over(ctx) is False


def test_registry_resolves_punishment() -> None:
    assert engine_for("punishment").mode_id == "punishment"
