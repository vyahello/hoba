import { type PunishmentOutcome, type RoomState } from "@/lib/api";

export function isPunishment(snap: RoomState | null): boolean {
  return snap?.room.game_mode === "punishment";
}

/** Cumulative dares actually performed this session (global). */
export function doneCount(snap: RoomState | null): number {
  return snap?.room.punishment_done_count ?? 0;
}

/** Dares performed by a specific player. */
export function perPlayerDoneCount(snap: RoomState | null, userId: number): number {
  return snap?.room.punishment_done_counts?.[String(userId)] ?? 0;
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

/** Matches needed to win (host's spin_count). */
export function matchesToWin(snap: RoomState | null): number {
  return snap?.room.spin_count ?? 3;
}

export function winnerUserId(snap: RoomState | null): number | null {
  return snap?.room.punishment_winner_user_id ?? null;
}

export function lastOutcome(snap: RoomState | null): PunishmentOutcome | null {
  return snap?.room.punishment_last_outcome ?? null;
}

/** A dare is pending (either unresolved or awaiting approval). */
export function pendingPunishment(
  snap: RoomState | null,
): PunishmentOutcome | null {
  const o = lastOutcome(snap);
  return o != null && o.kind === "punish" && !o.resolved ? o : null;
}

/** True if the current viewer needs to press Done/Refuse (not yet pending approval). */
export function isMyPunishment(snap: RoomState | null): boolean {
  const o = pendingPunishment(snap);
  if (o == null || snap == null) return false;
  return o.spinner_id === snap.me_user_id && !(o.pending_approval ?? false);
}

/** True while the dare is waiting for the approver (dare was "done", not approved yet). */
export function pendingApproval(snap: RoomState | null): boolean {
  const o = lastOutcome(snap);
  return o != null && o.kind === "punish" && !o.resolved && (o.pending_approval ?? false);
}

/** The user_id designated as approver, or null. */
export function approverUserId(snap: RoomState | null): number | null {
  if (!pendingApproval(snap)) return null;
  return snap?.room.punishment_last_outcome?.approver_user_id ?? null;
}

/** True if the current viewer is the chosen approver. */
export function isMyApproval(snap: RoomState | null): boolean {
  if (snap == null) return false;
  return approverUserId(snap) === snap.me_user_id;
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
