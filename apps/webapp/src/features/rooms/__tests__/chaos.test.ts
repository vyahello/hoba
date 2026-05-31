import { describe, expect, it } from "vitest";

import { CHAOS_EVENT_EMOJI, CHAOS_EVENTS, orderSegmentsForSpin } from "../chaos";

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
