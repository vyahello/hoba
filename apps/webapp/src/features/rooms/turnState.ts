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

export function computeTurnState(snapshot: RoomState | null): TurnState {
  if (snapshot === null) return { kind: "not_turn_based" };
  if (snapshot.room.spin_policy !== "turn_based") {
    return { kind: "not_turn_based" };
  }
  const cursor = snapshot.room.current_turn_user_id;
  if (cursor === null) return { kind: "no_one" };
  if (cursor === snapshot.me_user_id) return { kind: "my_turn" };
  const who = snapshot.participants.find((p) => p.user_id === cursor);
  if (who === undefined) return { kind: "no_one" };
  return { kind: "waiting", whoUserId: cursor, whoName: who.display_name };
}
