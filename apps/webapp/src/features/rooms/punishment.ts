import { type PunishmentCard, type RoomState } from "@/lib/api";

export function isPunishment(snap: RoomState | null): boolean {
  return snap?.room.game_mode === "punishment";
}

export function doneCount(snap: RoomState | null): number {
  return snap?.room.punishment_done_count ?? 0;
}

export function punishmentPhase(
  snap: RoomState | null,
): "predicting" | "resolved" {
  return (snap?.room.punishment_cards ?? null) === null
    ? "predicting"
    : "resolved";
}

export function lockedUserIds(snap: RoomState | null): number[] {
  return snap?.room.punishment_locked_user_ids ?? [];
}

export function myPrediction(snap: RoomState | null): number | null {
  return snap?.room.punishment_my_prediction ?? null;
}

export function pendingCards(
  snap: RoomState | null,
): Array<{ userId: number } & PunishmentCard> {
  const cards = snap?.room.punishment_cards ?? null;
  if (cards === null) return [];
  return Object.entries(cards).map(([uid, card]) => ({
    userId: Number(uid),
    ...card,
  }));
}

export function isEveryoneEscaped(snap: RoomState | null): boolean {
  const cards = snap?.room.punishment_cards ?? null;
  const preds = snap?.room.punishment_predictions ?? null;
  return (
    cards !== null &&
    Object.keys(cards).length === 0 &&
    preds !== null &&
    Object.keys(preds).length > 0
  );
}

export function allPresentLocked(
  snap: RoomState | null,
  present: number[],
): boolean {
  const locked = new Set(lockedUserIds(snap));
  return present.length > 0 && present.every((u) => locked.has(u));
}

export function waitingOnUserIds(
  snap: RoomState | null,
  present: number[],
): number[] {
  const locked = new Set(lockedUserIds(snap));
  return present.filter((u) => !locked.has(u));
}
