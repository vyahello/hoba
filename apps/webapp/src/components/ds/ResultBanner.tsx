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
        "rounded-xl p-6 shadow-spin relative overflow-hidden text-white",
        className,
      )}
      style={{
        background:
          `linear-gradient(135deg, ${segmentColor} 0%, ${segmentColor}cc 60%, #0E0B1Aaa 130%)`,
      }}
    >
      <div className="absolute -right-6 -top-6 w-32 h-32 rounded-full bg-white/15 blur-2xl pointer-events-none" />
      <div className="relative flex flex-col gap-2">
        {triggeredByName !== undefined ? (
          <p className="text-xs uppercase tracking-widest opacity-80">
            {triggeredByName} spun it
          </p>
        ) : null}
        <div className="flex items-baseline gap-3">
          {segmentEmoji !== undefined ? (
            <span className="text-5xl leading-none">{segmentEmoji}</span>
          ) : null}
          <h2 className="font-display font-extrabold text-4xl leading-tight">
            {segmentLabel}
          </h2>
        </div>
        {modeEffects !== undefined ? (
          <div className="mt-3">{modeEffects}</div>
        ) : null}
      </div>
    </motion.section>
  );
}
