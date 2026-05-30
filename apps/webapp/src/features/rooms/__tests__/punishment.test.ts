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
      punishment_deck: "mild", punishment_done_count: 2,
      punishment_locked_user_ids: [], punishment_my_prediction: null,
      punishment_predictions: null, punishment_result_segment_id: null,
      punishment_cards: null,
      bon_attempts: 0, bon_tally: null, bon_winner_segment_id: null, spin_count: 1,
      ...overrides,
    },
    participants: [], active_question: null, last_spin: null, me_user_id: 1,
  };
}

describe("punishment helpers", () => {
  it("reads done count / mode", () => {
    const s = snap();
    expect(isPunishment(s)).toBe(true);
    expect(doneCount(s)).toBe(2);
  });

  // activeCard / hasPendingCard are inert stopgaps during the v2 migration
  // (the legacy single-victim card model is gone); the v2 card UI lands later.
  it("legacy card helpers are inert", () => {
    expect(hasPendingCard(snap())).toBe(false);
    expect(activeCard(snap())).toBeNull();
  });

  it("null snapshot safe", () => {
    expect(isPunishment(null)).toBe(false);
    expect(hasPendingCard(null)).toBe(false);
    expect(doneCount(null)).toBe(0);
    expect(activeCard(null)).toBeNull();
  });
});
