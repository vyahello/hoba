import { describe, expect, it } from "vitest";

import { type ServerQuestion, type ServerSegment } from "@/lib/api";

import {
  eliminatedSegments,
  isRoundOver,
  livingSegments,
  remainingCount,
} from "../elimination";

function seg(id: number, eliminated = false): ServerSegment {
  return {
    id, label: `s${id}`, emoji: null, color_seed: 0, weight: 1,
    position: id, is_eliminated: eliminated,
  };
}

function q(segments: ServerSegment[]): ServerQuestion {
  return { id: 1, text: "Q", is_active: true, segments };
}

describe("elimination helpers", () => {
  it("splits living vs eliminated", () => {
    const question = q([seg(1, true), seg(2), seg(3)]);
    expect(livingSegments(question).map((s) => s.id)).toEqual([2, 3]);
    expect(eliminatedSegments(question).map((s) => s.id)).toEqual([1]);
    expect(remainingCount(question)).toBe(2);
    expect(isRoundOver(question)).toBe(false);
  });

  it("round is over with exactly one living segment", () => {
    expect(isRoundOver(q([seg(1, true), seg(2)]))).toBe(true);
  });

  it("null question is safe", () => {
    expect(livingSegments(null)).toEqual([]);
    expect(remainingCount(null)).toBe(0);
    expect(isRoundOver(null)).toBe(false);
  });
});
