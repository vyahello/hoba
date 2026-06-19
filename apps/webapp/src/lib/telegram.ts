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

import {
  buildRoomInviteLink as buildRoomInviteLinkPure,
  extractStartParam,
} from "@/lib/startParam";

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

/**
 * Ask Telegram to prompt before the user swipes the Mini App closed —
 * called when the user enters an active room so accidental swipes
 * during a spin don't kill the session for everyone.
 */
export function enableClosingConfirmation(): void {
  try {
    WebApp.enableClosingConfirmation();
  } catch {
    /* non-Telegram context */
  }
}

export function disableClosingConfirmation(): void {
  try {
    WebApp.disableClosingConfirmation();
  } catch {
    /* non-Telegram context */
  }
}

/**
 * Native Telegram confirm dialog for destructive actions (close room, kick).
 * Falls back to `window.confirm` outside Telegram (dev/browser).
 */
export function confirmPopup(message: string): Promise<boolean> {
  const wa = WebApp as unknown as {
    showConfirm?: (message: string, callback: (confirmed: boolean) => void) => void;
  };
  if (typeof wa.showConfirm === "function") {
    return new Promise((resolve) => {
      wa.showConfirm!(message, (confirmed) => {
        resolve(confirmed);
      });
    });
  }
  return Promise.resolve(
    typeof window !== "undefined" && typeof window.confirm === "function"
      ? window.confirm(message)
      : true,
  );
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

/**
 * Telegram's stable viewport height in px (the visible area excluding the
 * expandable/transient region). Drives the `--app-height` CSS var so the
 * spin screen can be exactly one viewport tall without scroll. Returns 0
 * outside Telegram, where callers fall back to the CSS `100dvh` default.
 */
export function readViewportStableHeight(): number {
  try {
    return WebApp.viewportStableHeight ?? 0;
  } catch {
    return 0;
  }
}

/** Subscribe to Telegram's `viewportChanged` event; returns an unsubscriber. */
export function onViewportChanged(handler: () => void): () => void {
  try {
    WebApp.onEvent("viewportChanged", handler);
    return () => {
      WebApp.offEvent("viewportChanged", handler);
    };
  } catch {
    return () => {
      /* noop */
    };
  }
}

/**
 * Open a `t.me/...` link via Telegram's native handler. Falls back to
 * `window.open` outside Telegram. Returns true on success.
 */
export function openTelegramLink(url: string): boolean {
  try {
    WebApp.openTelegramLink(url);
    return true;
  } catch {
    if (typeof window !== "undefined") {
      window.open(url, "_blank");
      return true;
    }
    return false;
  }
}

/**
 * Open an external (non-`t.me`) https link — Telegram's in-app browser via
 * `WebApp.openLink`, falling back to `window.open` outside Telegram. Used for
 * attribution links (track source, CC-BY license). Returns true on success.
 */
export function openExternalLink(url: string): boolean {
  try {
    WebApp.openLink(url);
    return true;
  } catch {
    if (typeof window !== "undefined") {
      window.open(url, "_blank");
      return true;
    }
    return false;
  }
}

/**
 * Read `start_param` from the launch surface, with three fallbacks so
 * the share-deep-link lands regardless of which Telegram client + SDK
 * version the recipient is on. See `lib/startParam.ts` for the why.
 */
export function readStartParam(): string | undefined {
  let sdkValue: string | undefined;
  try {
    sdkValue = WebApp.initDataUnsafe.start_param;
  } catch {
    sdkValue = undefined;
  }
  const hash = readWindowHash();
  const search = readWindowSearch();
  return extractStartParam({ sdkStartParam: sdkValue, hash, search });
}

function readWindowHash(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.location.hash;
  } catch {
    return "";
  }
}

function readWindowSearch(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.location.search;
  } catch {
    return "";
  }
}

/**
 * Bot username + optional app short_name come from Vite env at build
 * time. Defaulting to `hobagame_bot` keeps the link working when the
 * webapp is built without `.env` (e.g. fresh clone).
 */
export function getBotUsername(): string {
  const fromEnv = import.meta.env.VITE_TELEGRAM_BOT_USERNAME;
  return typeof fromEnv === "string" && fromEnv.length > 0 ? fromEnv : "hobagame_bot";
}

export function getAppShortName(): string | undefined {
  const fromEnv = import.meta.env.VITE_TELEGRAM_APP_SHORT_NAME;
  return typeof fromEnv === "string" && fromEnv.length > 0 ? fromEnv : undefined;
}

/** Build a `t.me/<bot>[/<short>]?startapp=room_<CODE>` invite link. */
export function buildRoomInviteLink(roomCode: string): string {
  return buildRoomInviteLinkPure({
    roomCode,
    botUsername: getBotUsername(),
    appShortName: getAppShortName(),
  });
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
