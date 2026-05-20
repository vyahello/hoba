/**
 * Pure math for the wheel spin.
 *
 * Convention: segment 0 starts at the 12 o'clock pointer and segments
 * are laid out clockwise around the wheel. Each segment occupies
 * `sectorDeg = 360 / segmentCount`. To land segment K under the
 * (fixed) top pointer, we rotate the wheel clockwise by an angle whose
 * `mod 360` brings the midpoint of K's sector to 0°. We add several
 * full revolutions on top for dramatic effect.
 */

import { mulberry32 } from "./seededRandom";
import type { SpinResult } from "./types";

const MIN_DURATION_MS = 5_500;
const MAX_DURATION_MS = 8_500;
const MIN_FULL_ROTATIONS = 5;
const MAX_FULL_ROTATIONS = 8;
/** Random offset within the winning sector — keeps landings off dead-center. */
const SECTOR_JITTER_FRACTION = 0.7;

/** Weighted-or-uniform random index in `[0, segmentCount)`. */
export function pickSegmentIndex(
  segmentCount: number,
  rng: () => number,
  weights?: number[],
): number {
  if (segmentCount <= 0) {
    throw new Error("pickSegmentIndex: segmentCount must be > 0");
  }
  if (weights === undefined || weights.length === 0) {
    return Math.min(Math.floor(rng() * segmentCount), segmentCount - 1);
  }
  if (weights.length !== segmentCount) {
    throw new Error(
      `pickSegmentIndex: weights length (${weights.length}) ≠ segmentCount (${segmentCount})`,
    );
  }
  const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
  if (total <= 0) {
    return Math.min(Math.floor(rng() * segmentCount), segmentCount - 1);
  }
  let r = rng() * total;
  for (let i = 0; i < segmentCount; i++) {
    r -= Math.max(0, weights[i] ?? 0);
    if (r <= 0) return i;
  }
  return segmentCount - 1;
}

export interface ComputeSpinInput {
  segmentCount: number;
  seed: number;
  /**
   * Absolute current rotation of the wheel (the MotionValue's value).
   * Defaults to 0 for first spins. **Subsequent spins must pass the
   * wheel's current rotation** — otherwise the new animation may travel
   * a tiny arc forward or even rotate backwards (the wheel reverses
   * after first spin bug).
   */
  startingAngleDeg?: number;
  /** When provided, RNG only contributes to angle jitter + rotations + duration. */
  winningIndex?: number;
  /** For Rigged Mode in later phases. Length must equal `segmentCount`. */
  weights?: number[];
}

/**
 * Resolve a spin given a `{segmentCount, seed}` pair.
 *
 * Returns an **absolute** target rotation (`finalAngleDeg`) such that
 * animating the wheel to it lands `winningIndex` under the top pointer.
 * Always travels at least `MIN_FULL_ROTATIONS × 360°` clockwise from
 * `startingAngleDeg` — never less, never backwards.
 */
export function computeSpin(input: ComputeSpinInput): SpinResult {
  const { segmentCount, seed, weights, startingAngleDeg = 0 } = input;
  if (segmentCount < 2 || segmentCount > 12) {
    throw new Error(
      `computeSpin: segmentCount must be in [2, 12], got ${segmentCount}`,
    );
  }

  const rng = mulberry32(seed);

  const winningIndex =
    input.winningIndex ?? pickSegmentIndex(segmentCount, rng, weights);

  const sectorDeg = 360 / segmentCount;
  const sectorJitter = (rng() - 0.5) * sectorDeg * SECTOR_JITTER_FRACTION;
  const rotations =
    MIN_FULL_ROTATIONS +
    Math.floor(rng() * (MAX_FULL_ROTATIONS - MIN_FULL_ROTATIONS + 1));

  // Rotation (mod 360) that places `winningIndex` under the top pointer:
  // pointer reads K iff `((-R) mod 360)` is in K's sector — centered at
  // `K * sectorDeg + sectorDeg/2`. Jitter shifts within the sector.
  const sectorCenterOffset = winningIndex * sectorDeg + sectorDeg / 2;
  const targetMod =
    (((-sectorCenterOffset + sectorJitter) % 360) + 360) % 360;
  const startMod = ((startingAngleDeg % 360) + 360) % 360;
  const baseDelta = (targetMod - startMod + 360) % 360;
  const totalDelta = baseDelta + rotations * 360;
  const finalAngleDeg = startingAngleDeg + totalDelta;

  const durationMs =
    MIN_DURATION_MS + Math.floor(rng() * (MAX_DURATION_MS - MIN_DURATION_MS));

  return { resultSegmentIndex: winningIndex, finalAngleDeg, durationMs, seed };
}

/**
 * Inverse: given a rotation (the live MotionValue), report which
 * segment is currently under the top pointer. Used by the rAF tick
 * detector during the decelerate phase.
 */
export function segmentUnderPointer(
  rotationDeg: number,
  segmentCount: number,
): number {
  const sectorDeg = 360 / segmentCount;
  // The pointer sits at 0°; after wheel rotation `r`, the angle at the
  // pointer relative to the (now-rotated) wheel is `-r`. Normalize to
  // [0, 360) and find which sector contains it.
  const angle = ((-rotationDeg) % 360 + 360) % 360;
  return Math.floor(angle / sectorDeg) % segmentCount;
}
