import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import "@/i18n";
import "@/index.css";

import { audio } from "@/audio";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { expand, onActivated, ready } from "@/lib/telegram";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { router } from "@/router";

// Wrap each side-effecting bootstrap call so a single SDK failure on
// older iOS / macOS Telegram WebViews cannot break React mount.
try {
  ready();
  expand();
  // Bind the first-gesture Web Audio unlock now so iPhone playback works.
  audio.installUnlock();
  // Telegram "minimise" (swipe-down) backgrounds the WebView and iOS suspends
  // audio; resume it when the Mini App is brought back to the foreground.
  onActivated(() => {
    audio.wake();
  });
} catch (error) {
  console.warn("Telegram WebApp init failed:", error);
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found in index.html");
}

createRoot(container).render(
  <StrictMode>
    <AppErrorBoundary>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
