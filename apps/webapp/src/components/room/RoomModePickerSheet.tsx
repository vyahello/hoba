import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ds/Button";
import { Sheet } from "@/components/ds/Sheet";
import {
  DEFAULT_GAME_MODE,
  DEFAULT_PUNISHMENT_DECK,
  PICKABLE_GAME_MODES,
  PUNISHMENT_DECKS,
} from "@/data/gameModes";
import { type GameMode, type PunishmentDeck } from "@/lib/api";
import { haptics } from "@/lib/haptics";

export interface RoomModePickerSheetProps {
  open: boolean;
  loading: boolean;
  onClose: () => void;
  onCreate: (mode: GameMode, deck?: PunishmentDeck) => void;
}

/**
 * Bottom sheet for picking `game_mode` before room creation. Owner
 * (SpinPage) handles the API call; this component is selection + UI.
 *
 * Selection resets to Classic each time the sheet re-opens so the
 * common case ("just create the room") is a single Create tap.
 */
export function RoomModePickerSheet({
  open,
  loading,
  onClose,
  onCreate,
}: RoomModePickerSheetProps): JSX.Element {
  const { t } = useTranslation(["room"]);
  const [selected, setSelected] = useState<GameMode>(DEFAULT_GAME_MODE);
  const [deck, setDeck] = useState<PunishmentDeck>(DEFAULT_PUNISHMENT_DECK);

  // Reset to Classic + default deck each time the sheet re-opens.
  useEffect(() => {
    if (open) {
      setSelected(DEFAULT_GAME_MODE);
      setDeck(DEFAULT_PUNISHMENT_DECK);
    }
  }, [open]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      dismissable={!loading}
      title={t("room:mode_picker.title")}
    >
      <div className="flex flex-col gap-2">
        {PICKABLE_GAME_MODES.map((meta) => {
          const isSelected = meta.id === selected;
          return (
            <button
              key={meta.id}
              type="button"
              disabled={loading}
              aria-pressed={isSelected}
              onClick={() => {
                if (loading || isSelected) return;
                haptics.selection();
                setSelected(meta.id);
              }}
              className={`ds-tactile w-full flex items-start gap-3 min-h-[56px] px-4 py-3 rounded-md text-left ${
                isSelected
                  ? "bg-brand-primary text-white"
                  : "bg-surface-light-2 dark:bg-surface-dark-2 text-ink-light-1 dark:text-ink-dark-1 active:bg-surface-light dark:active:bg-surface-dark"
              } disabled:opacity-60`}
            >
              <span aria-hidden className="text-2xl shrink-0 mt-0.5">
                {meta.emoji}
              </span>
              <span className="flex flex-col gap-0.5 grow">
                <span className="text-base font-semibold">
                  {t(`room:${meta.i18nKey}.label`)}
                </span>
                <span
                  className={`text-sm ${
                    isSelected
                      ? "text-white/85"
                      : "text-ink-light-2 dark:text-ink-dark-2"
                  }`}
                >
                  {t(`room:${meta.i18nKey}.tagline`)}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {selected === "punishment" ? (
        <div className="mt-3">
          <p className="text-sm font-medium text-ink-light-2 dark:text-ink-dark-2 mb-2">
            {t("room:mode_picker.deck_title")}
          </p>
          <div className="flex gap-2">
            {PUNISHMENT_DECKS.map((d) => {
              const active = d.id === deck;
              return (
                <button
                  key={d.id}
                  type="button"
                  disabled={loading}
                  aria-pressed={active}
                  onClick={() => {
                    if (loading) return;
                    haptics.selection();
                    setDeck(d.id);
                  }}
                  className={`ds-tactile grow min-h-[44px] px-3 py-2 rounded-md text-sm font-semibold ${
                    active
                      ? "bg-brand-primary text-white"
                      : "bg-surface-light-2 dark:bg-surface-dark-2 text-ink-light-1 dark:text-ink-dark-1"
                  } disabled:opacity-60`}
                >
                  <span aria-hidden className="mr-1">{d.emoji}</span>
                  {t(`room:${d.i18nKey}.label`)}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="mt-5">
        <Button
          variant="accent"
          size="xl"
          fullWidth
          loading={loading}
          onClick={() => {
            onCreate(selected, selected === "punishment" ? deck : undefined);
          }}
        >
          {t("room:mode_picker.create")}
        </Button>
      </div>
    </Sheet>
  );
}
