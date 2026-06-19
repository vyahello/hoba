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
        // Neubrutalist flat fill (no gradient/blur). `gradient[0]` is the
        // template's primary brand hex; the second endpoint is intentionally
        // unused now to keep the surface flat and cheap.
        backgroundColor: gradient[0],
      }}
    >
      <span aria-hidden className="text-[3rem] leading-none">
        {emoji}
      </span>
      <div className="relative">
        <h3 className="font-display font-extrabold text-lg leading-[1.1] mb-1">
          {title}
        </h3>
        <p className="text-[11px] font-extrabold uppercase tracking-widest opacity-90">
          {t("tap_to_spin")}
        </p>
      </div>
    </button>
  );
}
