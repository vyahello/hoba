import { AnimatePresence, motion } from "framer-motion";

import { useRoomStore } from "@/stores/room";

const DURATION_S = 2.0;
const PARTICLE_S = 0.7;
// Upward fan of particle directions (deg; screen-up = -90). Each reaction
// jitters these a little from its id so bursts aren't identical.
const PARTICLE_ANGLES = [-150, -118, -90, -62, -30] as const;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

interface Particle {
  dx: number;
  dy: number;
  size: number;
}

/** Deterministic burst offsets for a reaction (stable across re-renders so
 *  particles don't jump when another reaction arrives). */
function burstParticles(id: string): Particle[] {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PARTICLE_ANGLES.map((base, i) => {
    const jitter = ((h >> (i * 3)) % 30) - 15; // ±15°
    const rad = ((base + jitter) * Math.PI) / 180;
    const dist = 52 + ((h >> i) % 28); // 52…80 px
    return { dx: Math.cos(rad) * dist, dy: Math.sin(rad) * dist, size: i === 2 ? 1.05 : 0.85 };
  });
}

export function FlyingReactions(): JSX.Element {
  const reactions = useRoomStore((s) => s.reactions);
  const reduce = prefersReducedMotion();
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-24 z-20 overflow-visible h-32"
    >
      <AnimatePresence>
        {reactions.flatMap((r) => {
          const left = `${r.x * 90 + 5}%`;
          const main = (
            <motion.span
              key={r.id}
              initial={{ y: 0, opacity: 0, scale: 0.4 }}
              // A pop (overshoot to 1.3) as it launches, then drift up + fade.
              animate={{ y: -260, opacity: [0, 1, 1, 0], scale: [0.4, 1.3, 1, 1] }}
              exit={{ opacity: 0 }}
              transition={{ duration: DURATION_S, ease: "easeOut", times: [0, 0.12, 0.7, 1] }}
              style={{ left }}
              className="absolute bottom-0 text-4xl"
            >
              {r.emoji}
            </motion.span>
          );
          if (reduce) return [main];
          // A radiating spark-burst of small copies at the launch point.
          const sparks = burstParticles(r.id).map((p, i) => (
            <motion.span
              key={`${r.id}-p${i}`}
              initial={{ x: 0, y: 0, scale: 0.7, opacity: 0.95 }}
              animate={{ x: p.dx, y: p.dy, scale: 0, opacity: 0 }}
              transition={{ duration: PARTICLE_S, ease: "easeOut" }}
              style={{ left, fontSize: `${p.size}rem` }}
              className="absolute bottom-2"
            >
              {r.emoji}
            </motion.span>
          ));
          return [main, ...sparks];
        })}
      </AnimatePresence>
    </div>
  );
}
