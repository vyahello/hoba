import { type GameMode, type PunishmentDeck } from "@/lib/api";

export interface GameModeMeta {
  id: GameMode;
  emoji: string;
  /** i18n key under `room` namespace, suffixed with `.label` and `.tagline`. */
  i18nKey: string;
}

export interface PunishmentDeckMeta {
  id: PunishmentDeck;
  emoji: string;
  /** i18n key under `room` namespace, suffixed with `.label`. */
  i18nKey: string;
}

export const PUNISHMENT_DECKS: readonly PunishmentDeckMeta[] = [
  { id: "mild", emoji: "🙂", i18nKey: "punishment.deck_mild" },
  { id: "spicy", emoji: "🌶️", i18nKey: "punishment.deck_spicy" },
  { id: "chaos", emoji: "🔥", i18nKey: "punishment.deck_chaos" },
];

export const DEFAULT_PUNISHMENT_DECK: PunishmentDeck = "mild";

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

/**
 * Rigged 🎭 is NOT pickable (entered via the hidden long-press), but the host
 * still needs a badge for it. Guests never see `game_mode === "rigged"` — the
 * server redacts it to "classic" — so showing a badge for rigged only ever
 * surfaces to the host.
 */
const RIGGED_META: GameModeMeta = { id: "rigged", emoji: "🎭", i18nKey: "modes.rigged" };

export function getGameModeMeta(id: GameMode): GameModeMeta | undefined {
  if (id === "rigged") return RIGGED_META;
  return PICKABLE_GAME_MODES.find((m) => m.id === id);
}

/**
 * Whether the RoomPage header should render a GameModeBadge for this mode.
 * Classic = false (no badge for the default / for the redacted guest view of a
 * rigged room). Everything else (including rigged, which only the host sees as
 * "rigged") shows a badge.
 */
export function shouldShowBadge(mode: GameMode): boolean {
  return mode !== "classic";
}

/** Best-of-N options (odd → fewer ties). Default 1. */
export const SPIN_COUNTS = [1, 3, 5, 7] as const;
export const DEFAULT_SPIN_COUNT = 1;
/** Punishment: matches needed to win. Default 3. */
export const DEFAULT_PUNISHMENT_SPIN_COUNT = 3;
/** Chaos: best-of-N spins, most-frequent wins. Default 3 (odd → fewer ties). */
export const DEFAULT_CHAOS_SPIN_COUNT = 3;
