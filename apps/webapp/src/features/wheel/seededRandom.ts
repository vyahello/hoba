/**
 * Mulberry32 — small, fast, deterministic PRNG. Returns a function that
 * yields uniform floats in [0, 1). Same seed → same sequence.
 *
 * Used by the spin engine so a `{seed, segmentCount}` pair uniquely
 * determines the outcome — enables replay debugging and (in Phase 6+)
 * makes server/client agreement trivial to verify.
 */

export function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return function next(): number {
    state = (state + 0x6d_2b_79_f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Pick a fresh 32-bit seed using `crypto.getRandomValues` (Telegram/web safe). */
export function freshSeed(): number {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return arr[0] ?? Date.now();
}
