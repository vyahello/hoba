"""Pure wheel math — Python mirror of `apps/webapp/src/features/wheel/spinMath.ts`.

JS bitwise semantics emulated by masking everything to unsigned 32-bit:
- `Math.imul(a, b)` ≡ `(a * b) & 0xFFFFFFFF` (low 32 bits identical
  whether operands are interpreted signed or unsigned — two's
  complement multiplication preserves low bits).
- `a >>> n` ≡ `a >> n` once `a` is masked to unsigned 32-bit.
- `(a + b) | 0` and `a ^= b` both coerce to 32-bit ⇒ mask after.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

UINT32_MASK = 0xFFFF_FFFF
UINT32_RANGE = 0x1_0000_0000  # 2**32

MIN_DURATION_MS = 5_500
MAX_DURATION_MS = 8_500
MIN_FULL_ROTATIONS = 5
MAX_FULL_ROTATIONS = 8
SECTOR_JITTER_FRACTION = 0.7


def mulberry32(seed: int) -> Callable[[], float]:
    """Deterministic PRNG yielding uniform floats in [0, 1)."""
    state = [seed & UINT32_MASK]

    def next_() -> float:
        state[0] = (state[0] + 0x6D_2B_79_F5) & UINT32_MASK
        t = state[0]
        t = ((t ^ (t >> 15)) * (t | 1)) & UINT32_MASK
        inner = ((t ^ (t >> 7)) * (t | 61)) & UINT32_MASK
        t = (t ^ ((t + inner) & UINT32_MASK)) & UINT32_MASK
        return (t ^ (t >> 14)) / UINT32_RANGE

    return next_


def pick_segment_index(
    segment_count: int,
    rng: Callable[[], float],
    weights: list[float] | None = None,
) -> int:
    """Weighted-or-uniform random index in `[0, segment_count)`."""
    if segment_count <= 0:
        raise ValueError("segment_count must be > 0")
    if not weights:
        return min(int(rng() * segment_count), segment_count - 1)
    if len(weights) != segment_count:
        raise ValueError(
            f"weights length ({len(weights)}) ≠ segment_count ({segment_count})",
        )
    total = sum(max(0.0, w) for w in weights)
    if total <= 0:
        return min(int(rng() * segment_count), segment_count - 1)
    r = rng() * total
    for i, w in enumerate(weights):
        r -= max(0.0, w)
        if r <= 0:
            return i
    return segment_count - 1


@dataclass(frozen=True, slots=True)
class SpinResult:
    result_segment_index: int
    final_angle_deg: float
    duration_ms: int
    seed: int


def compute_spin(
    *,
    segment_count: int,
    seed: int,
    starting_angle_deg: float = 0.0,
    winning_index: int | None = None,
    weights: list[float] | None = None,
) -> SpinResult:
    """Resolve a spin. Returns the absolute target rotation.

    Always travels at least `MIN_FULL_ROTATIONS × 360°` clockwise from
    `starting_angle_deg` — never less, never backwards.
    """
    if not (2 <= segment_count <= 12):
        raise ValueError(
            f"segment_count must be in [2, 12], got {segment_count}",
        )

    rng = mulberry32(seed)

    if winning_index is None:
        winning_index = pick_segment_index(segment_count, rng, weights)

    sector_deg = 360 / segment_count
    sector_jitter = (rng() - 0.5) * sector_deg * SECTOR_JITTER_FRACTION
    rotations = MIN_FULL_ROTATIONS + int(
        rng() * (MAX_FULL_ROTATIONS - MIN_FULL_ROTATIONS + 1),
    )

    sector_center_offset = winning_index * sector_deg + sector_deg / 2
    target_mod = ((-sector_center_offset + sector_jitter) % 360 + 360) % 360
    start_mod = (starting_angle_deg % 360 + 360) % 360
    base_delta = (target_mod - start_mod + 360) % 360
    total_delta = base_delta + rotations * 360
    final_angle = starting_angle_deg + total_delta

    duration_ms = MIN_DURATION_MS + int(
        rng() * (MAX_DURATION_MS - MIN_DURATION_MS),
    )

    return SpinResult(
        result_segment_index=winning_index,
        final_angle_deg=final_angle,
        duration_ms=duration_ms,
        seed=seed,
    )


def segment_under_pointer(rotation_deg: float, segment_count: int) -> int:
    """Inverse: which segment is currently under the top pointer."""
    sector_deg = 360 / segment_count
    angle = (-rotation_deg % 360 + 360) % 360
    return int(angle // sector_deg) % segment_count
