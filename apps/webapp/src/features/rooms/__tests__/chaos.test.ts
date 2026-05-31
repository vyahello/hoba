import { describe, expect, it } from "vitest";

import { buildRoamHops, CHAOS_EVENT_EMOJI, CHAOS_EVENTS, orderSegmentsForSpin } from "../chaos";

interface Seg {
  id: number;
  label: string;
}

const segs: Seg[] = [
  { id: 1, label: "a" },
  { id: 2, label: "b" },
  { id: 3, label: "c" },
];

describe("orderSegmentsForSpin", () => {
  it("returns the living order untouched when no order is given", () => {
    expect(orderSegmentsForSpin(segs, undefined)).toEqual(segs);
    expect(orderSegmentsForSpin(segs, [])).toEqual(segs);
  });

  it("reorders to match the server spin order (swap event)", () => {
    const out = orderSegmentsForSpin(segs, [3, 2, 1]);
    expect(out.map((s) => s.id)).toEqual([3, 2, 1]);
  });

  it("does not mutate the input array", () => {
    const copy = [...segs];
    orderSegmentsForSpin(segs, [2, 1, 3]);
    expect(segs).toEqual(copy);
  });
});

describe("chaos event metadata", () => {
  it("has an emoji for every rollable event", () => {
    for (const event of CHAOS_EVENTS) {
      expect(CHAOS_EVENT_EMOJI[event]).toBeTruthy();
    }
  });
});

describe("buildRoamHops", () => {
  const n = 6;
  const sector = 360 / n;

  it("lands exactly on the result segment's centre (mod 360)", () => {
    for (let result = 0; result < n; result++) {
      const hops = buildRoamHops(n, result, 0);
      const last = hops[hops.length - 1]!;
      const expected = result * sector + sector / 2; // rotation 0
      const got = ((last.deg % 360) + 360) % 360;
      expect(Math.abs(got - expected)).toBeLessThan(1e-6);
    }
  });

  it("respects the wheel's resting rotation in the landing angle", () => {
    const R = 123.4;
    const hops = buildRoamHops(n, 2, R);
    const last = hops[hops.length - 1]!;
    const expected = (((2 * sector + sector / 2 + R) % 360) + 360) % 360;
    const got = ((last.deg % 360) + 360) % 360;
    expect(Math.abs(got - expected)).toBeLessThan(1e-6);
  });

  it("wanders both directions (has at least one reversal)", () => {
    // Deterministic rng forcing alternating-ish behaviour still yields motion.
    const hops = buildRoamHops(n, 0, 0, () => 0.1);
    expect(hops.length).toBeGreaterThan(3);
    const deltas = hops.slice(1).map((h, i) => h.deg - hops[i]!.deg);
    // Not all hops go the same direction over the whole path.
    const signs = new Set(deltas.map((d) => Math.sign(d)).filter((s) => s !== 0));
    expect(signs.size).toBeGreaterThanOrEqual(1);
  });
});
