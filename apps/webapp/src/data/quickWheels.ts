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
      { key: "tacos", emoji: "🌮", colorSeed: 3 },
      { key: "ramen", emoji: "🍜", colorSeed: 4 },
      { key: "shawarma", emoji: "🌯", colorSeed: 5 },
    ],
  },
  {
    id: "pays",
    titleKey: "quick_wheels.pays",
    emoji: "💸",
    gradient: ["#22C55E", "#5CE5FF"],
    segments: [
      { key: "you", emoji: "🫵", colorSeed: 0 },
      { key: "me", emoji: "😎", colorSeed: 2 },
      { key: "split", emoji: "🤝", colorSeed: 4 },
      { key: "guys", emoji: "✊", colorSeed: 6 },
    ],
  },
  {
    id: "watch",
    titleKey: "quick_wheels.watch",
    emoji: "🎬",
    gradient: ["#7C5CFF", "#FF5C9C"],
    segments: [
      { key: "superhero", emoji: "🦸", colorSeed: 0 },
      { key: "crime", emoji: "🔪", colorSeed: 1 },
      { key: "comedy", emoji: "😂", colorSeed: 2 },
      { key: "scifi", emoji: "🚀", colorSeed: 3 },
      { key: "romance", emoji: "💘", colorSeed: 4 },
      { key: "horror", emoji: "👻", colorSeed: 5 },
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
      { key: "spicy_truth", emoji: "🌶️", colorSeed: 3 },
      { key: "double_dare", emoji: "😈", colorSeed: 4 },
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
      { key: "hell_yes", emoji: "🔥", colorSeed: 0 },
      { key: "no_way", emoji: "🙅", colorSeed: 7 },
    ],
  },
  {
    id: "friday",
    titleKey: "quick_wheels.friday",
    emoji: "🍻",
    gradient: ["#FFB84D", "#FF9F1C"],
    segments: [
      { key: "rooftop", emoji: "🌆", colorSeed: 0 },
      { key: "ps5", emoji: "🎮", colorSeed: 1 },
      { key: "walk", emoji: "🚶", colorSeed: 2 },
      { key: "trip", emoji: "🚗", colorSeed: 3 },
      { key: "party", emoji: "🎉", colorSeed: 5 },
      { key: "midnight_snack", emoji: "🍟", colorSeed: 7 },
    ],
  },
] as const;

export function findQuickWheel(id: string): QuickWheel | undefined {
  return QUICK_WHEELS.find((w) => w.id === id);
}
