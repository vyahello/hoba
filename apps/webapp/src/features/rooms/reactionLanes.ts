/**
 * Reaction emoji set + per-emoji horizontal lane for the FlyingReactions
 * overlay. The bar in `ReactionsBar.tsx` renders the same five emojis in
 * order; each lane value is the x in `[0, 1]` that `FlyingReactions`
 * converts into `left: x * 90 + 5` percent — so 0.19 lands at 22 %,
 * 0.5 at centre, etc. Lanes were chosen so the in-flight emoji emerges
 * roughly above the button that was tapped on phone-width viewports.
 */
export const REACTION_EMOJIS = ["😂", "🔥", "💀", "👍", "🎉"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

const LANES: Readonly<Record<string, number>> = {
  "😂": 0.19,
  "🔥": 0.35,
  "💀": 0.5,
  "👍": 0.65,
  "🎉": 0.81,
};

/**
 * Resolve the horizontal lane (in `[0, 1]`) for a given reaction emoji.
 * Caller may pass small `jitter` (e.g. `(Math.random() - 0.5) * 0.05`)
 * so a burst of identical reactions doesn't stack on the same pixel.
 * Custom (non-default) emojis get a STABLE lane derived from their code
 * points — spread across `[0.15, 0.85]` so different customs don't all
 * stack in the centre, while the same custom always flies in one lane.
 */
export function reactionLaneFor(emoji: string, jitter: number = 0): number {
  const base = LANES[emoji] ?? hashedLane(emoji);
  return Math.max(0, Math.min(1, base + jitter));
}

function hashedLane(emoji: string): number {
  let h = 0;
  for (const ch of emoji) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return 0.15 + (h % 1000) / 1000 * 0.7; // 0.15 … 0.85
}
