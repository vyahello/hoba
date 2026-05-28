/**
 * Home-screen Quick Wheels per spec F2. The 6 presets land a new user
 * inside a spinnable wheel within ~10s of first open.
 *
 * Each preset declares its segments structurally (color seed, emoji)
 * and references locale-aware labels via i18n keys under the `home`
 * namespace (`quick_segments.<wheel_id>.<segment_key>`).
 */

interface QuickWheelSegmentDef {
  /** Slug used to build the i18n key — must be unique within the wheel. */
  key: string;
  emoji?: string;
  colorSeed: number;
}

export interface QuickWheel {
  id: string;
  /** i18n key under `home` namespace (e.g. `quick_wheels.eat`). */
  titleKey: string;
  emoji: string;
  /** Linear gradient endpoints — pulled from the brand palette. */
  gradient: readonly [string, string];
  segments: readonly QuickWheelSegmentDef[];
}

export const QUICK_WHEELS: readonly QuickWheel[] = [
  {
    id: "eat",
    titleKey: "quick_wheels.eat",
    emoji: "🍕",
    gradient: ["#FFB84D", "#FF5C9C"],
    segments: [
      { key: "pizza", emoji: "🍕", colorSeed: 0 },
      { key: "sushi", emoji: "🍣", colorSeed: 1 },
      { key: "burger", emoji: "🍔", colorSeed: 2 },
      { key: "salad", emoji: "🥗", colorSeed: 3 },
      { key: "tacos", emoji: "🌮", colorSeed: 4 },
      { key: "ramen", emoji: "🍜", colorSeed: 5 },
    ],
  },
  {
    id: "pays",
    titleKey: "quick_wheels.pays",
    emoji: "💸",
    gradient: ["#22C55E", "#5CE5FF"],
    segments: [
      { key: "you", colorSeed: 0 },
      { key: "me", colorSeed: 2 },
      { key: "split", colorSeed: 4 },
      { key: "next_time", colorSeed: 7 },
    ],
  },
  {
    id: "watch",
    titleKey: "quick_wheels.watch",
    emoji: "🎬",
    gradient: ["#7C5CFF", "#FF5C9C"],
    segments: [
      { key: "comedy", emoji: "😂", colorSeed: 0 },
      { key: "thriller", emoji: "😱", colorSeed: 1 },
      { key: "action", emoji: "💥", colorSeed: 2 },
      { key: "drama", emoji: "🎭", colorSeed: 3 },
      { key: "documentary", emoji: "🎬", colorSeed: 4 },
      { key: "anime", emoji: "🍙", colorSeed: 5 },
    ],
  },
  {
    id: "truth_dare",
    titleKey: "quick_wheels.truth_dare",
    emoji: "😈",
    gradient: ["#FF3B6B", "#7C5CFF"],
    segments: [
      { key: "truth", emoji: "💬", colorSeed: 6 },
      { key: "dare", emoji: "🔥", colorSeed: 10 },
      { key: "wild_card", emoji: "🃏", colorSeed: 5 },
      { key: "skip", emoji: "⏭️", colorSeed: 11 },
    ],
  },
  {
    id: "yes_no",
    titleKey: "quick_wheels.yes_no",
    emoji: "✅",
    gradient: ["#5CE5FF", "#7C5CFF"],
    segments: [
      { key: "yes", emoji: "✅", colorSeed: 4 },
      { key: "no", emoji: "❌", colorSeed: 10 },
    ],
  },
  {
    id: "friday",
    titleKey: "quick_wheels.friday",
    emoji: "🍻",
    gradient: ["#FFB84D", "#FF9F1C"],
    segments: [
      { key: "movies", emoji: "🎬", colorSeed: 0 },
      { key: "bar", emoji: "🍻", colorSeed: 1 },
      { key: "dinner", emoji: "🍝", colorSeed: 2 },
      { key: "stay_in", emoji: "🛋️", colorSeed: 3 },
      { key: "karaoke", emoji: "🎤", colorSeed: 5 },
      { key: "concert", emoji: "🎵", colorSeed: 7 },
    ],
  },
] as const;

export function findQuickWheel(id: string): QuickWheel | undefined {
  return QUICK_WHEELS.find((w) => w.id === id);
}
