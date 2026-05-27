import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Sheet } from "@/components/ds/Sheet";
import { ApiError, type RoomState, type SpinPolicy, api } from "@/lib/api";
import { haptics } from "@/lib/haptics";
import { useRoomStore } from "@/stores/room";
import { toast } from "@/stores/toast";

export interface RoomSettingsSheetProps {
  open: boolean;
  onClose: () => void;
  snapshot: RoomState;
}

/**
 * Host-only sheet for editing room-wide settings. For Stage B the only
 * editable axis is `spin_policy`; later phases extend the same sheet
 * with kick / lock / mode-change controls (spec §F11 + roadmap stage G).
 *
 * The PATCH is REST, not WS, so only the calling host's local snapshot
 * updates immediately. Guests pick up the change on their next refresh
 * — server-side broadcast of `room:updated` is queued for a later stage.
 */
export function RoomSettingsSheet({
  open,
  onClose,
  snapshot,
}: RoomSettingsSheetProps): JSX.Element {
  const { t } = useTranslation(["room", "common"]);
  const setSnapshot = useRoomStore((s) => s.setSnapshot);
  const [saving, setSaving] = useState<SpinPolicy | null>(null);

  async function applyPolicy(next: SpinPolicy): Promise<void> {
    if (next === snapshot.room.spin_policy || saving !== null) return;
    setSaving(next);
    haptics.selection();
    try {
      const updated = await api.patchRoom(snapshot.room.code, {
        spin_policy: next,
      });
      setSnapshot(updated);
    } catch (exc) {
      const code = exc instanceof ApiError ? exc.code : "save_failed";
      const localized = t(`room:errors.${code}`);
      const message = localized === `room:errors.${code}`
        ? t("room:settings.save_failed")
        : localized;
      toast({ title: message, intent: "error" });
    } finally {
      setSaving(null);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t("room:settings.title")}>
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-ink-light-2 dark:text-ink-dark-2">
          {t("room:settings.spin_policy.label")}
        </h3>
        <div className="flex flex-col gap-2">
          <PolicyOption
            label={t("room:settings.spin_policy.anyone")}
            selected={snapshot.room.spin_policy === "anyone"}
            saving={saving === "anyone"}
            onSelect={() => {
              void applyPolicy("anyone");
            }}
          />
          <PolicyOption
            label={t("room:settings.spin_policy.host_only")}
            selected={snapshot.room.spin_policy === "host_only"}
            saving={saving === "host_only"}
            onSelect={() => {
              void applyPolicy("host_only");
            }}
          />
        </div>
      </section>
    </Sheet>
  );
}

interface PolicyOptionProps {
  label: string;
  selected: boolean;
  saving: boolean;
  onSelect: () => void;
}

function PolicyOption({
  label,
  selected,
  saving,
  onSelect,
}: PolicyOptionProps): JSX.Element {
  return (
    <button
      type="button"
      disabled={saving}
      aria-pressed={selected}
      onClick={onSelect}
      className={`ds-tactile w-full flex items-center justify-between min-h-[48px] px-4 py-3 rounded-md text-left text-base font-medium ${
        selected
          ? "bg-brand-primary text-white"
          : "bg-surface-light-2 dark:bg-surface-dark-2 text-ink-light-1 dark:text-ink-dark-1 active:bg-surface-light dark:active:bg-surface-dark"
      } disabled:opacity-60`}
    >
      <span>{label}</span>
      {saving ? (
        <span
          aria-hidden
          className="inline-block w-4 h-4 rounded-full border-2 border-current border-r-transparent animate-spin"
        />
      ) : selected ? (
        <span aria-hidden>✓</span>
      ) : null}
    </button>
  );
}
