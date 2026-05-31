/**
 * Chaos mode (§5.4) client helpers.
 *
 * The event is decided server-side and arrives in `spin:started.mode_effects`.
 * These pure helpers turn that payload into render decisions; the timing /
 * announcement-card orchestration lives in the RoomPage spin-drive effect.
 */

/** The events Chaos can roll (server `CHAOS_EVENTS`). One fires every spin. */
export const CHAOS_EVENTS = [
  "multi_spin",
  "slow_burn",
  "reverse",
  "swap",
  "nudge_fwd",
  "nudge_back",
  "blind_pointer",
] as const;

export const CHAOS_EVENT_EMOJI: Record<string, string> = {
  multi_spin: "⚡️",
  slow_burn: "🐢",
  reverse: "🔄",
  swap: "🔀",
  nudge_fwd: "⏩",
  nudge_back: "⏪",
  blind_pointer: "🫥",
};

/**
 * Reorder living segments to match the server's spin order for this spin.
 *
 * The `swap` event spins over a re-ordered set, so the client must render the
 * same order or the wheel lands on the wrong sector. Every other event (and
 * every non-chaos spin) leaves `order` undefined and the living order stands.
 * Ids missing from `order` sort to the front (indexOf → -1) but in practice
 * `order` always lists every living segment.
 */
export function orderSegmentsForSpin<T extends { id: number }>(
  living: T[],
  order: number[] | undefined,
): T[] {
  if (order === undefined || order.length === 0) return living;
  return [...living].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}
