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
  "roaming_pointer",
] as const;

export const CHAOS_EVENT_EMOJI: Record<string, string> = {
  multi_spin: "⚡️",
  slow_burn: "🐢",
  reverse: "🔄",
  swap: "🔀",
  nudge_fwd: "⏩",
  nudge_back: "⏪",
  blind_pointer: "🫥",
  roaming_pointer: "🎯",
};

/** One leg of the roaming-pointer path: an absolute screen angle + how long
 * to travel there. */
export interface RoamHop {
  deg: number;
  ms: number;
}

/**
 * Build the `roaming_pointer` path: the wheel is still and the pointer wanders
 * across the options (forward/back, frequent reversals — fun to watch), then
 * settles **exactly on the result segment's centre**.
 *
 * Works in a *virtual* (unwrapped) segment index so the pointer never jumps
 * across the 0/360 seam — it just keeps rotating the short way each hop. The
 * final hop lands on a virtual index ≡ `resultIndex (mod n)`, i.e. the result.
 */
export function buildRoamHops(
  segmentCount: number,
  resultIndex: number,
  wheelRotationDeg: number,
  rng: () => number = Math.random,
): RoamHop[] {
  const sector = 360 / segmentCount;
  const centerDeg = (v: number): number => v * sector + sector / 2 + wheelRotationDeg;
  const hops: RoamHop[] = [];
  let v = 0; // start at the top option
  let dir = rng() < 0.5 ? 1 : -1;
  const wander = 7 + Math.floor(rng() * 4); // 7–10 wandering hops
  for (let k = 0; k < wander; k++) {
    if (rng() < 0.4) dir = -dir; // frequent reversals
    v += dir; // one option at a time, so each hop is clearly visible
    // Slow down progressively so the travel reads (and builds tension).
    hops.push({ deg: centerDeg(v), ms: 280 + Math.round((k / wander) * 260) });
  }
  // Settle: hover one before / one after the result, then land on it.
  const gap = (((v - resultIndex) % segmentCount) + segmentCount) % segmentCount;
  const landingV = v - gap; // ≡ resultIndex (mod n)
  hops.push({ deg: centerDeg(landingV - 1), ms: 520 });
  hops.push({ deg: centerDeg(landingV + 1), ms: 460 });
  hops.push({ deg: centerDeg(landingV), ms: 720 });
  return hops;
}

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
