import { type NavigateFunction } from "react-router-dom";

interface SafeNavigateBackOpts {
  /** Override `window.history.length` (test-only). */
  historyLength?: number;
}

/**
 * Navigate "back" with a safe fallback for deep-link entrants. When the
 * Mini App is opened via `t.me/hobagame_bot?startapp=room_<CODE>`,
 * `RootLayout` `navigate(target, { replace: true })`s to `/room/<CODE>`
 * so `window.history.length` stays at 1 — `navigate(-1)` is a no-op
 * and the user is stuck. In that case, go home instead.
 */
export function safeNavigateBack(
  navigate: NavigateFunction,
  opts: SafeNavigateBackOpts = {},
): void {
  const length = opts.historyLength ?? window.history.length;
  if (length > 1) {
    navigate(-1);
  } else {
    navigate("/");
  }
}
