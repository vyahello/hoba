import { type RoomState } from "@/lib/api";

export function isPunishment(snap: RoomState | null): boolean {
  return snap?.room.game_mode === "punishment";
}

/**
 * Stopgap during the Punishment v2 migration. The legacy single-victim
 * `punishment_active_card` field is gone from the server; the prediction-wager
 * card model (per-loser cards via `punishment_cards`) lands with the RoomPage UI
 * rework (plan Task 10). Until then these keep the old card block inert so the
 * page compiles without rendering stale state.
 */
export function activeCard(_snap: RoomState | null): null {
  return null;
}

export function hasPendingCard(_snap: RoomState | null): boolean {
  return false;
}

export function doneCount(snap: RoomState | null): number {
  return snap?.room.punishment_done_count ?? 0;
}
