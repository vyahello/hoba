import { describe, expect, it } from "vitest";

import { REACTION_EMOJIS, reactionLaneFor } from "../reactionLanes";

describe("reactionLaneFor", () => {
  it("returns a stable lane for each known emoji in the bar", () => {
    // Regression for: reactions flew from `Math.random()` positions, so
    // 🔥 didn't appear to come from the 🔥 button. Each known emoji must
    // resolve to a deterministic horizontal lane, matching the order
    // emojis appear in the bar.
    expect(reactionLaneFor("😂")).toBe(0.19);
    expect(reactionLaneFor("🔥")).toBe(0.35);
    expect(reactionLaneFor("💀")).toBe(0.5);
    expect(reactionLaneFor("👍")).toBe(0.65);
    expect(reactionLaneFor("🎉")).toBe(0.81);
  });

  it("falls back to centre (0.5) for unknown emojis", () => {
    // Server contract allows up to 16-char emoji strings, but the bar
    // only sends the five canonical ones. A future reaction from a
    // newer client should still render somewhere sensible.
    expect(reactionLaneFor("🦄")).toBe(0.5);
    expect(reactionLaneFor("")).toBe(0.5);
  });

  it("applies caller-supplied jitter on top of the base lane", () => {
    expect(reactionLaneFor("🔥", 0.04)).toBeCloseTo(0.39, 5);
    expect(reactionLaneFor("🔥", -0.04)).toBeCloseTo(0.31, 5);
  });

  it("clamps to [0, 1] so a wide jitter never escapes the viewport range", () => {
    expect(reactionLaneFor("😂", -0.5)).toBe(0);
    expect(reactionLaneFor("🎉", 0.5)).toBe(1);
  });

  it("gives each emoji in the bar a distinct lane (no overlaps)", () => {
    const lanes = new Set(REACTION_EMOJIS.map((e) => reactionLaneFor(e)));
    expect(lanes.size).toBe(REACTION_EMOJIS.length);
  });
});
