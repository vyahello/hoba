import { type RoomState, type ServerRoom } from "@/lib/api";

export function isPunishment(snap: RoomState | null): boolean {
  return snap?.room.game_mode === "punishment";
}

export function activeCard(
  snap: RoomState | null,
): ServerRoom["punishment_active_card"] {
  return snap?.room.punishment_active_card ?? null;
}

export function hasPendingCard(snap: RoomState | null): boolean {
  return activeCard(snap) !== null;
}

export function doneCount(snap: RoomState | null): number {
  return snap?.room.punishment_done_count ?? 0;
}
