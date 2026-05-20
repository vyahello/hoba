import { cn } from "@/lib/cn";

export interface AuroraBackgroundProps {
  className?: string;
  /** Set false to mount without `fixed inset-0` (e.g. inside a card). */
  fixed?: boolean;
}

/**
 * Animated 3-stop radial gradient backdrop — drifts on a ~30s loop via
 * keyframes. Pure CSS, no canvas/video. Per spec §1 it goes behind the
 * lobby + result screens, not anywhere else.
 */
export function AuroraBackground({
  className,
  fixed = true,
}: AuroraBackgroundProps): JSX.Element {
  return (
    <div
      aria-hidden
      className={cn(
        "overflow-hidden pointer-events-none",
        fixed ? "fixed inset-0 -z-10" : "absolute inset-0",
        className,
      )}
    >
      <div
        className={cn(
          "absolute -inset-[20%]",
          "bg-aurora-light dark:bg-aurora-dark",
          "blur-3xl opacity-90 animate-aurora-drift",
        )}
      />
    </div>
  );
}
