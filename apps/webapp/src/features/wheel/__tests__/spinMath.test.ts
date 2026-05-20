import { describe, expect, it } from "vitest";

import { mulberry32 } from "../seededRandom";
import { computeSpin, pickSegmentIndex, segmentUnderPointer } from "../spinMath";

describe("mulberry32", () => {
  it("is deterministic for the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 10; i++) {
      expect(a()).toBe(b());
    }
  });

  it("produces different sequences for different seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });

  it("yields values in [0, 1)", () => {
    const rng = mulberry32(123);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("pickSegmentIndex", () => {
  it("returns an index in range for uniform selection", () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 100; i++) {
      const idx = pickSegmentIndex(6, rng);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(6);
    }
  });

  it("respects weights statistically over many trials", () => {
    const weights = [0, 0, 100, 0]; // only index 2 can be picked
    const rng = mulberry32(777);
    for (let i = 0; i < 50; i++) {
      expect(pickSegmentIndex(4, rng, weights)).toBe(2);
    }
  });

  it("approximates weight ratios over many trials", () => {
    const weights = [1, 1, 1, 7]; // index 3 has 70% chance
    const counts = [0, 0, 0, 0];
    const rng = mulberry32(2024);
    const N = 5000;
    for (let i = 0; i < N; i++) {
      counts[pickSegmentIndex(4, rng, weights)]!++;
    }
    expect(counts[3]! / N).toBeGreaterThan(0.65);
    expect(counts[3]! / N).toBeLessThan(0.75);
  });

  it("rejects mismatched weights length", () => {
    expect(() => pickSegmentIndex(3, mulberry32(1), [1, 2])).toThrow();
  });

  it("rejects zero segments", () => {
    expect(() => pickSegmentIndex(0, mulberry32(1))).toThrow();
  });
});

describe("computeSpin", () => {
  it("lands the pointer in the winning sector for many seeds", () => {
    const segmentCount = 6;
    for (let seed = 1; seed <= 100; seed++) {
      const result = computeSpin({ segmentCount, seed, winningIndex: 3 });
      // After rotating by finalAngleDeg, segment under the pointer should be 3
      expect(segmentUnderPointer(result.finalAngleDeg, segmentCount)).toBe(3);
      // Duration within spec range
      expect(result.durationMs).toBeGreaterThanOrEqual(5500);
      expect(result.durationMs).toBeLessThan(8500);
      // At least 4 full rotations of drama (lower bound after worst-case
      // sectorCenterOffset + negative jitter at rotations=5)
      expect(Math.abs(result.finalAngleDeg)).toBeGreaterThan(4 * 360);
      // Verify rotations didn't exceed the upper bound either
      expect(Math.abs(result.finalAngleDeg)).toBeLessThan(9 * 360);
    }
  });

  it("always rotates forward from any starting angle", () => {
    // Regression for: wheel reversed direction after first spin because
    // finalAngleDeg was computed from 0 instead of current rotation.
    let current = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const result = computeSpin({
        segmentCount: 6,
        seed,
        startingAngleDeg: current,
      });
      // New target must be at least 5 full rotations ahead of current
      expect(result.finalAngleDeg - current).toBeGreaterThanOrEqual(5 * 360);
      // And lands the winner
      expect(segmentUnderPointer(result.finalAngleDeg, 6)).toBe(
        result.resultSegmentIndex,
      );
      current = result.finalAngleDeg;
    }
    // After 50 spins, we expect roughly 50 × (5–8) full rotations
    expect(current).toBeGreaterThan(50 * 5 * 360);
  });

  it("is deterministic for the same seed + inputs", () => {
    const a = computeSpin({ segmentCount: 4, seed: 7, winningIndex: 2 });
    const b = computeSpin({ segmentCount: 4, seed: 7, winningIndex: 2 });
    expect(a).toEqual(b);
  });

  it("rejects segmentCount outside [2, 12]", () => {
    expect(() => computeSpin({ segmentCount: 1, seed: 1 })).toThrow();
    expect(() => computeSpin({ segmentCount: 13, seed: 1 })).toThrow();
  });

  it("picks a valid winning index when none supplied", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const r = computeSpin({ segmentCount: 5, seed });
      expect(r.resultSegmentIndex).toBeGreaterThanOrEqual(0);
      expect(r.resultSegmentIndex).toBeLessThan(5);
      expect(segmentUnderPointer(r.finalAngleDeg, 5)).toBe(r.resultSegmentIndex);
    }
  });
});

describe("segmentUnderPointer", () => {
  it("returns 0 at zero rotation", () => {
    expect(segmentUnderPointer(0, 6)).toBe(0);
  });

  it("returns N-1 when rotated by less than one sector clockwise", () => {
    // Rotating the wheel clockwise by epsilon brings segment N-1 under the pointer
    // because segment 0 moves slightly past it.
    expect(segmentUnderPointer(15, 6)).toBe(5);
  });

  it("wraps around on full rotation", () => {
    expect(segmentUnderPointer(360, 6)).toBe(0);
    expect(segmentUnderPointer(720, 6)).toBe(0);
  });

  it("handles negative rotations", () => {
    expect(segmentUnderPointer(-60, 6)).toBe(1);
  });
});
