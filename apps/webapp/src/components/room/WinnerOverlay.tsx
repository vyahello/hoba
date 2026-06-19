import { motion } from "framer-motion";

import { Button } from "@/components/ds/Button";
import { HobaWord } from "@/components/ds/HobaWord";

interface WinnerOverlayProps {
  /** Optional emoji shown next to the cup (the winning segment's emoji). */
  emoji?: string | null;
  /** Already-translated winner headline, e.g. "🍺 Beer wins!". */
  title: string;
  isHost: boolean;
  /** Host-only "new game / new round" button label + handler. */
  actionLabel: string;
  onAction: () => void;
  /** Shown to non-hosts in place of the action button. */
  waitingLabel: string;
}

/**
 * The end-of-game celebration, shown for EVERY mode as a centered overlay
 * (z-30) so the result is unmissable without scrolling — the same popup
 * pattern Classic's per-spin reveal already uses. The host gets the
 * new-game action; guests see the waiting note. Renders inside the room's
 * `relative` <main>, covering the wheel/standings beneath.
 */
export function WinnerOverlay({
  emoji,
  title,
  isHost,
  actionLabel,
  onAction,
  waitingLabel,
}: WinnerOverlayProps): JSX.Element {
  return (
    <motion.div
      key="winner-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
      className="absolute inset-0 z-30 px-4 pt-3 pb-6 flex flex-col items-center justify-center gap-4 bg-ds-bg text-center"
      aria-live="assertive"
      role="status"
    >
      {/* Skewed brand exclamation — the celebratory "Хоба!" beat. */}
      <motion.div
        initial={{ scale: 0.3, opacity: 0, skewX: -18, rotate: -10 }}
        animate={{ scale: 1, opacity: 1, skewX: -11, rotate: -4 }}
        transition={{ type: "spring", damping: 9, stiffness: 240 }}
        className="origin-center"
      >
        <HobaWord />
      </motion.div>
      <motion.span
        initial={{ scale: 0.4, rotate: -10, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={{ delay: 0.15, type: "spring", damping: 12, stiffness: 220 }}
        className="text-7xl leading-none"
        aria-hidden
      >
        {emoji ? `${emoji} ` : ""}🏆
      </motion.span>
      <h2 className="font-display font-extrabold text-3xl text-brand-accent px-4">
        {title}
      </h2>
      {isHost ? (
        <Button variant="primary" size="lg" className="mt-2" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : (
        <p className="text-sm text-ds-text-muted">{waitingLabel}</p>
      )}
    </motion.div>
  );
}
