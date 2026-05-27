import { Component, type ErrorInfo, type ReactNode } from "react";

import { CrashScreen } from "@/components/CrashScreen";

interface State {
  error: Error | null;
}

/**
 * Last-resort error boundary so unhandled exceptions during mount or
 * render surface a brand-keyed screen instead of a blank white page.
 *
 * iOS / macOS Telegram WebView in particular has no developer console
 * the user can open, so the only way to learn what broke is to render
 * it. The visible UI lives in `CrashScreen` (functional, locale-aware
 * via `useTranslation`); this class only does the React boundary
 * plumbing. Sentry hookup lives in Stage G per docs/roadmap.md.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Still useful when running through `Telegram Desktop → Inspect` or
    // Safari Web Inspector USB-tethered to iPhone.
    console.error("Hoba! crashed:", error, info);
  }

  override render(): ReactNode {
    if (this.state.error !== null) {
      return <CrashScreen error={this.state.error} />;
    }
    return this.props.children;
  }
}
