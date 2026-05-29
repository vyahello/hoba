"""Mode engine behaviour — pure, no DB."""
from __future__ import annotations

from hoba_api.models.room import Room
from hoba_api.models.segment import Segment
from hoba_api.modes.base import SpinContext
from hoba_api.modes.classic import ClassicEngine
from hoba_api.modes.elimination import EliminationEngine


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


def test_elimination_visible_excludes_eliminated() -> None:
    segs = [_seg(1, 0, eliminated=True), _seg(2, 1), _seg(3, 2)]
    e = EliminationEngine()
    visible = e.get_visible_segments(_ctx(segs))
    assert [s.id for s in visible] == [2, 3]


def test_elimination_request_dramatic_when_two_living() -> None:
    e = EliminationEngine()
    two = _ctx([_seg(1, 0), _seg(2, 1)])
    d = e.on_spin_request(two)
    assert d.duration_multiplier == 1.5
    assert d.effects == {"dramatic": True}
    three = _ctx([_seg(1, 0), _seg(2, 1), _seg(3, 2)])
    assert e.on_spin_request(three).duration_multiplier == 1.0
    assert e.on_spin_request(three).effects == {}


def test_elimination_settled_marks_winner_and_round_over() -> None:
    e = EliminationEngine()
    segs = [_seg(1, 0), _seg(2, 1)]  # 2 living -> after removing winner, 1 -> round over
    eff = e.on_spin_settled(_ctx(segs), segs[0])
    assert eff.eliminate_segment_ids == [1]
    assert eff.round_over is True
    segs3 = [_seg(1, 0), _seg(2, 1), _seg(3, 2)]
    eff3 = e.on_spin_settled(_ctx(segs3), segs3[0])
    assert eff3.eliminate_segment_ids == [1]
    assert eff3.round_over is False
