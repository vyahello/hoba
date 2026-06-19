import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from "react";

import { audio } from "@/audio";
import { cn } from "@/lib/cn";
import { type HapticIntent, haptics } from "@/lib/haptics";

type Variant = "primary" | "accent" | "secondary" | "ghost" | "destructive";
type Size = "sm" | "md" | "lg" | "xl";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  /** Set false to suppress haptic; otherwise picks a sensible default per variant. */
  haptic?: HapticIntent | false;
  fullWidth?: boolean;
}

// Neubrutalist: solid fills, bold border, hard offset shadow (static, no
// blur). `brutal` variants sink into the shadow on press via .ds-brutal.
const BRUTAL = "border-[3px] border-ds-border shadow-brutal active:shadow-brutal-sm";
const VARIANT_STYLES: Record<Variant, string> = {
  primary: `bg-brand-primary text-white ${BRUTAL}`,
  accent: `bg-brand-accent text-[#14101f] ${BRUTAL}`,
  secondary: `bg-ds-surface text-ds-text ${BRUTAL}`,
  // Ghost is a borderless text button — no shadow to sink into.
  ghost: "bg-transparent text-ds-text active:bg-ds-surface-2",
  destructive: `bg-state-danger text-white ${BRUTAL}`,
};

const SIZE_STYLES: Record<Size, string> = {
  sm: "text-sm px-4 min-h-[44px] gap-1.5 rounded-md",
  md: "text-base px-5 min-h-[48px] gap-2 rounded-md",
  lg: "text-base px-6 min-h-[56px] gap-2 rounded-lg",
  xl: "text-lg px-8 min-h-[64px] gap-2.5 rounded-lg",
};

const DEFAULT_HAPTIC: Record<Variant, HapticIntent> = {
  primary: "medium",
  accent: "heavy",
  secondary: "light",
  ghost: "selection",
  destructive: "warning",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    icon,
    haptic,
    fullWidth = false,
    className,
    onClick,
    disabled,
    children,
    type = "button",
    ...rest
  },
  ref,
) {
  const isDisabled = disabled === true || loading;
  const handleClick: ButtonProps["onClick"] = (event) => {
    if (isDisabled) return;
    if (haptic !== false) {
      const intent = haptic ?? DEFAULT_HAPTIC[variant];
      haptics[intent]?.();
    }
    audio.play("ui_tap");
    onClick?.(event);
  };

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      onClick={handleClick}
      className={cn(
        "inline-flex items-center justify-center select-none whitespace-nowrap",
        "font-display font-bold ds-tactile",
        "disabled:opacity-50 disabled:active:translate-x-0 disabled:active:translate-y-0 disabled:cursor-not-allowed",
        VARIANT_STYLES[variant],
        SIZE_STYLES[size],
        fullWidth && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden
          className="inline-block w-4 h-4 rounded-full border-2 border-current border-r-transparent animate-spin"
        />
      ) : (
        icon
      )}
      {children}
    </button>
  );
});
