import { type RoomState } from "@/lib/api";

/**
 * Whether the calling user is allowed to spin in the current room
 * snapshot. Mirrors the server-side check in
 * `apps/api/src/hoba_api/services/spins._user_can_spin` — keep the two
 * in lockstep or the hub will invite a tap the server then rejects.
 *
 * `turn_based` rooms behave like `host_only` until the per-turn rotation
 * lands (docs/TODO.md stage:D — required by Punishment + Elimination).
 *
 * `snapshot.me_user_id` is the server-provided internal user_id of THIS
 * connection. Telegram's `initDataUnsafe.user.id` is the tg_id, a
 * different number space, and must never be used here — that bug was
 * the entire point of commit 7db1b0a (Stage A).
 */
export function computeCanSpin(snapshot: RoomState | null): boolean {
  if (snapshot === null) return false;
  if (snapshot.room.spin_policy === "anyone") return true;
  const myParticipant = snapshot.participants.find(
    (p) => p.user_id === snapshot.me_user_id,
  );
  return myParticipant?.role === "host";
}
