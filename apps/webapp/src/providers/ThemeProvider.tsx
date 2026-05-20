import { type ReactNode, useEffect } from "react";

import { onThemeChanged, readTheme } from "@/lib/telegram";

function applyTheme(): void {
  const t = readTheme();
  const root = document.documentElement;
  root.style.setProperty("--tg-bg", t.bg);
  root.style.setProperty("--tg-secondary-bg", t.secondaryBg);
  root.style.setProperty("--tg-text", t.text);
  root.style.setProperty("--tg-hint", t.hint);
  root.style.setProperty("--tg-link", t.link);
  root.classList.toggle("dark", t.scheme === "dark");
}

/**
 * Mirrors Telegram's themeParams into CSS variables (`--tg-*`) and the
 * `dark` class on `<html>`. Re-applies on every `themeChanged` event so
 * the user switching Telegram's light/dark scheme propagates live.
 *
 * Brand surfaces (Wheel, HobaWord, ResultBanner, etc.) intentionally
 * ignore these vars and use the fixed brand palette — Telegram is the
 * picture frame, the brand is the painting.
 */
export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  useEffect(() => {
    applyTheme();
    return onThemeChanged(applyTheme);
  }, []);

  return <>{children}</>;
}
