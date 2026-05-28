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

  it("returns no_one when cursor is null", () => {
    const snapshot = makeSnapshot({
      me_user_id: 7,
      room: makeRoom({ current_turn_user_id: null }),
      participants: [makeParticipant(7, "Volo", "host")],
    });
    expect(computeTurnState(snapshot)).toEqual({ kind: "no_one" });
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
