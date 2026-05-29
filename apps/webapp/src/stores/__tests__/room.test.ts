import { describe, expect, it, vi } from "vitest";

// Mock browser-only deps so pure reducer tests run in node environment.
vi.mock("@twa-dev/sdk", () => ({ default: { initData: "" } }));
vi.mock("socket.io-client", () => ({ io: () => ({ on: vi.fn(), once: vi.fn(), emit: vi.fn(), connected: false }) }));

import { type RoomState } from "@/lib/api";

import { applyEliminated, reviveAllSegments } from "../room";

function snap(): RoomState {
  return {
    room: {
      id: 1, code: "ABC123", host_id: 1, title: null, status: "active",
      game_mode: "elimination", spin_policy: "anyone", suggestion_policy: "off",
      is_locked: false, is_anonymous: false, current_turn_user_id: null,
      punishment_deck: null, punishment_done_count: 0, punishment_active_card: null, bon_attempts: 0, bon_tally: null, bon_winner_segment_id: null,
      spin_count: 1,
      created_at: "2026-05-29T00:00:00Z", closed_at: null,
    },
    participants: [],
    active_question: {
      id: 1, text: "Q", is_active: true,
      segments: [
        { id: 1, label: "a", emoji: null, color_seed: 0, weight: 1, position: 0, is_eliminated: false },
        { id: 2, label: "b", emoji: null, color_seed: 1, weight: 1, position: 1, is_eliminated: false },
      ],
    },
    last_spin: null,
    me_user_id: 1,
  };
}

describe("room store reducers", () => {
  it("applyEliminated marks one segment eliminated", () => {
    const next = applyEliminated(snap(), 1);
    expect(next.active_question!.segments.find((s) => s.id === 1)!.is_eliminated).toBe(true);
    expect(next.active_question!.segments.find((s) => s.id === 2)!.is_eliminated).toBe(false);
  });

  it("reviveAllSegments clears every eliminated flag", () => {
    const eliminated = applyEliminated(snap(), 1);
    const revived = reviveAllSegments(eliminated);
    expect(revived.active_question!.segments.every((s) => !s.is_eliminated)).toBe(true);
  });

  it("reducers are no-ops when there is no active question", () => {
    const s = { ...snap(), active_question: null };
    expect(applyEliminated(s, 1)).toBe(s);
    expect(reviveAllSegments(s)).toBe(s);
  });
});
