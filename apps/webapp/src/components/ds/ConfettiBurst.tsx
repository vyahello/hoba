import confetti from "canvas-confetti";
import { useEffect } from "react";

const BRAND_COLORS = ["#7C5CFF", "#FFB84D", "#FF5C9C", "#5CE5FF"];

// Kill any in-flight burst the instant the app is backgrounded — canvas-
// confetti runs its own rAF, and nothing decorative may keep animating while
// hidden (thermal budget). `reset()` stops the loop and clears the canvas.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) confetti.reset();
  });
}

export interface ConfettiOptions {
  particleCount?: number;
  origin?: { x: number; y: number };
  colors?: string[];
  spread?: number;
}

/**
 * Fire-and-forget confetti burst. Defaults to brand colors, mid-screen
 * origin, ~80 particles per §1. Reserve for spin reveals — confetti is
 * a ritual, not decoration.
 */
export function fireConfetti(opts: ConfettiOptions = {}): void {
  void confetti({
    particleCount: opts.particleCount ?? 80,
    spread: opts.spread ?? 70,
    startVelocity: 45,
    origin: opts.origin ?? { x: 0.5, y: 0.55 },
    colors: opts.colors ?? BRAND_COLORS,
    ticks: 220,
    zIndex: 70,
    // Honor prefers-reduced-motion natively (no burst when reduced).
    disableForReducedMotion: true,
  });
}

export interface ConfettiBurstProps extends ConfettiOptions {
  /** Increment to re-fire — useful in declarative usage. */
  trigger: number | boolean;
}

/** Declarative wrapper — fires whenever `trigger` changes truthily. */
export function ConfettiBurst({ trigger, ...opts }: ConfettiBurstProps): null {
  useEffect(() => {
    if (trigger === false || trigger === 0) return;
    fireConfetti(opts);
  }, [trigger, opts]);
  return null;
}
