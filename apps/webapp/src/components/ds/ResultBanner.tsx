import { motion } from "framer-motion";
import { type ReactNode } from "react";

import { cn } from "@/lib/cn";

export interface ResultBannerProps {
  segmentLabel: string;
  segmentEmoji?: string;
  /** Color from the wheel palette (hex string). */
  segmentColor: string;
  /** Name of the user who triggered the spin. */
  triggeredByName?: string;
  /** Mode-specific aftermath card (Chaos event sting, Punishment card, etc). */
  modeEffects?: ReactNode;
  className?: string;
}

/**
 * Post-spin hero. Phase 4 ships the visual shell — wired to real
 * `spin:settled` socket events in Phase 6.
 */
export function ResultBanner({
  segmentLabel,
  segmentEmoji,
  segmentColor,
  triggeredByName,
  modeEffects,
  className,
}: ResultBannerProps): JSX.Element {
  return (
    <motion.section
      initial={{ y: 60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", damping: 26, stiffness: 260, delay: 0.4 }}
      className={cn(
        // Neubrutalist: themed surface card (contrast-safe on any palette
        // color), bold ink border + hard shadow. The segment color is the
        // bold accent chip, not a full-bleed fill — so text stays legible.
        "rounded-xl p-6 border-[3px] border-ds-border shadow-brutal-lg",
        "bg-ds-surface text-ds-text relative overflow-hidden",
        className,
      )}
    >
      <div className="flex flex-col gap-3">
        {triggeredByName !== undefined ? (
          <p className="text-xs uppercase tracking-widest text-ds-text-muted">
            {triggeredByName} spun it
          </p>
        ) : null}
        <div className="flex items-center gap-3">
          {segmentEmoji !== undefined ? (
            <span
              className="text-4xl leading-none rounded-lg border-[3px] border-ds-border w-16 h-16 flex items-center justify-center shrink-0"
              style={{ backgroundColor: segmentColor }}
            >
              {segmentEmoji}
            </span>
          ) : (
            <span
              aria-hidden
              className="rounded-md border-[3px] border-ds-border w-3 self-stretch shrink-0"
              style={{ backgroundColor: segmentColor }}
            />
          )}
          <h2 className="font-display font-extrabold text-4xl leading-tight min-w-0 break-words">
            {segmentLabel}
          </h2>
        </div>
        {modeEffects !== undefined ? (
          <div className="mt-1">{modeEffects}</div>
        ) : null}
      </div>
    </motion.section>
  );
}
