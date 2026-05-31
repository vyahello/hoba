import { type RoomState } from "@/lib/api";

/** Best-of-N is active in Classic rooms with a target above 1. */
export function isBestOfN(snap: RoomState | null): boolean {
  return snap?.room.game_mode === "classic" && (snap?.room.spin_count ?? 1) > 1;
}

export function attempts(snap: RoomState | null): number {
  return snap?.room.bon_attempts ?? 0;
}

export function target(snap: RoomState | null): number {
  return snap?.room.spin_count ?? 1;
}

/** Current-round hit counts as a Map<segmentId, count>. */
export function tally(snap: RoomState | null): Map<number, number> {
  const raw = snap?.room.bon_tally ?? null;
  const out = new Map<number, number>();
  if (raw === null) return out;
  for (const [k, v] of Object.entries(raw)) out.set(Number(k), v);
  return out;
}

export function roundWinnerId(snap: RoomState | null): number | null {
  return snap?.room.bon_winner_segment_id ?? null;
}

/** Whether the round has finalized (a winner is decided → spinning gated). */
export function roundOver(snap: RoomState | null): boolean {
  return roundWinnerId(snap) !== null;
}
