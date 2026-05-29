import { type RoomState } from "@/lib/api";

/**
 * Status of the turn cursor as the room screen needs to render it.
 * Only meaningful when room.spin_policy === "turn_based"; otherwise
 * the discriminated union resolves to `not_turn_based` and the UI
 * suppresses the status line entirely.
 */
export type TurnState =
  | { kind: "not_turn_based" }
  | { kind: "my_turn" }
  | { kind: "waiting"; whoUserId: number; whoName: string | null }
  | { kind: "no_one" };

/**
 * The effective turn-holder for a turn_based room, mirroring the server's
 * `trigger_spin` seeding rule: in a turn_based room still in the `lobby`,
 * `current_turn_user_id` is null until the first spin, which the server
 * seeds to `host_id`. So before that first spin the host is the effective
 * turn-holder and must be allowed to kick things off — otherwise the room
 * deadlocks (no one holds the turn, so no one can spin to seed it).
 *
 * Only meaningful when `room.spin_policy === "turn_based"`; callers gate on
 * that before invoking. Returns null when there is genuinely no turn-holder
 * (cursor null while active/closed — e.g. advance_turn found no one online).
 */
export function effectiveTurnUserId(snapshot: RoomState): number | null {
  const cursor = snapshot.room.current_turn_user_id;
  if (cursor !== null) return cursor;
  if (snapshot.room.status === "lobby") return snapshot.room.host_id;
  return null;
}

export function computeTurnState(snapshot: RoomState | null): TurnState {
  if (snapshot === null) return { kind: "not_turn_based" };
  if (snapshot.room.spin_policy !== "turn_based") {
    return { kind: "not_turn_based" };
  }
  const cursor = effectiveTurnUserId(snapshot);
  if (cursor === null) return { kind: "no_one" };
  if (cursor === snapshot.me_user_id) return { kind: "my_turn" };
  const who = snapshot.participants.find((p) => p.user_id === cursor);
  if (who === undefined) return { kind: "no_one" };
  return { kind: "waiting", whoUserId: cursor, whoName: who.display_name };
}
