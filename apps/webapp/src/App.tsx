// Phase 1: minimal placeholder. The real shell (theme, router, DS, i18n,
// quick-wheels home) is built in Phase 4 per docs/spec.md §15.

export function App(): JSX.Element {
  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100dvh",
        gap: "0.5rem",
        fontFamily: "system-ui, -apple-system, sans-serif",
        background: "#0E0B1A",
        color: "#FFFFFF",
        padding: "1rem",
        textAlign: "center",
      }}
    >
      <h1
        style={{
          fontSize: "clamp(3rem, 12vw, 6rem)",
          fontWeight: 800,
          color: "#FFB84D",
          margin: 0,
          letterSpacing: "-0.02em",
        }}
      >
        Hoba!
      </h1>
      <p style={{ color: "#B8B2D6", margin: 0, fontSize: "1rem" }}>
        Phase 1 scaffolding · see <code>docs/spec.md</code>
      </p>
    </main>
  );
}
