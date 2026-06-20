import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { REACTION_EMOJIS } from "@/features/rooms/reactionLanes";
import { lastEmoji } from "@/features/wheel/emoji";
import { cn } from "@/lib/cn";
import { haptics } from "@/lib/haptics";
import { useRoomStore } from "@/stores/room";

const CUSTOM_KEY = "hoba.reactions.custom";
const MAX_CUSTOM = 3;

function loadCustom(): string[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string").slice(0, MAX_CUSTOM);
  } catch {
    return [];
  }
}

function saveCustom(list: string[]): void {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable (private mode) — custom picks just won't persist.
  }
}

export function ReactionsBar({ className }: { className?: string }): JSX.Element {
  const sendReaction = useRoomStore((s) => s.sendReaction);
  const { t } = useTranslation("room");
  // Recently picked custom emojis (most-recent first), kept as extra quick
  // buttons so a player can re-tap their own emoji without re-opening the
  // keyboard. The server already accepts any emoji — no whitelist.
  const [custom, setCustom] = useState<string[]>(loadCustom);
  const pickerRef = useRef<HTMLInputElement>(null);

  const fire = (emoji: string): void => {
    haptics.light();
    sendReaction(emoji);
  };

  // The OS emoji keyboard appends into the hidden input; keep only the most
  // recent emoji (reject plain text), send it, remember it, then reset.
  const onPick = (raw: string): void => {
    const emoji = lastEmoji(raw);
    if (pickerRef.current !== null) pickerRef.current.value = "";
    if (emoji === undefined) return;
    fire(emoji);
    setCustom((prev) => {
      const next = [emoji, ...prev.filter((e) => e !== emoji)].slice(0, MAX_CUSTOM);
      saveCustom(next);
      return next;
    });
  };

  // Customs that aren't already a default button (avoid duplicate keys/buttons).
  const defaults: readonly string[] = REACTION_EMOJIS;
  const extraCustom = custom.filter((e) => !defaults.includes(e));

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 rounded-pill",
        "bg-ds-surface-2 p-1.5",
        className,
      )}
    >
      {[...REACTION_EMOJIS, ...extraCustom].map((emoji) => (
        <button
          key={emoji}
          type="button"
          aria-label={t("reactions.aria_label", { emoji })}
          onClick={() => {
            fire(emoji);
          }}
          className="ds-tactile w-11 h-11 inline-flex items-center justify-center text-2xl rounded-full active:bg-surface-light dark:active:bg-surface-dark"
        >
          {emoji}
        </button>
      ))}

      {/* Custom emoji: a label wrapping a transparent input so a tap focuses it
          and pops the native emoji keyboard (same pattern as the wheel emoji
          slot). Whatever the player picks is sent and remembered above. */}
      <label
        aria-label={t("reactions.custom")}
        className="ds-tactile relative w-11 h-11 inline-flex items-center justify-center text-2xl rounded-full border-2 border-dashed border-ds-border text-ds-text-muted active:bg-surface-light dark:active:bg-surface-dark"
      >
        <span aria-hidden>＋</span>
        <input
          ref={pickerRef}
          type="text"
          inputMode="text"
          aria-hidden
          className="absolute inset-0 w-full h-full opacity-0 caret-transparent"
          onChange={(e) => {
            onPick(e.target.value);
          }}
        />
      </label>
    </div>
  );
}
