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

function impact(style: ImpactStyle): void {
  try {
    tg.HapticFeedback?.impactOccurred?.(style);
  } catch {
    /* non-Telegram context */
  }
}

export const haptics = {
  light: (): void => impact("light"),
  medium: (): void => impact("medium"),
  heavy: (): void => impact("heavy"),
  soft: (): void => impact("soft"),

  selection: (): void => {
    try {
      tg.HapticFeedback?.selectionChanged?.();
    } catch {
      /* noop */
    }
  },

  success: (): void => {
    try {
      tg.HapticFeedback?.notificationOccurred?.("success");
    } catch {
      /* noop */
    }
  },

  warning: (): void => {
    try {
      tg.HapticFeedback?.notificationOccurred?.("warning");
    } catch {
      /* noop */
    }
  },

  error: (): void => {
    try {
      tg.HapticFeedback?.notificationOccurred?.("error");
    } catch {
      /* noop */
    }
  },
};

export type HapticIntent = keyof typeof haptics;
