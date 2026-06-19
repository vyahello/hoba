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
 *
 * Static fill (no shimmer): an infinite background-position keyframe is a
 * per-frame paint and an always-on loop (PERF_AUDIT). A flat themed block
 * communicates "loading" without burning GPU while a screen waits.
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
        "bg-ds-surface-2",
        radius === "sm" && "rounded-sm",
        radius === "md" && "rounded-md",
        radius === "pill" && "rounded-pill",
        className,
      )}
      style={{ width, height }}
    />
  );
}
