"""Server-side spin math tests — mirror of `spinMath.test.ts`."""

from __future__ import annotations

import pytest

from hoba_api.wheel.spin_math import (
    compute_spin,
    mulberry32,
    pick_segment_index,
    segment_under_pointer,
)


def test_mulberry32_deterministic() -> None:
    a = mulberry32(42)
    b = mulberry32(42)
    for _ in range(10):
        assert a() == b()


def test_mulberry32_range() -> None:
    rng = mulberry32(123)
    for _ in range(1000):
        v = rng()
        assert 0 <= v < 1


def test_pick_segment_uniform_in_range() -> None:
    rng = mulberry32(1)
    for _ in range(100):
        idx = pick_segment_index(6, rng)
        assert 0 <= idx < 6


def test_pick_segment_weighted() -> None:
    weights = [0.0, 0.0, 100.0, 0.0]
    rng = mulberry32(777)
    for _ in range(50):
        assert pick_segment_index(4, rng, weights) == 2


def test_pick_segment_weighted_ratio() -> None:
    weights = [1.0, 1.0, 1.0, 7.0]
    counts = [0, 0, 0, 0]
    rng = mulberry32(2024)
    n = 5000
    for _ in range(n):
        counts[pick_segment_index(4, rng, weights)] += 1
    ratio = counts[3] / n
    assert 0.65 < ratio < 0.75


def test_pick_segment_rejects_mismatched_weights() -> None:
    with pytest.raises(ValueError):
        pick_segment_index(3, mulberry32(1), [1.0, 2.0])


def test_pick_segment_rejects_zero() -> None:
    with pytest.raises(ValueError):
        pick_segment_index(0, mulberry32(1))


def test_compute_spin_lands_winner_many_seeds() -> None:
    for seed in range(1, 101):
        result = compute_spin(segment_count=6, seed=seed, winning_index=3)
        assert segment_under_pointer(result.final_angle_deg, 6) == 3
        assert 5500 <= result.duration_ms < 8500
        assert abs(result.final_angle_deg) > 4 * 360
        assert abs(result.final_angle_deg) < 9 * 360


def test_compute_spin_always_forward_from_any_start() -> None:
    current = 0.0
    for seed in range(1, 51):
        result = compute_spin(
            segment_count=6, seed=seed, starting_angle_deg=current,
        )
        assert result.final_angle_deg - current >= 5 * 360
        assert (
            segment_under_pointer(result.final_angle_deg, 6)
            == result.result_segment_index
        )
        current = result.final_angle_deg
    assert current > 50 * 5 * 360


def test_compute_spin_deterministic() -> None:
    a = compute_spin(segment_count=4, seed=7, winning_index=2)
    b = compute_spin(segment_count=4, seed=7, winning_index=2)
    assert a == b


def test_compute_spin_rejects_invalid_segment_count() -> None:
    with pytest.raises(ValueError):
        compute_spin(segment_count=1, seed=1)
    with pytest.raises(ValueError):
        compute_spin(segment_count=13, seed=1)


def test_segment_under_pointer_basics() -> None:
    assert segment_under_pointer(0, 6) == 0
    assert segment_under_pointer(15, 6) == 5
    assert segment_under_pointer(360, 6) == 0
    assert segment_under_pointer(720, 6) == 0
    assert segment_under_pointer(-60, 6) == 1
