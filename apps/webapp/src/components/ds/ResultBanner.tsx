import { motion } from "framer-motion";
import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation("room");
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
      {/* Static top sheen — painted once (no animation, no blur), it gives the
          card a faint glassy catch-light along the top edge. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1/3"
        style={{ background: "linear-gradient(to bottom, rgba(255,255,255,0.14), transparent)" }}
      />
      <div className="relative flex flex-col gap-3">
        {triggeredByName !== undefined ? (
          <p className="text-xs uppercase tracking-widest text-ds-text-muted">
            {t("result.spun_by", { name: triggeredByName })}
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
