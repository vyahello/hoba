import { useTranslation } from "react-i18next";

import { audio } from "@/audio";
import { cn } from "@/lib/cn";
import { haptics } from "@/lib/haptics";

export interface QuickWheelCardProps {
  /** Already-resolved title (templates are localized server-side). */
  title: string;
  emoji: string;
  /** Linear-gradient endpoints — brand palette hex pair. */
  gradient: readonly [string, string];
  onTap: () => void;
  className?: string;
}

export function QuickWheelCard({
  title,
  emoji,
  gradient,
  onTap,
  className,
}: QuickWheelCardProps): JSX.Element {
  const { t } = useTranslation("home");
  return (
    <button
      type="button"
      onClick={() => {
        haptics.medium();
        audio.play("ui_tap");
        onTap();
      }}
      aria-label={title}
      className={cn(
        "ds-tactile relative aspect-[5/4] w-full overflow-hidden",
        "rounded-lg p-4 text-left text-white",
        "border-[3px] border-ds-border shadow-brutal active:shadow-brutal-sm",
        "flex flex-col justify-between",
        className,
      )}
      style={{
        // A STATIC two-stop gradient between the template's brand hexes —
        // rasterized once into the card's layer, so it costs the same as the
        // old flat fill but reads with depth. (The earlier "flat & cheap" note
        // conflated static gradients with animated ones; only the latter cost.)
        backgroundImage: `linear-gradient(145deg, ${gradient[0]}, ${gradient[1]})`,
        backgroundColor: gradient[0],
      }}
    >
      {/* Top catch-light + bottom scrim — both static. The scrim guarantees
          white-text legibility (AA) over any brand-colour pair. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-2/5"
        style={{ background: "linear-gradient(to bottom, rgba(255,255,255,0.22), transparent)" }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5"
        style={{ background: "linear-gradient(to top, rgba(0,0,0,0.28), transparent)" }}
      />
      <span aria-hidden className="relative text-[3rem] leading-none">
        {emoji}
      </span>
      <div className="relative">
        <h3 className="font-display font-extrabold text-lg leading-[1.1] mb-1 [text-shadow:1px_1px_0_rgba(0,0,0,0.35)]">
          {title}
        </h3>
        <p className="text-[11px] font-extrabold uppercase tracking-widest opacity-90">
          {t("tap_to_spin")}
        </p>
      </div>
    </button>
  );
}
