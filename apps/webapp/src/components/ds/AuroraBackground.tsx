import { cn } from "@/lib/cn";

export interface AuroraBackgroundProps {
  className?: string;
  /** Set false to mount without `fixed inset-0` (e.g. inside a card). */
  fixed?: boolean;
}

/**
 * Static neubrutalist backdrop — a flat themed field with a couple of solid
 * offset "sticker" shapes. Pure CSS, **no animation, no blur, no
 * will-change** (the old animated full-screen blur was PERF_AUDIT R1: an
 * always-on GPU layer drifting behind every screen, including the spin).
 * Decorative motion, if ever wanted, must be one-shot/on-interaction.
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
        "bg-ds-bg",
        className,
      )}
    >
      {/* Solid, static, zero-blur shapes — composited once, never animate. */}
      <span className="absolute -left-10 -top-8 w-44 h-44 rounded-full bg-brand-primary/15" />
      <span className="absolute right-[-3rem] top-1/3 w-52 h-52 rounded-lg rotate-12 bg-brand-accent/15" />
      <span className="absolute left-1/4 bottom-[-3rem] w-40 h-40 rounded-full bg-brand-pink/15" />
    </div>
  );
}
