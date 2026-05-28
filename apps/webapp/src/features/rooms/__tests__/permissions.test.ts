import { describe, expect, it } from "vitest";

import { type RoomState } from "@/lib/api";

import { computeCanSpin, isHost } from "../permissions";

function makeSnapshot(args: {
  spin_policy: "anyone" | "host_only" | "turn_based";
  me_user_id: number;
  participants: Array<{ user_id: number; role: "host" | "guest" }>;
  current_turn_user_id?: number | null;
}): RoomState {
  return {
    room: {
      id: 1,
      code: "ABC123",
      host_id: args.participants.find((p) => p.role === "host")?.user_id ?? 0,
      title: null,
      status: "active",
      game_mode: "classic",
      spin_policy: args.spin_policy,
      suggestion_policy: "off",
      is_locked: false,
      is_anonymous: false,
      current_turn_user_id: args.current_turn_user_id ?? null,
      created_at: "2026-05-27T00:00:00Z",
      closed_at: null,
    },
    participants: args.participants.map((p) => ({
      user_id: p.user_id,
      role: p.role,
      display_name: `user-${p.user_id}`,
      avatar_url: null,
      joined_at: "2026-05-27T00:00:00Z",
      last_seen_at: "2026-05-27T00:00:00Z",
      is_online: true,
    })),
    active_question: null,
    last_spin: null,
    me_user_id: args.me_user_id,
  };
}

describe("computeCanSpin", () => {
  it("returns false when snapshot is null (room hasn't loaded yet)", () => {
    expect(computeCanSpin(null)).toBe(false);
  });

  it("returns true under `anyone` policy regardless of role", () => {
    expect(
      computeCanSpin(
        makeSnapshot({
          spin_policy: "anyone",
          me_user_id: 42,
          participants: [
            { user_id: 1, role: "host" },
            { user_id: 42, role: "guest" },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("returns true under `host_only` when the caller is the host", () => {
    expect(
      computeCanSpin(
        makeSnapshot({
          spin_policy: "host_only",
          me_user_id: 7,
          participants: [
            { user_id: 7, role: "host" },
            { user_id: 12, role: "guest" },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("returns false under `host_only` when the caller is a guest", () => {
    // Regression for 7db1b0a: this branch was incorrectly returning true
    // because the client compared Telegram tg_id to internal user_id.
    // Now that the server returns me_user_id on RoomState, the role
    // lookup actually finds the right participant.
    expect(
      computeCanSpin(
        makeSnapshot({
          spin_policy: "host_only",
          me_user_id: 12,
          participants: [
            { user_id: 7, role: "host" },
            { user_id: 12, role: "guest" },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("returns false when me_user_id doesn't match any participant", () => {
    // Mid-reconnect race: snapshot might arrive before the caller's
    // participant row is rehydrated. Fail safe — treat as guest.
    expect(
      computeCanSpin(
        makeSnapshot({
          spin_policy: "host_only",
          me_user_id: 999,
          participants: [{ user_id: 7, role: "host" }],
        }),
      ),
    ).toBe(false);
  });

  it("returns false under `host_only` when me_user_id is the default -1", () => {
    // Pre-Stage-A code path: when the server doesn't yet send
    // me_user_id, RoomPage falls back to -1. That sentinel must never
    // satisfy the host role check.
    expect(
      computeCanSpin(
        makeSnapshot({
          spin_policy: "host_only",
          me_user_id: -1,
          participants: [{ user_id: 7, role: "host" }],
        }),
      ),
    ).toBe(false);
  });

  it("isHost: true only when caller's participant row says host", () => {
    expect(isHost(null)).toBe(false);
    const hostSnap = makeSnapshot({
      spin_policy: "anyone",
      me_user_id: 1,
      participants: [
        { user_id: 1, role: "host" },
        { user_id: 2, role: "guest" },
      ],
    });
    const guestSnap = makeSnapshot({
      spin_policy: "anyone",
      me_user_id: 2,
      participants: [
        { user_id: 1, role: "host" },
        { user_id: 2, role: "guest" },
      ],
    });
    expect(isHost(hostSnap)).toBe(true);
    expect(isHost(guestSnap)).toBe(false);
  });

  it("isHost: false when me_user_id doesn't appear in participants", () => {
    expect(
      isHost(
        makeSnapshot({
          spin_policy: "anyone",
          me_user_id: 99,
          participants: [{ user_id: 1, role: "host" }],
        }),
      ),
    ).toBe(false);
  });

  it("treats `turn_based` like `host_only` until per-turn rotation lands", () => {
    // Server-side services/spins.user_can_spin currently treats
    // turn_based as host_only (TODO docs/TODO.md stage:D). Client
    // mirrors that so the hub state matches what the server will allow.
    const hostSnap = makeSnapshot({
      spin_policy: "turn_based",
      me_user_id: 7,
      participants: [
        { user_id: 7, role: "host" },
        { user_id: 12, role: "guest" },
      ],
    });
    const guestSnap = makeSnapshot({
      spin_policy: "turn_based",
      me_user_id: 12,
      participants: [
        { user_id: 7, role: "host" },
        { user_id: 12, role: "guest" },
      ],
    });
    expect(computeCanSpin(hostSnap)).toBe(true);
    expect(computeCanSpin(guestSnap)).toBe(false);
  });
});
