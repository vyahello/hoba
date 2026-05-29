import { describe, expect, it } from "vitest";

import { type SpinSeriesEntry } from "@/stores/room";

import { isFinalSubSpin, runningTally } from "../spinSeries";

function entry(segment_id: number): SpinSeriesEntry {
  return { segment_id, final_angle_deg: 0, duration_ms: 1800, seed: 1 };
}

describe("spinSeries", () => {
  it("accumulates the running tally up to an index", () => {
    const series = [entry(1), entry(2), entry(1)];
    expect([...runningTally(series, 0)]).toEqual([[1, 1]]);
    const t2 = runningTally(series, 2);
    expect(t2.get(1)).toBe(2);
    expect(t2.get(2)).toBe(1);
  });

  it("clamps to series length", () => {
    const series = [entry(5)];
    expect(runningTally(series, 99).get(5)).toBe(1);
  });

  it("detects the final sub-spin", () => {
    expect(isFinalSubSpin(2, 3)).toBe(true);
    expect(isFinalSubSpin(0, 3)).toBe(false);
  });
});
