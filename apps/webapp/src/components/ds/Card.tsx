import { type ButtonHTMLAttributes, forwardRef, type HTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { haptics } from "@/lib/haptics";

type Padding = "none" | "sm" | "md" | "lg";

interface BaseProps {
  padding?: Padding;
  glow?: boolean;
  className?: string;
  children?: ReactNode;
}

interface StaticCardProps extends BaseProps, Omit<HTMLAttributes<HTMLDivElement>, "children" | "className"> {
  interactive?: false;
}

interface InteractiveCardProps
  extends BaseProps,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className"> {
  interactive: true;
}

export type CardProps = StaticCardProps | InteractiveCardProps;

const PADDING_STYLES: Record<Padding, string> = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-6",
};

/**
 * Surface primitive — rounded, soft shadow, light/dark aware. When
 * `interactive` is true, the card renders as a `<button>` and gets
 * tactile press feedback (haptic + scale).
 */
export const Card = forwardRef<HTMLElement, CardProps>(function Card(props, ref) {
  const { padding = "md", glow = false, className, children } = props;
  const surfaceClasses = cn(
    "rounded-lg bg-surface-light dark:bg-surface-dark",
    "shadow-card",
    glow && "shadow-spin",
    PADDING_STYLES[padding],
    className,
  );

  if (props.interactive) {
    const {
      padding: _p,
      glow: _g,
      className: _c,
      children: _ch,
      interactive: _i,
      onClick,
      type = "button",
      ...rest
    } = props;
    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        type={type}
        className={cn(surfaceClasses, "ds-tactile text-left w-full")}
        onClick={(event) => {
          haptics.light();
          onClick?.(event);
        }}
        {...rest}
      >
        {children}
      </button>
    );
  }

  const { padding: _p, glow: _g, className: _c, children: _ch, interactive: _i, ...rest } = props;
  return (
    <div ref={ref as React.Ref<HTMLDivElement>} className={surfaceClasses} {...rest}>
      {children}
    </div>
  );
});
