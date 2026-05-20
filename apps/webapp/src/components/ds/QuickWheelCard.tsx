import { useTranslation } from "react-i18next";

import { cn } from "@/lib/cn";
import { haptics } from "@/lib/haptics";
import { type QuickWheel } from "@/data/quickWheels";

export interface QuickWheelCardProps {
  wheel: QuickWheel;
  onTap: (wheel: QuickWheel) => void;
  className?: string;
}

export function QuickWheelCard({
  wheel,
  onTap,
  className,
}: QuickWheelCardProps): JSX.Element {
  const { t } = useTranslation("home");
  const titleText = t(wheel.titleKey, { defaultValue: wheel.titleKey });
  return (
    <button
      type="button"
      onClick={() => {
        haptics.medium();
        onTap(wheel);
      }}
      aria-label={titleText}
      className={cn(
        "ds-tactile relative aspect-[5/4] w-full overflow-hidden",
        "rounded-lg p-4 text-left text-white shadow-card",
        "flex flex-col justify-between",
        className,
      )}
      style={{
        background: `linear-gradient(135deg, ${wheel.gradient[0]} 0%, ${wheel.gradient[1]} 100%)`,
      }}
    >
      <span
        aria-hidden
        className="absolute -right-6 -bottom-8 w-32 h-32 rounded-full bg-white/25 blur-2xl"
      />
      <span aria-hidden className="text-[3rem] leading-none drop-shadow-md">
        {wheel.emoji}
      </span>
      <div className="relative">
        <h3 className="font-display font-extrabold text-lg leading-[1.1] mb-1 drop-shadow-sm">
          {titleText}
        </h3>
        <p className="text-[11px] font-semibold uppercase tracking-widest opacity-90">
          {t("tap_to_spin")}
        </p>
      </div>
    </button>
  );
}
