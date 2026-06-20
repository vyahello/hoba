import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ds/Button";
import { Sheet } from "@/components/ds/Sheet";
import { laneFromClientX, REACTION_EMOJIS } from "@/features/rooms/reactionLanes";
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
  const changeRef = useRef<HTMLInputElement>(null);
  // Long-press (custom emoji only) → open the manage sheet (Change / Remove).
  // `longPressed` suppresses the tap-to-react that would fire on release.
  const [manageEmoji, setManageEmoji] = useState<string | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);

  const removeCustom = (emoji: string): void => {
    haptics.warning();
    setCustom((prev) => {
      const next = prev.filter((e) => e !== emoji);
      saveCustom(next);
      return next;
    });
  };
  // Replace `manageEmoji` (in place) with the newly picked emoji, de-duping.
  const onChangeEmoji = (raw: string): void => {
    const next = lastEmoji(raw);
    if (changeRef.current !== null) changeRef.current.value = "";
    if (next === undefined || manageEmoji === null) return;
    setCustom((prev) => {
      const mapped = prev.map((e) => (e === manageEmoji ? next : e));
      const deduped = [...new Set(mapped)].slice(0, MAX_CUSTOM);
      saveCustom(deduped);
      return deduped;
    });
    setManageEmoji(null);
  };
  const cancelLongPress = (): void => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };
  const startLongPress = (emoji: string): void => {
    longPressed.current = false;
    cancelLongPress();
    longPressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      haptics.medium();
      setManageEmoji(emoji); // open Change / Remove sheet
    }, 550);
  };

  // Fire a reaction that flies up from the tapped element's actual position
  // (so custom emojis fly from THEIR button, not a hashed guess).
  const fire = (emoji: string, origin: HTMLElement): void => {
    const rect = origin.getBoundingClientRect();
    const x = laneFromClientX(rect.left + rect.width / 2, window.innerWidth);
    haptics.light();
    sendReaction(emoji, x);
  };

  // The OS emoji keyboard appends into the hidden input; keep only the most
  // recent emoji (reject plain text), send it, remember it, then reset.
  const onPick = (raw: string, origin: HTMLElement): void => {
    const emoji = lastEmoji(raw);
    if (pickerRef.current !== null) pickerRef.current.value = "";
    if (emoji === undefined) return;
    fire(emoji, origin);
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
    <>
      <div
        className={cn(
          "flex items-center justify-center gap-2 rounded-pill",
          "bg-ds-surface-2 p-1.5",
          className,
        )}
      >
        {[
          ...REACTION_EMOJIS.map((emoji) => ({ emoji, isCustom: false })),
          ...extraCustom.map((emoji) => ({ emoji, isCustom: true })),
        ].map(({ emoji, isCustom }) => (
          <button
            key={emoji}
            type="button"
            aria-label={
              isCustom
                ? t("reactions.aria_label_custom", { emoji })
                : t("reactions.aria_label", { emoji })
            }
            onClick={(e) => {
              // A long-press opened the manage sheet — don't also react.
              if (isCustom && longPressed.current) {
                longPressed.current = false;
                return;
              }
              fire(emoji, e.currentTarget);
            }}
            onPointerDown={() => {
              if (isCustom) startLongPress(emoji);
            }}
            onPointerUp={cancelLongPress}
            onPointerLeave={cancelLongPress}
            onPointerCancel={cancelLongPress}
            style={{ WebkitTouchCallout: "none" }}
            className="ds-tactile w-11 h-11 inline-flex items-center justify-center text-2xl rounded-full select-none active:bg-surface-light dark:active:bg-surface-dark"
          >
            {emoji}
          </button>
        ))}

        {/* Custom emoji: a label wrapping a transparent input so a tap focuses
            it and pops the native emoji keyboard (same pattern as the wheel
            emoji slot). Whatever the player picks is sent and remembered. */}
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
              onPick(e.target.value, e.currentTarget);
            }}
          />
        </label>
      </div>

      {/* Manage a custom emoji (opened by long-pressing it): change or remove. */}
      <Sheet
        open={manageEmoji !== null}
        onClose={() => {
          setManageEmoji(null);
        }}
        title={t("reactions.manage_title")}
      >
        <div className="flex flex-col items-center gap-4">
          <span className="text-6xl leading-none" aria-hidden>
            {manageEmoji}
          </span>
          {/* Change: a label+input so a direct tap pops the native emoji
              keyboard (it can't be focused programmatically on iOS). */}
          <label className="ds-tactile relative w-full inline-flex items-center justify-center rounded-xl border-[3px] border-ds-border bg-brand-primary px-4 py-3 text-base font-semibold text-white">
            {t("reactions.change")}
            <input
              ref={changeRef}
              type="text"
              inputMode="text"
              aria-hidden
              className="absolute inset-0 w-full h-full opacity-0 caret-transparent"
              onChange={(e) => {
                onChangeEmoji(e.target.value);
              }}
            />
          </label>
          <Button
            variant="ghost"
            size="md"
            className="w-full"
            onClick={() => {
              if (manageEmoji !== null) removeCustom(manageEmoji);
              setManageEmoji(null);
            }}
          >
            {t("reactions.remove")}
          </Button>
        </div>
      </Sheet>
    </>
  );
}
