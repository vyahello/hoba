/**
 * localStorage wrapper that swallows access errors.
 *
 * iOS / macOS Telegram WebView occasionally blocks `localStorage` access
 * (private-browsing mode, partitioned storage, sandboxed third-party
 * contexts). A bare `localStorage.getItem` would throw `SecurityError`
 * during app bootstrap — crashing React before mount and yielding a
 * blank screen. These wrappers turn every storage failure into a no-op
 * so the app degrades gracefully (loses persistence, keeps running).
 */

export const safeStorage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* private mode / quota / sandboxed context */
    }
  },
  remove(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};
