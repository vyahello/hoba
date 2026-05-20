import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from "react";

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

const VARIANT_STYLES: Record<Variant, string> = {
  primary:
    "bg-brand-primary text-white shadow-card active:bg-brand-primary-strong",
  accent:
    "bg-brand-accent text-ink-light-1 shadow-glow active:bg-brand-accent-strong",
  secondary:
    "bg-surface-light-2 text-ink-light-1 dark:bg-surface-dark-2 dark:text-ink-dark-1 " +
    "active:bg-surface-light dark:active:bg-surface-dark",
  ghost:
    "bg-transparent text-ink-light-1 dark:text-ink-dark-1 " +
    "active:bg-surface-light-2 dark:active:bg-surface-dark-2",
  destructive:
    "bg-state-danger text-white shadow-card active:brightness-90",
};

const SIZE_STYLES: Record<Size, string> = {
  sm: "text-sm px-4 min-h-[44px] gap-1.5 rounded-md",
  md: "text-base px-5 min-h-[48px] gap-2 rounded-md font-medium",
  lg: "text-base px-6 min-h-[56px] gap-2 rounded-lg font-semibold",
  xl: "text-lg px-8 min-h-[64px] gap-2.5 rounded-lg font-semibold",
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
        "ds-tactile",
        "disabled:opacity-50 disabled:active:scale-100 disabled:cursor-not-allowed",
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
