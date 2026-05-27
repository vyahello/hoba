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
 * Unknown emojis fall back to centre.
 */
export function reactionLaneFor(emoji: string, jitter: number = 0): number {
  const base = LANES[emoji] ?? 0.5;
  return Math.max(0, Math.min(1, base + jitter));
}
