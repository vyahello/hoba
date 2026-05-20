import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/**
 * Last-resort error boundary so unhandled exceptions during mount or
 * render surface a readable message instead of a blank white screen.
 *
 * iOS / macOS Telegram WebView in particular has no developer console
 * the user can open, so the only way to learn what broke is to render
 * it. Phase 11 polish replaces this with a brand-styled crash page.
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
      const err = this.state.error;
      return (
        <div
          style={{
            padding: "1.5rem",
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            color: "#FFFFFF",
            background: "#0E0B1A",
            minHeight: "100dvh",
            overflowY: "auto",
            wordBreak: "break-word",
          }}
        >
          <h1
            style={{
              color: "#FFB84D",
              fontSize: "1.5rem",
              fontWeight: 800,
              marginBottom: "1rem",
            }}
          >
            Hoba! crashed
          </h1>
          <p style={{ marginBottom: "1rem", color: "#B8B2D6" }}>
            Screenshot this and send it back so we can fix it.
          </p>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              fontSize: "0.75rem",
              lineHeight: 1.4,
              color: "#FF5C9C",
            }}
          >
            {err.name}: {err.message}
            {"\n\n"}
            {err.stack ?? "(no stack)"}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
