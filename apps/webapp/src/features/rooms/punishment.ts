import { type PunishmentOutcome, type RoomState } from "@/lib/api";

export function isPunishment(snap: RoomState | null): boolean {
  return snap?.room.game_mode === "punishment";
}

/** Cumulative dares actually performed this session. */
export function doneCount(snap: RoomState | null): number {
  return snap?.room.punishment_done_count ?? 0;
}

/**
 * Phase of the punishment game:
 * - "betting": still in lobby, players choose their option.
 * - "playing": game underway (spins in turn).
 * - "over": someone reached N matches.
 */
export function punishmentPhase(
  snap: RoomState | null,
): "betting" | "playing" | "over" {
  if (snap?.room.punishment_winner_user_id != null) return "over";
  return snap?.room.status === "lobby" ? "betting" : "playing";
}

/** Each player's bet, `{ userId: segmentId }`. */
export function bets(snap: RoomState | null): Record<string, number> {
  return snap?.room.punishment_bets ?? {};
}

/** The current viewer's own bet, or null. */
export function myBet(snap: RoomState | null): number | null {
  if (snap == null) return null;
  return snap.room.punishment_bets?.[String(snap.me_user_id)] ?? null;
}

/** User ids that have placed a bet (sorted). */
export function bettorIds(snap: RoomState | null): number[] {
  return Object.keys(bets(snap))
    .map(Number)
    .sort((a, b) => a - b);
}

/** Matches each player has scored, `{ userId: count }`. */
export function matchCounts(snap: RoomState | null): Record<string, number> {
  return snap?.room.punishment_match_counts ?? {};
}

export function matchCount(snap: RoomState | null, userId: number): number {
  return matchCounts(snap)[String(userId)] ?? 0;
}

/** Matches needed to win (host's spin_count; min 3). */
export function matchesToWin(snap: RoomState | null): number {
  const n = snap?.room.spin_count ?? 3;
  return n > 1 ? n : 3;
}

export function winnerUserId(snap: RoomState | null): number | null {
  return snap?.room.punishment_winner_user_id ?? null;
}

export function lastOutcome(snap: RoomState | null): PunishmentOutcome | null {
  return snap?.room.punishment_last_outcome ?? null;
}

/** A dare is pending the spinner's done/refuse (blocks the turn). */
export function pendingPunishment(
  snap: RoomState | null,
): PunishmentOutcome | null {
  const o = lastOutcome(snap);
  return o != null && o.kind === "punish" && !o.resolved ? o : null;
}

/** True if the current viewer is the one who must resolve a pending dare. */
export function isMyPunishment(snap: RoomState | null): boolean {
  const o = pendingPunishment(snap);
  return o != null && snap != null && o.spinner_id === snap.me_user_id;
}

export function isMyTurn(snap: RoomState | null): boolean {
  return snap != null && snap.room.current_turn_user_id === snap.me_user_id;
}

/** Whether every present player has placed a bet (host may then start). */
export function allPresentBet(
  snap: RoomState | null,
  present: number[],
): boolean {
  const placed = new Set(bettorIds(snap));
  return present.length > 0 && present.every((u) => placed.has(u));
}

/** Present user ids that have not yet placed a bet. */
export function waitingOnBetIds(
  snap: RoomState | null,
  present: number[],
): number[] {
  const placed = new Set(bettorIds(snap));
  return present.filter((u) => !placed.has(u));
}
