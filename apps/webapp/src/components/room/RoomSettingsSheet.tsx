import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ds/Button";
import { Sheet } from "@/components/ds/Sheet";
import {
  ApiError,
  type RoomPatchPayload,
  type RoomState,
  type SpinPolicy,
  api,
} from "@/lib/api";
import { haptics } from "@/lib/haptics";
import { useRoomStore } from "@/stores/room";
import { toast } from "@/stores/toast";

export interface RoomSettingsSheetProps {
  open: boolean;
  onClose: () => void;
  snapshot: RoomState;
  /** Whether to show the spin-policy chooser (only for non-race modes with guests). */
  showSpinPolicy: boolean;
  /** Open the mode picker to change the game mode mid-room. */
  onChangeMode: () => void;
  /** Confirm + close the whole room (host). */
  onCloseRoom: () => void;
  /** Confirm + kick a participant (host). */
  onKick: (userId: number, name: string) => void;
}

/**
 * Host-only sheet for room-wide moderation (spec §F11 / roadmap Stage G):
 * spin policy, lock, anonymous mode, mid-room mode change, and close.
 *
 * Toggles PATCH over REST; the server also emits `room:updated` so connected
 * guests pick up the change without a reconnect.
 */
export function RoomSettingsSheet({
  open,
  onClose,
  snapshot,
  showSpinPolicy,
  onChangeMode,
  onCloseRoom,
  onKick,
}: RoomSettingsSheetProps): JSX.Element {
  const { t } = useTranslation(["room", "common"]);
  const setSnapshot = useRoomStore((s) => s.setSnapshot);
  const [savingPolicy, setSavingPolicy] = useState<SpinPolicy | null>(null);
  const [savingField, setSavingField] = useState<"is_locked" | "is_anonymous" | null>(null);

  function errorToast(exc: unknown): void {
    const code = exc instanceof ApiError ? exc.code : "save_failed";
    const localized = t(`room:errors.${code}`);
    const message = localized === `room:errors.${code}`
      ? t("room:settings.save_failed")
      : localized;
    toast({ title: message, intent: "error" });
  }

  async function applyPolicy(next: SpinPolicy): Promise<void> {
    if (next === snapshot.room.spin_policy || savingPolicy !== null) return;
    setSavingPolicy(next);
    haptics.selection();
    try {
      setSnapshot(await api.patchRoom(snapshot.room.code, { spin_policy: next }));
    } catch (exc) {
      errorToast(exc);
    } finally {
      setSavingPolicy(null);
    }
  }

  async function applyToggle(
    field: "is_locked" | "is_anonymous", value: boolean,
  ): Promise<void> {
    if (savingField !== null) return;
    setSavingField(field);
    haptics.selection();
    try {
      const patch: RoomPatchPayload = { [field]: value };
      setSnapshot(await api.patchRoom(snapshot.room.code, patch));
    } catch (exc) {
      errorToast(exc);
    } finally {
      setSavingField(null);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t("room:settings.title")}>
      <div className="flex flex-col gap-6">
        {showSpinPolicy ? (
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-ink-light-2 dark:text-ink-dark-2">
              {t("room:settings.spin_policy.label")}
            </h3>
            <div className="flex flex-col gap-2">
              <PolicyOption
                label={t("room:settings.spin_policy.host_only")}
                selected={snapshot.room.spin_policy === "host_only"}
                saving={savingPolicy === "host_only"}
                onSelect={() => {
                  void applyPolicy("host_only");
                }}
              />
              <PolicyOption
                label={t("room:settings.spin_policy.turn_based")}
                selected={snapshot.room.spin_policy === "turn_based"}
                saving={savingPolicy === "turn_based"}
                onSelect={() => {
                  void applyPolicy("turn_based");
                }}
              />
            </div>
          </section>
        ) : null}

        <section className="flex flex-col gap-2">
          <ToggleRow
            label={t("room:settings.lock.label")}
            hint={t("room:settings.lock.hint")}
            on={snapshot.room.is_locked}
            saving={savingField === "is_locked"}
            onToggle={() => {
              void applyToggle("is_locked", !snapshot.room.is_locked);
            }}
          />
          <ToggleRow
            label={t("room:settings.anonymous.label")}
            hint={t("room:settings.anonymous.hint")}
            on={snapshot.room.is_anonymous}
            saving={savingField === "is_anonymous"}
            onToggle={() => {
              void applyToggle("is_anonymous", !snapshot.room.is_anonymous);
            }}
          />
        </section>

        {(() => {
          const guests = snapshot.participants.filter(
            (p) => p.user_id !== snapshot.room.host_id,
          );
          if (guests.length === 0) return null;
          return (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-widest text-ink-light-2 dark:text-ink-dark-2">
                {t("room:settings.players")}
              </h3>
              {guests.map((p) => {
                const name = p.display_name ?? `#${p.user_id}`;
                return (
                  <div
                    key={p.user_id}
                    className="flex items-center justify-between gap-3 min-h-[44px] px-4 py-2 rounded-md bg-surface-light-2 dark:bg-surface-dark-2"
                  >
                    <span className="truncate text-base text-ink-light-1 dark:text-ink-dark-1">
                      {name}
                    </span>
                    <button
                      type="button"
                      className="shrink-0 text-sm font-semibold text-state-danger"
                      onClick={() => {
                        onClose();
                        onKick(p.user_id, name);
                      }}
                    >
                      {t("room:settings.kick")}
                    </button>
                  </div>
                );
              })}
            </section>
          );
        })()}

        <section className="flex flex-col gap-2">
          <Button
            variant="secondary"
            fullWidth
            onClick={() => {
              onClose();
              onChangeMode();
            }}
          >
            {t("room:settings.change_mode")}
          </Button>
          <Button
            variant="ghost"
            fullWidth
            className="text-state-danger"
            onClick={() => {
              onClose();
              onCloseRoom();
            }}
          >
            {t("room:settings.close_room")}
          </Button>
        </section>
      </div>
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

interface ToggleRowProps {
  label: string;
  hint: string;
  on: boolean;
  saving: boolean;
  onToggle: () => void;
}

function ToggleRow({ label, hint, on, saving, onToggle }: ToggleRowProps): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={saving}
      onClick={onToggle}
      className="ds-tactile w-full flex items-center justify-between gap-3 min-h-[48px] px-4 py-3 rounded-md text-left bg-surface-light-2 dark:bg-surface-dark-2 disabled:opacity-60"
    >
      <span className="min-w-0">
        <span className="block text-base font-medium text-ink-light-1 dark:text-ink-dark-1">
          {label}
        </span>
        <span className="block text-xs text-ink-light-2 dark:text-ink-dark-2">
          {hint}
        </span>
      </span>
      <span
        aria-hidden
        className={`shrink-0 w-11 h-6 rounded-full p-0.5 transition-colors ${
          on ? "bg-brand-primary" : "bg-surface-light dark:bg-surface-dark"
        }`}
      >
        <span
          className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${
            on ? "translate-x-5" : ""
          }`}
        />
      </span>
    </button>
  );
}
