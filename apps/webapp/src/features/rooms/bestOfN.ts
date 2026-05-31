import { type RoomState } from "@/lib/api";

/** Best-of-N is active in Classic + Rigged rooms with a target above 1.
 * (Rigged is a Classic variant; the host sees game_mode "rigged" — guests get
 * it redacted to "classic" — and best-of-N must work the same for both.) */
export function isBestOfN(snap: RoomState | null): boolean {
  const mode = snap?.room.game_mode;
  return (mode === "classic" || mode === "rigged") && (snap?.room.spin_count ?? 1) > 1;
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
