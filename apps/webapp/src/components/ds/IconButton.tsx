import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from "react";

import { audio } from "@/audio";
import { cn } from "@/lib/cn";
import { type HapticIntent, haptics } from "@/lib/haptics";

type Size = "sm" | "md" | "lg";
type Variant = "filled" | "tonal" | "ghost";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** REQUIRED — IconButton has no visible text. */
  "aria-label": string;
  size?: Size;
  variant?: Variant;
  icon: ReactNode;
  haptic?: HapticIntent | false;
}

const SIZE_STYLES: Record<Size, string> = {
  sm: "w-11 h-11 rounded-md",
  md: "w-12 h-12 rounded-md",
  lg: "w-14 h-14 rounded-lg",
};

const VARIANT_STYLES: Record<Variant, string> = {
  filled: "bg-brand-primary text-white shadow-card active:bg-brand-primary-strong",
  tonal:
    "bg-surface-light-2 text-ink-light-1 dark:bg-surface-dark-2 dark:text-ink-dark-1 " +
    "active:bg-surface-light dark:active:bg-surface-dark",
  ghost:
    "bg-transparent text-ink-light-1 dark:text-ink-dark-1 " +
    "active:bg-surface-light-2 dark:active:bg-surface-dark-2",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      size = "md",
      variant = "ghost",
      icon,
      haptic = "selection",
      className,
      onClick,
      disabled,
      type = "button",
      ...rest
    },
    ref,
  ) {
    const handleClick: IconButtonProps["onClick"] = (event) => {
      if (disabled === true) return;
      if (haptic !== false) haptics[haptic]?.();
      audio.play("ui_tap");
      onClick?.(event);
    };

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled}
        onClick={handleClick}
        className={cn(
          // shrink-0: a 44×44 tap target must never deform when its flex
          // row overflows (e.g. when a GameModeBadge widens the room header).
          "inline-flex items-center justify-center select-none shrink-0",
          "ds-tactile disabled:opacity-50 disabled:active:scale-100",
          SIZE_STYLES[size],
          VARIANT_STYLES[variant],
          className,
        )}
        {...rest}
      >
        {icon}
      </button>
    );
  },
);
