import { cn } from "@/lib/cn";

export interface SkeletonProps {
  className?: string;
  /** Optional pixel width override. Defaults to full width. */
  width?: number | string;
  height?: number | string;
  /** Use `pill` for round avatars, `md` for cards, `sm` for inline text. */
  radius?: "sm" | "md" | "pill";
}

/**
 * Loading placeholder. Mobile-native: never use spinners outside of
 * loading buttons — skeleton everything else.
 */
export function Skeleton({
  className,
  width,
  height,
  radius = "md",
}: SkeletonProps): JSX.Element {
  return (
    <div
      role="status"
      aria-busy
      aria-live="polite"
      className={cn(
        "bg-[linear-gradient(110deg,theme(colors.surface.light-2)_8%,theme(colors.surface.light)_18%,theme(colors.surface.light-2)_33%)]",
        "dark:bg-[linear-gradient(110deg,theme(colors.surface.dark-2)_8%,theme(colors.surface.dark)_18%,theme(colors.surface.dark-2)_33%)]",
        "bg-[length:200%_100%] animate-skeleton-shimmer",
        radius === "sm" && "rounded-sm",
        radius === "md" && "rounded-md",
        radius === "pill" && "rounded-pill",
        className,
      )}
      style={{ width, height }}
    />
  );
}
