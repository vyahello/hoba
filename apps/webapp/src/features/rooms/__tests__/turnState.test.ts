import { describe, expect, it } from "vitest";

import {
  type RoomState,
  type ServerParticipant,
  type ServerRoom,
} from "@/lib/api";

import { computeTurnState } from "../turnState";

function makeRoom(overrides: Partial<ServerRoom> = {}): ServerRoom {
  return {
    id: 1,
    code: "ABC123",
    host_id: 1,
    title: null,
    status: "active",
    game_mode: "classic",
    spin_policy: "turn_based",
    suggestion_policy: "off",
    is_locked: false,
    is_anonymous: false,
    current_turn_user_id: null,
    punishment_deck: null,
    punishment_done_count: 0,
    punishment_locked_user_ids: [],
    punishment_my_prediction: null,
    punishment_predictions: null,
    punishment_result_segment_id: null,
    punishment_cards: null,
    spin_count: 1,
    bon_attempts: 0, bon_tally: null, bon_winner_segment_id: null,
    created_at: "2026-05-28T00:00:00Z",
    closed_at: null,
    ...overrides,
  };
}

function makeParticipant(
  user_id: number,
  display_name: string | null,
  role: "host" | "guest" = "guest",
): ServerParticipant {
  return {
    user_id,
    role,
    display_name,
    joined_at: "2026-05-28T00:00:00Z",
    last_seen_at: "2026-05-28T00:00:00Z",
  };
}

function makeSnapshot(overrides: Partial<RoomState> = {}): RoomState {
  return {
    room: makeRoom(),
    participants: [],
    active_question: null,
    last_spin: null,
    me_user_id: 1,
    ...overrides,
  };
}

describe("computeTurnState", () => {
  it("returns not_turn_based for null snapshot", () => {
    expect(computeTurnState(null)).toEqual({ kind: "not_turn_based" });
  });

  it("returns not_turn_based when policy != turn_based", () => {
    const snapshot = makeSnapshot({
      room: makeRoom({ spin_policy: "anyone" }),
    });
    expect(computeTurnState(snapshot)).toEqual({ kind: "not_turn_based" });
  });

  it("returns my_turn when cursor matches me_user_id", () => {
    const snapshot = makeSnapshot({
      me_user_id: 7,
      room: makeRoom({ current_turn_user_id: 7 }),
      participants: [makeParticipant(7, "Volo", "host")],
    });
    expect(computeTurnState(snapshot)).toEqual({ kind: "my_turn" });
  });

  it("returns waiting with name when cursor points to a known participant", () => {
    const snapshot = makeSnapshot({
      me_user_id: 7,
      room: makeRoom({ current_turn_user_id: 9 }),
      participants: [
        makeParticipant(7, "Volo", "host"),
        makeParticipant(9, "Anna"),
      ],
    });
    expect(computeTurnState(snapshot)).toEqual({
      kind: "waiting",
      whoUserId: 9,
      whoName: "Anna",
    });
  });

  it("returns waiting with null name when participant has no display_name", () => {
    const snapshot = makeSnapshot({
      me_user_id: 7,
      room: makeRoom({ current_turn_user_id: 9 }),
      participants: [
        makeParticipant(7, "Volo", "host"),
        makeParticipant(9, null),
      ],
    });
    expect(computeTurnState(snapshot)).toEqual({
      kind: "waiting",
      whoUserId: 9,
      whoName: null,
    });
  });

  it("returns no_one when cursor is null in an active room", () => {
    // Active room whose cursor was cleared (advance_turn found no one
    // online). There is genuinely no turn-holder.
    const snapshot = makeSnapshot({
      me_user_id: 7,
      room: makeRoom({ status: "active", current_turn_user_id: null }),
      participants: [makeParticipant(7, "Volo", "host")],
    });
    expect(computeTurnState(snapshot)).toEqual({ kind: "no_one" });
  });

  it("returns my_turn for the host in a lobby with a null cursor", () => {
    // Mirrors the server: in a turn_based lobby the cursor is null until
    // the first spin, which trigger_spin seeds to host_id. The host is
    // therefore the effective turn-holder and may kick things off.
    const snapshot = makeSnapshot({
      me_user_id: 7,
      room: makeRoom({ status: "lobby", host_id: 7, current_turn_user_id: null }),
      participants: [
        makeParticipant(7, "Volo", "host"),
        makeParticipant(9, "Anna"),
      ],
    });
    expect(computeTurnState(snapshot)).toEqual({ kind: "my_turn" });
  });

  it("returns waiting-on-host for a guest in a lobby with a null cursor", () => {
    const snapshot = makeSnapshot({
      me_user_id: 9,
      room: makeRoom({ status: "lobby", host_id: 7, current_turn_user_id: null }),
      participants: [
        makeParticipant(7, "Volo", "host"),
        makeParticipant(9, "Anna"),
      ],
    });
    expect(computeTurnState(snapshot)).toEqual({
      kind: "waiting",
      whoUserId: 7,
      whoName: "Volo",
    });
  });

  it("returns no_one when cursor points to an unknown participant (defensive)", () => {
    const snapshot = makeSnapshot({
      me_user_id: 7,
      room: makeRoom({ current_turn_user_id: 42 }),
      participants: [makeParticipant(7, "Volo", "host")],
    });
    expect(computeTurnState(snapshot)).toEqual({ kind: "no_one" });
  });
});
