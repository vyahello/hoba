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

// Neubrutalist: filled/tonal get the bold border + hard shadow; ghost stays
// borderless for header/back affordances.
const BRUTAL = "border-[3px] border-ds-border shadow-brutal active:shadow-brutal-sm";
const VARIANT_STYLES: Record<Variant, string> = {
  filled: `bg-brand-primary text-white ${BRUTAL}`,
  tonal: `bg-ds-surface text-ds-text ${BRUTAL}`,
  ghost: "bg-transparent text-ds-text active:bg-ds-surface-2",
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
