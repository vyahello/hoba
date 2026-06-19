# Hoba! — Design System (Master)

> **LOGIC:** When building a page, check `design-system/hoba/pages/[page].md` first;
> if present it overrides this file, else follow this Master.
>
> **Project:** Hoba (Telegram Mini App party game) · **Category:** Gaming / casual social
> **Direction:** **Playful Neubrutalism**, mapped to the Telegram client theme.

This Master **reconciles** the UI/UX Pro Max generator output with Hoba's hard
constraints (Telegram theming, the performance/thermal budget, Cyrillic support). Where
the raw generator suggestion conflicts, the constraint wins — see "Reconciliation" below.

---

## Direction: Playful Neubrutalism

Flat, bold, high-contrast, friendly. Solid color fills, **bold borders (3px)**, **hard
offset shadows (4px 4px 0, zero blur)**, big bold display type, chunky-but-slightly-rounded
corners, tactile "press into the shadow" feedback. Rated ⚡ Excellent performance / WCAG
AAA — no gradients-as-crutch, no blur, no always-on glow. Party-game fun without GPU heat.

## Color — follows the Telegram client theme

**Chrome (surface / text / border) follows the client theme** via CSS variables that
bridge `themeParams`; light/dark tracks the user's Telegram client. **Brand accents are
constants** — the playful pop (and the wheel palette), not chrome.

| Token (CSS var) | Tailwind | Light | Dark | Source |
|---|---|---|---|---|
| `--ds-bg` | `bg-ds-bg` | `#FBFAFF` | `#0E0B1A` | `var(--tg-bg)` (themeParams) |
| `--ds-surface` | `bg-ds-surface` | `#FFFFFF` | `#241D3F` | brand fallback |
| `--ds-surface-2` | `bg-ds-surface-2` | `#F4F2FB` | `#241D3F` | `var(--tg-secondary-bg)` |
| `--ds-text` | `text-ds-text` | `#0E0B1A` | `#FFFFFF` | `var(--tg-text)` |
| `--ds-text-muted` | `text-ds-text-muted` | `#4A4560` | `#B8B2D6` | `var(--tg-hint)` |
| `--ds-border` | `border-ds-border` | `#14101F` | `#F4F2FB` | neubrutalist outline (scheme-switched) |
| `--ds-shadow` | (in `shadow-brutal`) | `#14101F` | `#000000` | hard shadow color |

**Brand accents (constant):** primary `#7C5CFF`, primary-strong `#5B3DF5`, accent
`#FFB84D`, pink `#FF5C9C`, cyan `#5CE5FF`, rigged `#FF3B6B`; state success/warning/danger.
Wheel palette = the 12 `WHEEL_PALETTE` hexes (unchanged — server + Wheel depend on it).

## Typography

- **Display/headings:** Manrope (700/800) — `font-display`. Bold, friendly, **has Cyrillic**.
- **UI/body:** Inter (400–700) — `font-ui`. **Has Cyrillic**.
- **Mono:** JetBrains Mono — `font-mono` (codes, "live").
- Loaded locally via `@fontsource` (Latin + Cyrillic subsets). **No external Google Fonts.**

## Shape, shadow, motion tokens

- **Border:** `3px solid var(--ds-border)` on cards/buttons/inputs.
- **Shadow:** `shadow-brutal` = `4px 4px 0 var(--ds-shadow)` (also `-sm` 2px, `-lg` 6px).
  **Static only** — never on a continuously moving element.
- **Radii:** keep brand scale (md 16 / lg 24) — "slightly rounded" playful, not razor brutalism.
- **Press:** `.ds-tactile` translates `(2px,2px)` (transform-only) + shadow swaps to `-sm`.
- **Easings/durations:** existing `spring`/`wheel`/`pop`, fast/medium/slow tokens.

## Performance budget (NON-NEGOTIABLE — applies to every screen)

- Animate **transform/opacity only**. Never animate top/left/width/height/box-shadow/filter
  on moving elements. No layout thrashing.
- Spin wheel = **one `requestAnimationFrame`** loop, `cancelAnimationFrame` the instant it
  settles. **No `setInterval` for animation. No loop while idle.**
- **Pause all animation/timers/RAF/particles/confetti on `document.hidden`** / viewport
  blur; resume on focus.
- **No always-on effects** — no infinite glow/shimmer/particle loops behind idle screens.
  Decorative motion is one-shot or on-interaction only.
- **No `backdrop-blur`; no large/blurred box-shadows** on animated or large surfaces (hard
  zero-blur shadows on static elements are fine).
- Respect `prefers-reduced-motion` (global CSS kill-switch in `index.css`).
- Bounded re-renders: memoize, no per-frame state, no context churn during the spin.
  Throttle/back-off WebSocket when idle.
- Lazy-load non-critical screens/assets; prefer SVG/CSS over canvas for decoration.

## Telegram integration (must keep working)

`themeParams`→`--tg-*` (ThemeProvider), `colorScheme`→`dark` class, `BackButton`,
`HapticFeedback` (spin + win), `viewportStableHeight`→`--app-height`,
`env(safe-area-inset-*)` via `pt-safe`/`pb-safe`. Touch-first, **no hover-only**
affordances. Disable overscroll / pull-to-close on the spin screen.

## Reconciliation — generator output vs. constraints

| Generator suggested | Decision | Why |
|---|---|---|
| Style: Retro-Futurism (CRT scanlines, neon glow, glitch) | **Rejected** → Neubrutalism | Glow/scanlines/glitch = always-on box-shadow/filter loops → violate the thermal budget. |
| Fixed rose palette (`#E11D48`/`#FFF1F2`…) | **Rejected** | Must follow Telegram `themeParams` for surfaces; brand pop stays purple/amber (wheel palette). |
| Fonts: Caveat + Quicksand via Google Fonts `@import` | **Rejected** → keep Manrope/Inter | Quicksand lacks full Cyrillic (breaks Ukrainian); external `@import` blocks first paint. |
| Pattern: Hero + Testimonials + CTA | **N/A** | Landing-page pattern; Hoba is an app, not a marketing page. |
| Soft elevation shadows (`0 10px 15px …`) | **Replaced** with hard zero-blur `shadow-brutal` | Blur shadows are costlier and off-style; hard offset is the neubrutalist signature. |
| Hover states in component specs | **Adapted** | Mobile-native: `:active`/`focus-visible` only, no hover affordances. |

## Pre-delivery checklist (per screen)
- [ ] Surfaces/text via `ds-*` tokens (theme-following); accents via `brand-*`.
- [ ] Borders 3px, hard `shadow-brutal`, no blur/backdrop-blur.
- [ ] Only transform/opacity animated; any new RAF cancelled on settle + paused when hidden.
- [ ] No always-on loops; reduced-motion respected.
- [ ] 44×44 tap targets; body ≥14 / primary ≥16px; safe-area insets.
- [ ] All copy via `t()` (EN + UK); brand `Hoba!`/`Хоба!` locale-aware.
