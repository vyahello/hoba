import { AnimatePresence, motion } from "framer-motion";

import { useRoomStore } from "@/stores/room";

const DURATION_S = 2.0;

export function FlyingReactions(): JSX.Element {
  const reactions = useRoomStore((s) => s.reactions);
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-24 z-20 overflow-visible h-32"
    >
      <AnimatePresence>
        {reactions.map((r) => (
          <motion.span
            key={r.id}
            initial={{ y: 0, opacity: 0, scale: 0.6 }}
            animate={{ y: -260, opacity: [0, 1, 1, 0], scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{
              duration: DURATION_S,
              ease: "easeOut",
              times: [0, 0.15, 0.7, 1],
            }}
            style={{ left: `${r.x * 90 + 5}%` }}
            className="absolute bottom-0 text-4xl"
          >
            {r.emoji}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}
