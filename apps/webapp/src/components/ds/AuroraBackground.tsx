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
      {/* Perf (iPhone X / A11, iOS Safari): `will-change-transform` promotes
          this to its own compositor layer so the (expensive) blur is
          rasterized ONCE and the drift becomes a transform-only composite —
          without it Safari re-blurs a full-screen layer every frame, which
          steals GPU from the spin and causes the "hangs at moments" jank.
          blur-2xl over blur-3xl halves the raster cost; `motion-safe` drops
          the animation entirely for reduced-motion users. */}
      <div
        className={cn(
          "absolute -inset-[16%] transform-gpu will-change-transform",
          "bg-aurora-light dark:bg-aurora-dark",
          "blur-2xl opacity-90 motion-safe:animate-aurora-drift",
        )}
      />
    </div>
  );
}
