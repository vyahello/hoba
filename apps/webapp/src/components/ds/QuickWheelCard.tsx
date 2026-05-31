import { useTranslation } from "react-i18next";

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
        onTap();
      }}
      aria-label={title}
      className={cn(
        "ds-tactile relative aspect-[5/4] w-full overflow-hidden",
        "rounded-lg p-4 text-left text-white shadow-card",
        "flex flex-col justify-between",
        className,
      )}
      style={{
        background: `linear-gradient(135deg, ${gradient[0]} 0%, ${gradient[1]} 100%)`,
      }}
    >
      <span
        aria-hidden
        className="absolute -right-6 -bottom-8 w-32 h-32 rounded-full bg-white/25 blur-2xl"
      />
      <span aria-hidden className="text-[3rem] leading-none drop-shadow-md">
        {emoji}
      </span>
      <div className="relative">
        <h3 className="font-display font-extrabold text-lg leading-[1.1] mb-1 drop-shadow-sm">
          {title}
        </h3>
        <p className="text-[11px] font-semibold uppercase tracking-widest opacity-90">
          {t("tap_to_spin")}
        </p>
      </div>
    </button>
  );
}
