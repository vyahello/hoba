import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/cn";

export interface HobaWordProps {
  className?: string;
  /** When true, plays the entrance animation. Default true. */
  trigger?: boolean;
  /** Pixel size override. Defaults to a fluid 5rem → 6rem. */
  sizeClass?: string;
}

/**
 * The signature brand moment. Locale-aware via `t('brand.exclamation')`
 * — renders `Hoba!` in EN, `Хоба!` in UK. Manrope ExtraBold, amber, 4°
 * tilt, glow, ease-pop drop-in. Every spin reveal climaxes with this.
 */
export function HobaWord({
  className,
  trigger = true,
  sizeClass = "text-[5rem] sm:text-[6rem]",
}: HobaWordProps): JSX.Element {
  const { t } = useTranslation("brand");

  const initial = trigger
    ? { scale: 0.4, opacity: 0, rotate: -12 }
    : { scale: 1, opacity: 1, rotate: 4 };

  return (
    <motion.span
      initial={initial}
      animate={{ scale: 1, opacity: 1, rotate: 4 }}
      transition={{
        type: "spring",
        damping: 9,
        stiffness: 240,
        mass: 0.6,
      }}
      className={cn(
        "inline-block font-display font-extrabold leading-none select-none",
        "text-brand-accent",
        "drop-shadow-[0_12px_60px_rgba(255,184,77,0.75)]",
        sizeClass,
        className,
      )}
    >
      {t("exclamation")}
    </motion.span>
  );
}
