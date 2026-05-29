"""Mode engine behaviour — pure, no DB."""
from __future__ import annotations

from hoba_api.models.room import Room
from hoba_api.models.segment import Segment
from hoba_api.modes.base import SpinContext
from hoba_api.modes.classic import ClassicEngine


def _seg(seg_id: int, position: int, eliminated: bool = False) -> Segment:
    s = Segment(
        id=seg_id, parent_id=1, parent_type="question",
        label=f"s{seg_id}", color_seed=0, weight=1, position=position,
    )
    if eliminated:
        from datetime import UTC, datetime
        s.eliminated_at = datetime.now(UTC)
    return s


def _ctx(segments: list[Segment]) -> SpinContext:
    room = Room(code="ABC123", host_id=1, status="active",
                game_mode="classic", spin_policy="anyone", suggestion_policy="off")
    return SpinContext(room=room, question=None, segments=segments)


def test_classic_visible_is_all_and_never_round_over() -> None:
    segs = [_seg(1, 0), _seg(2, 1)]
    e = ClassicEngine()
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


def test_segment_is_eliminated_property() -> None:
    from datetime import UTC, datetime
    s = Segment(id=9, parent_id=1, parent_type="question", label="x",
                color_seed=0, weight=1, position=0)
    assert s.is_eliminated is False
    s.eliminated_at = datetime.now(UTC)
    assert s.is_eliminated is True
