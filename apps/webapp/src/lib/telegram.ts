/**
 * Typed wrapper around `window.Telegram.WebApp` (via @twa-dev/sdk) with
 * safe no-op fallbacks when the page is opened outside a Telegram client
 * (e.g. browser dev at `localhost:5173`).
 *
 * Use this module instead of touching `window.Telegram.WebApp` directly —
 * it shields callers from "Telegram is undefined" errors and gives clean
 * defaults for theme/haptics in non-Telegram contexts.
 */

import WebApp from "@twa-dev/sdk";

type ColorScheme = "light" | "dark";

export const tg = WebApp;

/** True when the page is being rendered inside a Telegram WebView. */
export function inTelegram(): boolean {
  if (typeof window === "undefined") return false;
  // @twa-dev/sdk hydrates an empty initData when not inside Telegram.
  return Boolean(WebApp.initData);
}

/** Telegram-provided theme + brand-aware fallbacks for browser dev. */
export interface ThemeSnapshot {
  scheme: ColorScheme;
  bg: string;
  secondaryBg: string;
  text: string;
  hint: string;
  link: string;
}

const FALLBACK_LIGHT: ThemeSnapshot = {
  scheme: "light",
  bg: "#FBFAFF",
  secondaryBg: "#F4F2FB",
  text: "#0E0B1A",
  hint: "#4A4560",
  link: "#7C5CFF",
};

const FALLBACK_DARK: ThemeSnapshot = {
  scheme: "dark",
  bg: "#0E0B1A",
  secondaryBg: "#241D3F",
  text: "#FFFFFF",
  hint: "#B8B2D6",
  link: "#FFB84D",
};

export function readTheme(): ThemeSnapshot {
  const params = WebApp.themeParams ?? {};
  const scheme = (WebApp.colorScheme ?? "light") as ColorScheme;
  const fallback = scheme === "dark" ? FALLBACK_DARK : FALLBACK_LIGHT;
  return {
    scheme,
    bg: params.bg_color ?? fallback.bg,
    secondaryBg: params.secondary_bg_color ?? fallback.secondaryBg,
    text: params.text_color ?? fallback.text,
    hint: params.hint_color ?? fallback.hint,
    link: params.link_color ?? fallback.link,
  };
}

export function ready(): void {
  try {
    WebApp.ready();
  } catch {
    /* non-Telegram context */
  }
}

export function expand(): void {
  try {
    WebApp.expand();
  } catch {
    /* non-Telegram context */
  }
}

/** Subscribe to Telegram's `themeChanged` event; returns an unsubscriber. */
export function onThemeChanged(handler: () => void): () => void {
  try {
    WebApp.onEvent("themeChanged", handler);
    return () => {
      WebApp.offEvent("themeChanged", handler);
    };
  } catch {
    return () => {
      /* noop */
    };
  }
}

/** Read `start_param` from initData (`?startapp=room_<CODE>`). */
export function readStartParam(): string | undefined {
  try {
    return WebApp.initDataUnsafe.start_param;
  } catch {
    return undefined;
  }
}

/** Read Telegram user's `language_code`, primary subtag only (`uk`, `en`). */
export function readUserLanguage(): string | undefined {
  try {
    return WebApp.initDataUnsafe.user?.language_code
      ?.toLowerCase()
      .split("-", 1)[0];
  } catch {
    return undefined;
  }
}
