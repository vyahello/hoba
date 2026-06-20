import { describe, expect, it } from "vitest";

import { laneFromClientX, REACTION_EMOJIS, reactionLaneFor } from "../reactionLanes";

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

  it("gives custom (unknown) emojis a stable hashed lane in [0.15, 0.85]", () => {
    // Custom reactions (the ＋ picker) aren't in the bar's five, so they get a
    // deterministic hashed lane — spread across the bar (not all stacked at
    // centre), and the SAME emoji always flies in the same lane.
    const a = reactionLaneFor("🦄");
    expect(a).toBe(reactionLaneFor("🦄")); // stable
    expect(a).toBeGreaterThanOrEqual(0.15);
    expect(a).toBeLessThanOrEqual(0.85);
    // Different customs generally land in different lanes (not all centre).
    expect(reactionLaneFor("🦄")).not.toBe(reactionLaneFor("🌈"));
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

describe("laneFromClientX", () => {
  it("maps a centred tap to x≈0.5 and clamps the edges", () => {
    // So a button tapped dead-centre flies up the middle; edge taps clamp in.
    expect(laneFromClientX(200, 400)).toBeCloseTo(0.5, 5);
    expect(laneFromClientX(0, 400)).toBe(0);
    expect(laneFromClientX(400, 400)).toBe(1);
  });

  it("inverts FlyingReactions' left:x*90+5 mapping at centre", () => {
    const x = laneFromClientX(0.5 * 400, 400);
    expect(x * 90 + 5).toBeCloseTo(50, 5); // 50% tap → 50% render
  });

  it("is safe when the viewport width is unknown (0)", () => {
    expect(laneFromClientX(123, 0)).toBe(0.5);
  });
});
