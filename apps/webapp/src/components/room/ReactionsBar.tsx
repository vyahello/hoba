import { cn } from "@/lib/cn";
import { haptics } from "@/lib/haptics";
import { useRoomStore } from "@/stores/room";

const REACTION_EMOJIS = ["😂", "🔥", "💀", "👍", "🎉"] as const;

export function ReactionsBar({ className }: { className?: string }): JSX.Element {
  const sendReaction = useRoomStore((s) => s.sendReaction);
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 rounded-pill",
        "bg-surface-light-2 dark:bg-surface-dark-2 p-1.5",
        className,
      )}
    >
      {REACTION_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          aria-label={`React ${emoji}`}
          onClick={() => {
            haptics.light();
            sendReaction(emoji);
          }}
          className="ds-tactile w-11 h-11 inline-flex items-center justify-center text-2xl rounded-full active:bg-surface-light dark:active:bg-surface-dark"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
