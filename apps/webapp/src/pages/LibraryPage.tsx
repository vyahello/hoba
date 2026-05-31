import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ds/Button";
import { IconButton } from "@/components/ds/IconButton";
import { RoomModePickerSheet } from "@/components/room/RoomModePickerSheet";
import { type GameMode, type PunishmentDeck, type SavedWheel, api } from "@/lib/api";
import { haptics } from "@/lib/haptics";
import { safeNavigateBack } from "@/lib/navigation";
import { toast } from "@/stores/toast";

export function LibraryPage(): JSX.Element {
  const { t } = useTranslation(["home", "common"]);
  const navigate = useNavigate();

  const [wheels, setWheels] = useState<SavedWheel[] | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [useId, setUseId] = useState<number | null>(null);
  const [useLoading, setUseLoading] = useState(false);

  useEffect(() => {
    void api
      .listWheels()
      .then(setWheels)
      .catch(() => {
        setWheels([]);
        toast({ title: t("home:my_wheels.load_failed"), intent: "error" });
      });
  }, [t]);

  async function handleDelete(id: number): Promise<void> {
    try {
      await api.deleteWheel(id);
      haptics.success();
      setWheels((prev) => (prev ?? []).filter((w) => w.id !== id));
    } catch {
      toast({ title: t("home:my_wheels.delete_failed"), intent: "error" });
    } finally {
      setConfirmId(null);
    }
  }

  async function handleUse(
    mode: GameMode, deck?: PunishmentDeck, spinCount?: number,
  ): Promise<void> {
    if (useId === null || useLoading) return;
    setUseLoading(true);
    try {
      const state = await api.useWheel(useId, {
        game_mode: mode,
        ...(deck !== undefined ? { punishment_deck: deck } : {}),
        ...(spinCount !== undefined ? { spin_count: spinCount } : {}),
      });
      navigate(`/room/${state.room.code}`);
    } catch {
      toast({ title: t("home:my_wheels.use_failed"), intent: "error" });
      setUseLoading(false);
      setUseId(null);
    }
  }

  return (
    <>
      <header className="ds-glass-header px-4 py-3 pt-safe flex items-center gap-3">
        <IconButton
          aria-label={t("common:actions.back")}
          variant="ghost"
          icon={<span aria-hidden>←</span>}
          onClick={() => {
            safeNavigateBack(navigate);
          }}
        />
        <h1 className="font-display font-bold text-xl flex-1 truncate text-ink-light-1 dark:text-ink-dark-1">
          {t("home:my_wheels.title")}
        </h1>
      </header>

      <main className="flex-1 px-4 pt-3 pb-6 flex flex-col gap-4">
        {wheels === null ? (
          <p className="text-sm text-ink-light-2 dark:text-ink-dark-2 text-center py-8">
            {t("common:status.loading")}
          </p>
        ) : wheels.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-12 text-center">
            <span className="text-5xl" aria-hidden>🎡</span>
            <p className="text-sm text-ink-light-2 dark:text-ink-dark-2 px-6">
              {t("home:my_wheels.empty")}
            </p>
            <Button
              variant="accent"
              onClick={() => {
                navigate("/create");
              }}
            >
              {t("home:create_custom.title")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {wheels.map((w) => (
              <div
                key={w.id}
                className="rounded-xl bg-surface-light-2 dark:bg-surface-dark-2 p-4 flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-display font-bold text-base text-ink-light-1 dark:text-ink-dark-1 break-words">
                    {w.title}
                  </h2>
                  <span className="shrink-0 text-xs text-ink-light-2 dark:text-ink-dark-2 tabular-nums">
                    {t("home:my_wheels.uses", { count: w.use_count })}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {w.segments.slice(0, 6).map((s) => (
                    <span
                      key={s.id}
                      className="text-xs px-2 py-0.5 rounded-full bg-surface-light dark:bg-surface-dark text-ink-light-1 dark:text-ink-dark-1"
                    >
                      {s.emoji ? `${s.emoji} ` : ""}{s.label}
                    </span>
                  ))}
                  {w.segments.length > 6 ? (
                    <span className="text-xs px-2 py-0.5 text-ink-light-2 dark:text-ink-dark-2">
                      +{w.segments.length - 6}
                    </span>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="accent"
                    size="md"
                    className="flex-1"
                    onClick={() => {
                      haptics.medium();
                      setUseId(w.id);
                    }}
                  >
                    {t("home:my_wheels.use")}
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => {
                      navigate("/create", { state: { editWheel: w } });
                    }}
                  >
                    {t("home:my_wheels.edit")}
                  </Button>
                  <Button
                    variant={confirmId === w.id ? "accent" : "ghost"}
                    size="md"
                    onClick={() => {
                      if (confirmId === w.id) {
                        void handleDelete(w.id);
                      } else {
                        haptics.warning();
                        setConfirmId(w.id);
                      }
                    }}
                  >
                    {confirmId === w.id
                      ? t("home:my_wheels.delete_confirm")
                      : t("home:my_wheels.delete")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <RoomModePickerSheet
        open={useId !== null}
        loading={useLoading}
        onClose={() => {
          if (!useLoading) setUseId(null);
        }}
        onCreate={(mode, deck, spinCount) => {
          void handleUse(mode, deck, spinCount);
        }}
      />
    </>
  );
}
