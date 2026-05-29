import { describe, expect, it } from "vitest";

import { type RoomState } from "@/lib/api";

import { activeCard, doneCount, hasPendingCard, isPunishment } from "../punishment";

function snap(overrides: Partial<RoomState["room"]> = {}): RoomState {
  return {
    room: {
      id: 1, code: "ABC123", host_id: 1, title: null, status: "active",
      game_mode: "punishment", spin_policy: "anyone", suggestion_policy: "off",
      is_locked: false, is_anonymous: false, current_turn_user_id: null,
      created_at: "2026-05-29T00:00:00Z", closed_at: null,
      punishment_deck: "mild", punishment_done_count: 2, spin_count: 1,
      punishment_active_card: {
        text: "Do a dance", deck: "mild", victim_segment_id: 5, spin_id: 9,
      },
      ...overrides,
    },
    participants: [], active_question: null, last_spin: null, me_user_id: 1,
  };
}

describe("punishment helpers", () => {
  it("reads active card / done count / pending / mode", () => {
    const s = snap();
    expect(isPunishment(s)).toBe(true);
    expect(doneCount(s)).toBe(2);
    expect(hasPendingCard(s)).toBe(true);
    expect(activeCard(s)?.text).toBe("Do a dance");
  });

  it("no pending card when null", () => {
    expect(hasPendingCard(snap({ punishment_active_card: null }))).toBe(false);
    expect(activeCard(snap({ punishment_active_card: null }))).toBeNull();
  });

  it("null snapshot safe", () => {
    expect(isPunishment(null)).toBe(false);
    expect(hasPendingCard(null)).toBe(false);
    expect(doneCount(null)).toBe(0);
    expect(activeCard(null)).toBeNull();
  });
});
