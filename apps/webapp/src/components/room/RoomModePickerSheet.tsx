import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { audio } from "@/audio";
import { Button } from "@/components/ds/Button";
import { Sheet } from "@/components/ds/Sheet";
import {
  DEFAULT_CHAOS_SPIN_COUNT,
  DEFAULT_GAME_MODE,
  DEFAULT_PUNISHMENT_DECK,
  DEFAULT_PUNISHMENT_SPIN_COUNT,
  DEFAULT_SPIN_COUNT,
  PICKABLE_GAME_MODES,
  PUNISHMENT_DECKS,
  SPIN_COUNTS,
} from "@/data/gameModes";
import { type GameMode, type PunishmentDeck } from "@/lib/api";
import { haptics } from "@/lib/haptics";

export interface RoomModePickerSheetProps {
  open: boolean;
  loading: boolean;
  onClose: () => void;
  onCreate: (mode: GameMode, deck?: PunishmentDeck, spinCount?: number) => void;
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
  const [spinCount, setSpinCount] = useState<number>(DEFAULT_SPIN_COUNT);
  const [punishSpinCount, setPunishSpinCount] = useState<number>(DEFAULT_PUNISHMENT_SPIN_COUNT);
  const [chaosSpinCount, setChaosSpinCount] = useState<number>(DEFAULT_CHAOS_SPIN_COUNT);

  // Reset to Classic + defaults each time the sheet re-opens.
  useEffect(() => {
    if (open) {
      setSelected(DEFAULT_GAME_MODE);
      setDeck(DEFAULT_PUNISHMENT_DECK);
      setSpinCount(DEFAULT_SPIN_COUNT);
      setPunishSpinCount(DEFAULT_PUNISHMENT_SPIN_COUNT);
      setChaosSpinCount(DEFAULT_CHAOS_SPIN_COUNT);
    }
  }, [open]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      dismissable={!loading}
      title={t("room:mode_picker.title")}
      footer={
        <Button
          variant="accent"
          size="xl"
          fullWidth
          loading={loading}
          onClick={() => {
            onCreate(
              selected,
              selected === "punishment" ? deck : undefined,
              selected === "classic"
                ? spinCount
                : selected === "punishment"
                  ? punishSpinCount
                  : selected === "chaos"
                    ? chaosSpinCount
                    : undefined,
            );
          }}
        >
          {t("room:mode_picker.create")}
        </Button>
      }
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
                audio.play("ui_tap");
                setSelected(meta.id);
              }}
              className={`ds-tactile w-full flex items-start gap-3 min-h-[56px] px-4 py-3 rounded-md text-left border-[3px] border-ds-border ${
                isSelected
                  ? "bg-brand-primary text-white shadow-brutal-sm"
                  : "bg-ds-surface-2 text-ds-text active:bg-surface-light dark:active:bg-surface-dark"
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
                      : "text-ds-text-muted"
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
        <>
          <div className="mt-3">
            <p className="text-sm font-medium text-ds-text-muted mb-2">
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
                      audio.play("ui_tap");
                      setDeck(d.id);
                    }}
                    className={`ds-tactile grow min-h-[44px] px-3 py-2 rounded-md text-sm font-bold border-[3px] border-ds-border ${
                      active
                        ? "bg-brand-primary text-white shadow-brutal-sm"
                        : "bg-ds-surface-2 text-ds-text"
                    } disabled:opacity-60`}
                  >
                    <span aria-hidden className="mr-1">{d.emoji}</span>
                    {t(`room:${d.i18nKey}.label`)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-3">
            <p className="text-sm font-medium text-ds-text-muted mb-2">
              {t("room:punishment.spin_count_label")}
            </p>
            <div className="flex gap-2">
              {SPIN_COUNTS.map((n) => {
                const active = n === punishSpinCount;
                return (
                  <button
                    key={n}
                    type="button"
                    disabled={loading}
                    aria-pressed={active}
                    onClick={() => {
                      if (loading) return;
                      haptics.selection();
                      audio.play("ui_tap");
                      setPunishSpinCount(n);
                    }}
                    className={`ds-tactile grow min-h-[44px] px-3 py-2 rounded-md text-sm font-bold border-[3px] border-ds-border ${
                      active
                        ? "bg-brand-primary text-white shadow-brutal-sm"
                        : "bg-ds-surface-2 text-ds-text"
                    } disabled:opacity-60`}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      ) : null}

      {selected === "classic" ? (
        <div className="mt-3">
          <p className="text-sm font-medium text-ds-text-muted mb-2">
            {t("room:spin_count.label")}
          </p>
          <div className="flex gap-2">
            {SPIN_COUNTS.map((n) => {
              const active = n === spinCount;
              return (
                <button
                  key={n}
                  type="button"
                  disabled={loading}
                  aria-pressed={active}
                  onClick={() => {
                    if (loading) return;
                    haptics.selection();
                    audio.play("ui_tap");
                    setSpinCount(n);
                  }}
                  className={`ds-tactile grow min-h-[44px] px-3 py-2 rounded-md text-sm font-bold border-[3px] border-ds-border ${
                    active
                      ? "bg-brand-primary text-white shadow-brutal-sm"
                      : "bg-ds-surface-2 text-ds-text"
                  } disabled:opacity-60`}
                >
                  {n}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {selected === "chaos" ? (
        <div className="mt-3">
          <p className="text-sm font-medium text-ds-text-muted mb-2">
            {t("room:punishment.spin_count_label")}
          </p>
          <div className="flex gap-2">
            {SPIN_COUNTS.map((n) => {
              const active = n === chaosSpinCount;
              return (
                <button
                  key={n}
                  type="button"
                  disabled={loading}
                  aria-pressed={active}
                  onClick={() => {
                    if (loading) return;
                    haptics.selection();
                    audio.play("ui_tap");
                    setChaosSpinCount(n);
                  }}
                  className={`ds-tactile grow min-h-[44px] px-3 py-2 rounded-md text-sm font-bold border-[3px] border-ds-border ${
                    active
                      ? "bg-brand-primary text-white shadow-brutal-sm"
                      : "bg-ds-surface-2 text-ds-text"
                  } disabled:opacity-60`}
                >
                  {n}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

    </Sheet>
  );
}
