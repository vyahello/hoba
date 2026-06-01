/**
 * Tactile feedback helpers — per spec §3 ("tactile feedback everywhere")
 * and §6 (Telegram HapticFeedback API).
 *
 * Every primary action should call `impactHeavy()` on press; selection
 * chips fire `selectionChanged()`; result reveals fire `success()`;
 * errors fire `error()`. Outside Telegram these are silent no-ops.
 */

import { tg } from "@/lib/telegram";

type ImpactStyle = "light" | "medium" | "heavy" | "rigid" | "soft";

// Gated by the Settings → Vibration toggle. Default on; flipped via
// `haptics.setEnabled` from the settings store (boot + on toggle).
let enabled = true;

function impact(style: ImpactStyle): void {
  if (!enabled) return;
  try {
    tg.HapticFeedback?.impactOccurred?.(style);
  } catch {
    /* non-Telegram context */
  }
}

function notify(type: "success" | "warning" | "error"): void {
  if (!enabled) return;
  try {
    tg.HapticFeedback?.notificationOccurred?.(type);
  } catch {
    /* noop */
  }
}

/** Enable/disable all tactile feedback (Settings → Vibration). */
export function setHapticsEnabled(value: boolean): void {
  enabled = value;
}

export const haptics = {
  light: (): void => impact("light"),
  medium: (): void => impact("medium"),
  heavy: (): void => impact("heavy"),
  soft: (): void => impact("soft"),

  selection: (): void => {
    if (!enabled) return;
    try {
      tg.HapticFeedback?.selectionChanged?.();
    } catch {
      /* noop */
    }
  },

  success: (): void => notify("success"),
  warning: (): void => notify("warning"),
  error: (): void => notify("error"),
};

export type HapticIntent = keyof typeof haptics;
