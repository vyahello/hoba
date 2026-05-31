"""Mode engine behaviour — pure, no DB."""
from __future__ import annotations

from collections.abc import Callable, Iterable

from hoba_api.models.room import Room
from hoba_api.models.segment import Segment
from hoba_api.modes.base import SpinContext
from hoba_api.modes.chaos import CHAOS_EVENTS, ChaosEngine
from hoba_api.modes.classic import ClassicEngine
from hoba_api.modes.elimination import EliminationEngine


def _seq_rng(values: Iterable[float]) -> Callable[[], float]:
    """RNG stub that yields the given floats in order."""
    it = iter(values)
    return lambda: next(it)


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


# Chaos fires an event on EVERY spin (idx = int(roll * 6) over 6 events:
# multi_spin, slow_burn, reverse, swap, nudge_fwd, nudge_back).


def test_chaos_multi_spin_reps_in_range() -> None:
    segs = [_seg(1, 0), _seg(2, 1)]
    # roll 0.05 -> idx 0 = multi_spin; second rng picks reps 2..5.
    d = ChaosEngine(rng=_seq_rng([0.05, 0.0])).on_spin_request(_ctx(segs))
    assert d.effects["chaos_event"] == "multi_spin"
    assert d.effects["spin_reps"] == 2
    d2 = ChaosEngine(rng=_seq_rng([0.05, 0.999])).on_spin_request(_ctx(segs))
    assert d2.effects["spin_reps"] == 5


def test_chaos_slow_burn_is_very_slow() -> None:
    segs = [_seg(1, 0), _seg(2, 1)]
    d = ChaosEngine(rng=_seq_rng([0.2])).on_spin_request(_ctx(segs))  # idx 1
    assert d.effects == {"chaos_event": "slow_burn", "dramatic": True}
    assert d.duration_multiplier == 4.0


def test_chaos_reverse_keeps_order_and_duration() -> None:
    segs = [_seg(1, 0), _seg(2, 1)]
    d = ChaosEngine(rng=_seq_rng([0.4])).on_spin_request(_ctx(segs))  # idx 2
    assert d.effects == {"chaos_event": "reverse"}
    assert d.duration_multiplier == 1.0
    assert d.segments == segs


def test_chaos_swap_reorders_and_emits_pair() -> None:
    segs = [_seg(1, 0), _seg(2, 1), _seg(3, 2)]
    # roll 0.55 -> idx 3 = swap; i = floor(0.0*3)=0; j = floor(0.99*2)=1, j>=i -> j=2.
    d = ChaosEngine(rng=_seq_rng([0.55, 0.0, 0.99])).on_spin_request(_ctx(segs))
    assert d.effects["chaos_event"] == "swap"
    assert [s.id for s in d.segments] == [3, 2, 1]
    assert d.effects["segment_order"] == [3, 2, 1]
    assert d.effects["swap_pair"] == [1, 3]


def test_chaos_nudge_events() -> None:
    segs = [_seg(1, 0), _seg(2, 1)]
    fwd = ChaosEngine(rng=_seq_rng([0.7])).on_spin_request(_ctx(segs))  # idx 4
    assert fwd.effects == {"chaos_event": "nudge_fwd"}
    back = ChaosEngine(rng=_seq_rng([0.9])).on_spin_request(_ctx(segs))  # idx 5
    assert back.effects == {"chaos_event": "nudge_back"}


def test_chaos_always_fires_an_event() -> None:
    # No "plain spin" outcome — every roll across [0,1) yields an event.
    segs = [_seg(1, 0), _seg(2, 1)]
    for roll in (0.0, 0.16, 0.34, 0.5, 0.66, 0.84, 0.999):
        d = ChaosEngine(rng=_seq_rng([roll, 0.0, 0.99])).on_spin_request(_ctx(segs))
        assert d.effects.get("chaos_event") in CHAOS_EVENTS
