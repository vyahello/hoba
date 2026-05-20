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
      },
      animation: {
        "aurora-drift": "aurora-drift 30s ease-in-out infinite",
        "live-pulse": "live-pulse 1.8s ease-in-out infinite",
        "hoba-pop": "hoba-pop 900ms cubic-bezier(0.68, -0.55, 0.27, 1.55) forwards",
        "code-pulse": "code-pulse 2.4s ease-out infinite",
        "spinner-breath": "spinner-breath 2.2s ease-in-out infinite",
        "skeleton-shimmer": "skeleton-shimmer 1.6s linear infinite",
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
