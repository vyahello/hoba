import { useTranslation } from "react-i18next";

import { REACTION_EMOJIS } from "@/features/rooms/reactionLanes";
import { cn } from "@/lib/cn";
import { haptics } from "@/lib/haptics";
import { useRoomStore } from "@/stores/room";

export function ReactionsBar({ className }: { className?: string }): JSX.Element {
  const sendReaction = useRoomStore((s) => s.sendReaction);
  const { t } = useTranslation("room");
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 rounded-pill",
        "bg-ds-surface-2 p-1.5",
        className,
      )}
    >
      {REACTION_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          aria-label={t("reactions.aria_label", { emoji })}
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
