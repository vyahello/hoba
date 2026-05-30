import { describe, expect, it } from "vitest";

import { type RoomState } from "@/lib/api";

import {
  attempts,
  isBestOfN,
  roundOver,
  roundWinnerId,
  tally,
  target,
} from "../bestOfN";

function snap(overrides: Partial<RoomState["room"]> = {}): RoomState {
  return {
    room: {
      id: 1, code: "ABC123", host_id: 1, title: null, status: "active",
      game_mode: "classic", spin_policy: "anyone", suggestion_policy: "off",
      is_locked: false, is_anonymous: false, current_turn_user_id: null,
      punishment_deck: null, punishment_done_count: 0,
      punishment_locked_user_ids: [], punishment_my_prediction: null,
      punishment_predictions: null, punishment_result_segment_id: null,
      punishment_cards: null,
      spin_count: 3, bon_attempts: 2, bon_tally: { "5": 2, "7": 1 },
      bon_winner_segment_id: null,
      created_at: "2026-05-29T00:00:00Z", closed_at: null,
      ...overrides,
    },
    participants: [], active_question: null, last_spin: null, me_user_id: 1,
  };
}

describe("bestOfN helpers", () => {
  it("reads attempts/target/tally for an active round", () => {
    const s = snap();
    expect(isBestOfN(s)).toBe(true);
    expect(attempts(s)).toBe(2);
    expect(target(s)).toBe(3);
    expect(tally(s).get(5)).toBe(2);
    expect(roundOver(s)).toBe(false);
    expect(roundWinnerId(s)).toBeNull();
  });

  it("not best-of-N when spin_count is 1 or non-classic", () => {
    expect(isBestOfN(snap({ spin_count: 1 }))).toBe(false);
    expect(isBestOfN(snap({ game_mode: "elimination" }))).toBe(false);
  });

  it("round over when a winner is set", () => {
    const s = snap({ bon_winner_segment_id: 5 });
    expect(roundOver(s)).toBe(true);
    expect(roundWinnerId(s)).toBe(5);
  });

  it("null snapshot safe", () => {
    expect(isBestOfN(null)).toBe(false);
    expect(attempts(null)).toBe(0);
    expect(target(null)).toBe(1);
    expect(tally(null).size).toBe(0);
    expect(roundOver(null)).toBe(false);
  });
});
