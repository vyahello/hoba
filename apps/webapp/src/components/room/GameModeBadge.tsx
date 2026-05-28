import { useTranslation } from "react-i18next";

import { getGameModeMeta, shouldShowBadge } from "@/data/gameModes";
import { type GameMode } from "@/lib/api";
import { cn } from "@/lib/cn";

export interface GameModeBadgeProps {
  mode: GameMode;
  className?: string;
}

/**
 * Small chip showing `{emoji} {label}` for the room's current
 * game_mode. Renders null for `classic` (the default — no badge for
 * the boring case) and `rigged` (defensive: don't accidentally reveal
 * the long-press feature in the header).
 */
export function GameModeBadge({
  mode,
  className,
}: GameModeBadgeProps): JSX.Element | null {
  const { t } = useTranslation(["room"]);
  // getGameModeMeta returns undefined for any mode not in
  // PICKABLE_GAME_MODES (currently only "rigged"). shouldShowBadge
  // additionally hides classic — the default has no badge. Both
  // checks are real type-level information, not defensive fallbacks.
  const meta = getGameModeMeta(mode);
  if (meta === undefined || !shouldShowBadge(mode)) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5",
        "px-2.5 py-1 rounded-full",
        "bg-surface-light-2 dark:bg-surface-dark-2",
        "text-sm font-medium text-ink-light-1 dark:text-ink-dark-1",
        className,
      )}
    >
      <span aria-hidden>{meta.emoji}</span>
      <span>{t(`room:${meta.i18nKey}.label`)}</span>
    </span>
  );
}
