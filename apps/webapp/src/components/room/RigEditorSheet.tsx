import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ds/Button";
import { Sheet } from "@/components/ds/Sheet";
import { ApiError, type RoomState, api } from "@/lib/api";
import { haptics } from "@/lib/haptics";
import { useRoomStore } from "@/stores/room";
import { toast } from "@/stores/toast";

export interface RigEditorSheetProps {
  open: boolean;
  onClose: () => void;
  snapshot: RoomState;
}

/**
 * Rigged Mode 🎭 (spec §5.5) — the host's secret weight editor, opened by a
 * long-press on the hub. A 0–100 slider per segment; releasing a slider
 * commits the full weight map via the host-only `/rig` endpoint (which does
 * NOT broadcast, so guests never learn). Host-only by construction — RoomPage
 * only wires the long-press for the host.
 */
export function RigEditorSheet({ open, onClose, snapshot }: RigEditorSheetProps): JSX.Element {
  const { t } = useTranslation(["room", "common"]);
  const setSnapshot = useRoomStore((s) => s.setSnapshot);
  const segments = snapshot.active_question?.segments ?? [];
  const code = snapshot.room.code;

  const [weights, setWeights] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const isRigged = snapshot.room.game_mode === "rigged";
  const revealed = snapshot.room.rigged_revealed;
  const weightsRef = useRef(weights);
  weightsRef.current = weights;

  // Seed from the (host-visible) real weights whenever the sheet opens.
  useEffect(() => {
    if (!open) return;
    setWeights(Object.fromEntries(segments.map((s) => [s.id, s.weight])));
    // Re-seed from the host's real weights each time the sheet opens.
  }, [open]);

  async function commit(): Promise<void> {
    setSaving(true);
    try {
      const updated = await api.setRig(code, weightsRef.current);
      setSnapshot(updated);
      haptics.success();
    } catch (exc) {
      const errCode = exc instanceof ApiError ? exc.code : "save_failed";
      const localized = t(`room:errors.${errCode}`);
      const message = localized === `room:errors.${errCode}`
        ? t("room:rig.save_failed")
        : localized;
      toast({ title: message, intent: "error" });
    } finally {
      setSaving(false);
    }
  }

  function handleReveal(): void {
    setRevealing(true);
    haptics.heavy();
    void api
      .revealRig(code)
      .then((updated) => {
        setSnapshot(updated);
        onClose(); // let the full-screen reveal play on the room
      })
      .catch((exc) => {
        const errCode = exc instanceof ApiError ? exc.code : "save_failed";
        const localized = t(`room:errors.${errCode}`);
        toast({
          title: localized === `room:errors.${errCode}`
            ? t("room:rig.save_failed")
            : localized,
          intent: "error",
        });
      })
      .finally(() => {
        setRevealing(false);
      });
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("room:rig.title")}
      footer={
        isRigged && !revealed ? (
          <Button
            variant="accent"
            size="lg"
            fullWidth
            loading={revealing}
            onClick={handleReveal}
          >
            {t("room:rig.reveal")}
          </Button>
        ) : undefined
      }
    >
      <p className="text-sm text-ds-text-muted mb-3">
        {t("room:rig.hint")}
      </p>
      <div className="flex flex-col gap-3">
        {segments.map((s) => {
          const value = weights[s.id] ?? s.weight;
          return (
            <div
              key={s.id}
              className="flex flex-col gap-2 rounded-lg bg-ds-surface-2 border-[3px] border-ds-border p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-display font-bold text-ds-text">
                  {s.emoji ? `${s.emoji} ` : ""}{s.label}
                </span>
                <span className="shrink-0 tabular-nums font-display font-extrabold text-sm bg-brand-primary text-white border-2 border-ds-border rounded-md px-2 py-0.5 min-w-[2.25rem] text-center">
                  {value}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={value}
                disabled={saving}
                aria-label={s.label}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setWeights((w) => ({ ...w, [s.id]: v }));
                }}
                onPointerUp={() => {
                  void commit();
                }}
                onBlur={() => {
                  void commit();
                }}
                className="ds-range"
              />
            </div>
          );
        })}
      </div>
      <p className="text-xs text-ds-text-muted mt-3">
        {t("room:rig.footer")}
      </p>
    </Sheet>
  );
}
