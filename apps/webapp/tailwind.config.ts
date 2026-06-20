import type { Config } from "tailwindcss";

// All tokens in this file are committed per spec §1. Do not improvise
// hexes or curves — colors, easings, durations, radii, and shadows
// are the single source of truth for the brand surface.

const WHEEL_PALETTE = [
  "#7C5CFF",
  "#FFB84D",
  "#FF5C9C",
  "#5CE5FF",
  "#22C55E",
  "#F472B6",
  "#3B82F6",
  "#F59E0B",
  "#8B5CF6",
  "#10B981",
  "#EF4444",
  "#06B6D4",
] as const;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          primary: "#7C5CFF",
          "primary-strong": "#5B3DF5",
          accent: "#FFB84D",
          "accent-strong": "#FF9F1C",
          pink: "#FF5C9C",
          cyan: "#5CE5FF",
          rigged: "#FF3B6B",
        },
        state: {
          success: "#22C55E",
          warning: "#F59E0B",
          danger: "#EF4444",
        },
        surface: {
          light: "#FFFFFF",
          "light-2": "#F4F2FB",
          dark: "#1A1530",
          "dark-2": "#241D3F",
        },
        bg: {
          light: "#FBFAFF",
          dark: "#0E0B1A",
        },
        ink: {
          "light-1": "#0E0B1A",
          "light-2": "#4A4560",
          "dark-1": "#FFFFFF",
          "dark-2": "#B8B2D6",
        },
        // Telegram themeParams overrides — set by ThemeProvider via CSS vars.
        // Use these for any element that should blend into Telegram chrome
        // (sticky headers, secondary text). Brand surfaces ignore them.
        tg: {
          bg: "var(--tg-bg, #FBFAFF)",
          "secondary-bg": "var(--tg-secondary-bg, #F4F2FB)",
          text: "var(--tg-text, #0E0B1A)",
          hint: "var(--tg-hint, #4A4560)",
          link: "var(--tg-link, #7C5CFF)",
        },
        // Semantic design tokens — chrome that follows the Telegram client
        // theme (via the --ds-* vars in index.css, which bridge themeParams).
        // Prefer these for surfaces/text/borders so light/dark tracks the
        // client; reserve brand.* for the playful accent pop.
        ds: {
          bg: "var(--ds-bg)",
          surface: "var(--ds-surface)",
          "surface-2": "var(--ds-surface-2)",
          text: "var(--ds-text)",
          "text-muted": "var(--ds-text-muted)",
          border: "var(--ds-border)",
        },
        wheel: Object.fromEntries(
          WHEEL_PALETTE.map((color, i) => [i, color]),
        ),
      },
      fontFamily: {
        ui: ['"Inter"', "system-ui", "sans-serif"],
        display: ['"Manrope"', '"Inter"', "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
      borderRadius: {
        sm: "10px",
        md: "16px",
        lg: "24px",
        xl: "32px",
        pill: "999px",
      },
      boxShadow: {
        card: "0 6px 24px -8px rgba(124, 92, 255, 0.22)",
        spin: "0 16px 48px -8px rgba(124, 92, 255, 0.55)",
        glow: "0 0 32px rgba(255, 184, 77, 0.55)",
        hoba: "0 12px 60px -8px rgba(255, 184, 77, 0.75)",
        // Neubrutalist hard offset shadows — zero blur (GPU-cheap), color
        // adapts to light/dark via --ds-shadow. Static surfaces only; never
        // animate these on a moving element (PERF_AUDIT).
        "brutal-sm": "2px 2px 0 0 var(--ds-shadow)",
        brutal: "4px 4px 0 0 var(--ds-shadow)",
        "brutal-lg": "6px 6px 0 0 var(--ds-shadow)",
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
        wheel: "cubic-bezier(0.15, 0.85, 0.25, 1)",
        pop: "cubic-bezier(0.68, -0.55, 0.27, 1.55)",
      },
      transitionDuration: {
        fast: "150ms",
        medium: "250ms",
        slow: "450ms",
      },
      keyframes: {
        "aurora-drift": {
          "0%, 100%": { transform: "translate3d(0, 0, 0) rotate(0deg)" },
          "33%": { transform: "translate3d(-8%, 6%, 0) rotate(8deg)" },
          "66%": { transform: "translate3d(6%, -4%, 0) rotate(-6deg)" },
        },
        "live-pulse": {
          "0%, 100%": { transform: "scale(1)", opacity: "1" },
          "50%": { transform: "scale(1.6)", opacity: "0.3" },
        },
        "hoba-pop": {
          "0%": { transform: "scale(0.4) rotate(-12deg)", opacity: "0" },
          "55%": { transform: "scale(1.15) rotate(6deg)", opacity: "1" },
          "100%": { transform: "scale(1) rotate(4deg)", opacity: "1" },
        },
        "code-pulse": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(124, 92, 255, 0.6)" },
          "70%": { boxShadow: "0 0 0 10px rgba(124, 92, 255, 0)" },
        },
        "spinner-breath": {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.04)" },
        },
        "skeleton-shimmer": {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
        // Chaos earthquake: a hard, decaying screen shake on the room content.
        "screen-quake": {
          "0%, 100%": { transform: "translate3d(0, 0, 0)" },
          "10%": { transform: "translate3d(-7px, 4px, 0)" },
          "20%": { transform: "translate3d(8px, -5px, 0)" },
          "30%": { transform: "translate3d(-9px, 6px, 0)" },
          "40%": { transform: "translate3d(7px, -4px, 0)" },
          "50%": { transform: "translate3d(-6px, 5px, 0)" },
          "60%": { transform: "translate3d(8px, -6px, 0)" },
          "70%": { transform: "translate3d(-6px, 4px, 0)" },
          "80%": { transform: "translate3d(4px, -3px, 0)" },
          "90%": { transform: "translate3d(-3px, 2px, 0)" },
        },
        // Chaos glitch: a jittery RGB-split flicker on the broken-wheel overlay.
        "glitch-jitter": {
          "0%, 100%": { transform: "translate3d(0, 0, 0)", opacity: "0.85" },
          "20%": { transform: "translate3d(-5px, 2px, 0)", opacity: "0.55" },
          "40%": { transform: "translate3d(6px, -3px, 0)", opacity: "0.9" },
          "60%": { transform: "translate3d(-4px, -2px, 0)", opacity: "0.45" },
          "80%": { transform: "translate3d(5px, 3px, 0)", opacity: "0.8" },
        },
        // Chaos glitch: horizontal scanlines crawling down the overlay.
        "glitch-scan": {
          "0%": { backgroundPosition: "0 0" },
          "100%": { backgroundPosition: "0 16px" },
        },
        // Chaos earthquake: a red "danger" vignette pulsing over the screen.
        "danger-flash": {
          "0%, 100%": { opacity: "0" },
          "20%, 60%": { opacity: "1" },
          "40%, 80%": { opacity: "0.45" },
        },
      },
      animation: {
        "aurora-drift": "aurora-drift 30s ease-in-out infinite",
        "live-pulse": "live-pulse 1.8s ease-in-out infinite",
        "hoba-pop": "hoba-pop 900ms cubic-bezier(0.68, -0.55, 0.27, 1.55) forwards",
        "code-pulse": "code-pulse 2.4s ease-out infinite",
        "spinner-breath": "spinner-breath 2.2s ease-in-out infinite",
        "skeleton-shimmer": "skeleton-shimmer 1.6s linear infinite",
        "screen-quake": "screen-quake 950ms cubic-bezier(0.36, 0.07, 0.19, 0.97) both",
        "glitch-jitter": "glitch-jitter 320ms steps(2, end) infinite",
        "glitch-scan": "glitch-scan 220ms linear infinite",
        "danger-flash": "danger-flash 950ms ease-in-out",
      },
      backgroundImage: {
        "aurora-light":
          "radial-gradient(at 18% 22%, rgba(124, 92, 255, 0.38) 0px, transparent 55%), " +
          "radial-gradient(at 82% 18%, rgba(255, 92, 156, 0.32) 0px, transparent 50%), " +
          "radial-gradient(at 50% 88%, rgba(255, 184, 77, 0.30) 0px, transparent 55%)",
        "aurora-dark":
          "radial-gradient(at 18% 22%, rgba(124, 92, 255, 0.55) 0px, transparent 55%), " +
          "radial-gradient(at 82% 18%, rgba(255, 92, 156, 0.45) 0px, transparent 50%), " +
          "radial-gradient(at 50% 88%, rgba(255, 184, 77, 0.32) 0px, transparent 55%)",
      },
    },
  },
  plugins: [],
} satisfies Config;

export { WHEEL_PALETTE };
