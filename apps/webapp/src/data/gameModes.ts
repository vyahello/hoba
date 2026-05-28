import { type GameMode } from "@/lib/api";

export interface GameModeMeta {
  id: GameMode;
  emoji: string;
  /** i18n key under `room` namespace, suffixed with `.label` and `.tagline`. */
  i18nKey: string;
}

/**
 * Picker order = display order. Rigged is intentionally excluded —
 * see spec §5.5 (revealed via 1.5 s long-press, not via picker).
 */
export const PICKABLE_GAME_MODES: readonly GameModeMeta[] = [
  { id: "classic", emoji: "🎯", i18nKey: "modes.classic" },
  { id: "elimination", emoji: "💥", i18nKey: "modes.elimination" },
  { id: "punishment", emoji: "🃏", i18nKey: "modes.punishment" },
  { id: "chaos", emoji: "🌀", i18nKey: "modes.chaos" },
];

export const DEFAULT_GAME_MODE: GameMode = "classic";

export function getGameModeMeta(id: GameMode): GameModeMeta | undefined {
  return PICKABLE_GAME_MODES.find((m) => m.id === id);
}

/**
 * Whether the RoomPage header should render a GameModeBadge for this mode.
 * Classic = false (no badge for the default). Rigged = false (defensive;
 * don't accidentally reveal the long-press feature in the header).
 */
export function shouldShowBadge(mode: GameMode): boolean {
  return mode !== "classic" && mode !== "rigged";
}
