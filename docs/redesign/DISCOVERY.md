# Hoba! — Visual Redesign Discovery

> **Scope:** discovery + plan for a full visual redesign of the deployed Telegram Mini
> App. **No code was changed in this pass.**
> **Hard constraint:** restyle only. Do **not** change game logic, backend, Telegram
> integration, routing, or state flow.
> **Date:** 2026-06-19. **Commit:** `59a6941`. Companion: [`PERF_AUDIT.md`](./PERF_AUDIT.md).

This document maps every screen, classifies every component as **PRESENTATIONAL**
(safe to restyle) vs **LOGIC/STATE** (untouchable), inventories the Telegram SDK and
styling systems, identifies the seams where the visual layer swaps cleanly, flags
components that mix logic + presentation, and lays out a screen-by-screen plan.

---

## 0. How styling flows today (the redesign levers)

The app already has a disciplined three-layer visual system. A redesign rides these
layers in order of leverage:

```
tailwind.config.ts  ──►  src/components/ds/*  ──►  pages compose DS + inline classes
(design tokens)          (visual vocabulary)        (layout + token classNames)
        │                        │
        └── index.css (@layer components/utilities: ds-glass-header, ds-tactile, focus, fonts)
```

1. **`apps/webapp/tailwind.config.ts`** — the single source of truth for brand color,
   radii, shadows, easings, fonts, keyframes, and the wheel/aurora palettes
   (`tailwind.config.ts:7-151`). Comment at top: *"Do not improvise hexes… single source
   of truth."* **Changing these tokens reskins the entire app at once** — the highest-leverage lever.
2. **`src/components/ds/*` (18 primitives)** — Button, Card, Sheet, Input, etc. Every page
   composes these. Restyle a primitive → every screen inherits.
3. **`src/index.css`** — global base + the `@layer components` classes (`ds-glass-header`,
   `ds-tactile`, `ds-tap-target`), focus/selection rings, font `@import`s
   (`index.css:1-107`).
4. **Per-page `className` strings** — pages also carry layout + token classes inline
   (e.g. `HomePage.tsx:82-249`). These are presentational and restyleable, but a full
   redesign touches them screen-by-screen.

**Implication:** ~80% of the visual change can land in layers 1–3 (tokens + DS + global
CSS) without opening a single page's logic. The remaining work is per-page JSX/className.

---

## 1. Screen / route map

Routing is `createBrowserRouter` (`src/router.tsx`), all routes nested under one
`RootLayout` (`src/components/layout/RootLayout.tsx`) which renders the persistent
`<AuroraBackground />`, the `<Outlet />`, and the `<Toaster />`. **Routes and the layout
shell must not change.**

| Route | Page component | Purpose | Key child components | Logic density | Redesign risk |
|-------|----------------|---------|----------------------|---------------|---------------|
| `/` | `HomePage` (253L) | Onboarding/hub — quick templates, create, my wheels, trending | QuickWheelCard, Card, EmptyState, Skeleton, IconButton | Low (3 fetch effects + nav) | **Low** |
| `/spin/:wheelId` | `SpinPage` (313L) | Solo spin + result + "create room" entry | **Wheel**, ResultBanner, HobaWord, ConfettiBurst, RoomModePickerSheet | Med (spin timers, reveal) | **Med** |
| `/create` | `CreatePage` (272L) | Build a custom wheel (form) | Input, Button, SegmentChip, Card | Med (form state + api) | **Low–Med** |
| `/room/:code` | `RoomPage` (1521L) | Multiplayer room — all 5 modes, spin, standings, betting, moderation, winner | **Wheel**, WinnerOverlay, FlyingReactions, ReactionsBar, RoomCodePill, RealtimeIndicator, AvatarStack, all room sheets | **Very high** (13 effects, socket, spin orchestration) | **High** |
| `/library` | `LibraryPage` (232L) | Saved wheels CRUD + make public | Card, Button, Sheet, EmptyState | Med (7 api calls) | **Low–Med** |
| `/trending` | `TrendingPage` (239L) | Public/trending wheels, like/report | PublicWheelCard, Card | Med (6 api calls) | **Low–Med** |
| `/settings` | `SettingsPage` (217L) | Sound/vibration/music/language toggles + legal links | Card, toggle rows | Low–Med (settings store) | **Low** |
| `/admin/moderation` | `AdminModerationPage` (204L) | Reported-wheel review queue (admins only) | Card, Button | Med (5 api calls) | **Low** (niche) |
| `/privacy`, `/terms` | `LegalPage` (66L) | Static legal copy | — | **None** (pure render) | **Trivial** |
| `/credits` | `CreditsPage` (137L) | CC-BY music attribution + links | — | None (just links) | **Trivial** |
| `/dev/ds` | `DevDSPage` (403L) | Design-system showcase (dev-only; i18n-exempt) | every DS primitive | Low | **Use as the redesign sandbox** |

**Onboarding note:** there is **no dedicated onboarding route**. `HomePage` *is* the
first-run surface (its own comment: *"the screen 80% of opens land on… reach a spin
within 10s"*, `HomePage.tsx:14-18`), and deep-link entry (`?startapp=room_XYZ`) routes
straight to `/room/:code` via `RootLayout.tsx:28-37`. A redesign that wants a true
onboarding/coachmark layer would **add** a presentational overlay — not change routing.

**Modals/overlays (not routes):** rendered via the `Sheet` portal or inline overlays —
RoomModePickerSheet, RoomSettingsSheet, RigEditorSheet, InviteSheet, WinnerOverlay,
SpinPage result overlay, Toaster, RigReveal. All presentational shells over logic.

---

## 2. Component inventory & classification

### Tier A — PURE PRESENTATIONAL (restyle freely; no logic inside)
Safe to fully redraw — they take props and render markup, no store/api/SDK/state.

| Component | File | Notes |
|-----------|------|-------|
| AuroraBackground | `ds/AuroraBackground.tsx` | Animated gradient backdrop. **Also see PERF_AUDIT R1** — redesign should scope it to lobby/result, not app-wide. |
| Avatar, AvatarStack | `ds/Avatar*.tsx` | Player avatars/initials. |
| EmptyState | `ds/EmptyState.tsx` | Empty-list placeholder. |
| HobaWord | `ds/HobaWord.tsx` | The signature "Хоба!/Hoba!" brand moment (framer entrance). |
| RealtimeIndicator | `ds/RealtimeIndicator.tsx` | "live" pulse dot (prop `active`). |
| ResultBanner | `ds/ResultBanner.tsx` | Spin result card. |
| Skeleton | `ds/Skeleton.tsx` | Loading shimmer. |
| InviteSheet | `room/InviteSheet.tsx` | Share-link sheet body (pure props). |
| WinnerOverlay | `room/WinnerOverlay.tsx` | End-of-game celebration (props only). |
| GameModeBadge | `room/GameModeBadge.tsx` | Mode pill (imports api *type* only). |
| PublicWheelCard | `trending/PublicWheelCard.tsx` | Trending card (imports api *type* only). |
| StubPage, CrashScreen | `layout/StubPage.tsx`, `components/CrashScreen.tsx` | Fallbacks. |

### Tier B — PRESENTATIONAL + fire-and-forget side effects (restyle visuals; KEEP the side-effect wiring)
Mostly markup, but each fires haptics/audio or owns trivial UI-only state. Restyle
`className`/markup; do **not** remove the `haptics.*` / `audio.play` / `onClick` calls
or the local UI state.

| Component | File | Keep intact |
|-----------|------|-------------|
| Button | `ds/Button.tsx` | `handleClick` → haptics + `audio.play("ui_tap")` + `onClick` (`Button.tsx:68-76`); variants/sizes are token-driven (`:20-40`) — restyle by editing those maps. |
| Card | `ds/Card.tsx` | interactive press → haptics. |
| IconButton | `ds/IconButton.tsx` | haptics; the 44×44 `ds-tap-target` guard. |
| QuickWheelCard | `ds/QuickWheelCard.tsx` | haptics on tap. |
| SegmentChip | `ds/SegmentChip.tsx` | selection haptics. |
| RoomCodePill | `ds/RoomCodePill.tsx` | copy-to-clipboard + haptics; **PERF_AUDIT R6** (box-shadow pulse). |
| Sheet | `ds/Sheet.tsx` | framer drag-to-dismiss + ESC + `createPortal` + `audio` on open (`Sheet.tsx:34-101`); preserve `pb-safe`, `max-h-[90dvh]`, `role="dialog"`. |
| Input | `ds/Input.tsx` | controlled-input UI state. |
| ConfettiBurst | `ds/ConfettiBurst.tsx` | `useEffect` fires `canvas-confetti` on trigger. |
| Toast / Toaster | `ds/Toast.tsx` | subscribes to the toast store for the queue; restyle the toast shell only. |
| FlyingReactions | `room/FlyingReactions.tsx` | reads `reactions` from room store; restyle the floating `motion.span` only, keep the subscription. |

### Tier C — MIXED logic + presentation (restyle WITH CARE; split recommended)
These embed business logic (api mutations, store writes, multi-step forms) **inside**
the sheet/JSX. You can restyle them in place by touching only layout/`className` and
leaving every handler/effect untouched — but they are the prime **split** candidates
(see §5).

| Component | File | Embedded logic |
|-----------|------|----------------|
| RoomModePickerSheet | `room/RoomModePickerSheet.tsx` (270L) | Mode/deck/spin-count selection + `api.createRoom*` orchestration + local form state. |
| RoomSettingsSheet | `room/RoomSettingsSheet.tsx` (294L) | Host moderation: lock/anon toggles, kick, change-mode, close — room store + api + confirm dialogs. |
| RigEditorSheet | `room/RigEditorSheet.tsx` (143L) | Rigged-mode weight editor — store + api + form state. |
| ReactionsBar | `room/ReactionsBar.tsx` (35L) | thin: `sendReaction` + haptics; low risk. |
| RootLayout | `layout/RootLayout.tsx` (80L) | **Structural/logic**: BackButton binding, deep-link nav, settings hydrate, music request. Restyle only the wrapper `<div>` + where AuroraBackground mounts. |

### Tier D — LOGIC CONTAINERS (restyle leaf JSX only; never touch orchestration)
The pages themselves, plus the Wheel engine. Their **markup** is restyleable; their
effects/state/socket/SDK wiring is off-limits.

- **All `src/pages/*`** — restyle the JSX/`className`; do not touch `useEffect`/`useState`/
  api/socket/navigation. Censused logic density in §1.
- **`features/wheel/Wheel.tsx` (514L) — SPECIAL.** It is both the signature visual **and**
  the animation engine. **Restyleable:** segment colors (`WHEEL_PALETTE`), hub gradient,
  pointer shape, label typography/stroke, the SVG `<defs>` (`Wheel.tsx:80-145`, `:324-458`).
  **Untouchable:** the `useMotionValue` rotation, the imperative pointer transform
  (`:215-221`), the spin `animate()` + the rAF tick loop (`:255-300`), `roamPointer`, and
  the spin-math contract (`spinMath.ts`). Treat the SVG drawing and the motion machinery
  as two separate things living in one file (a split candidate — see §5).

---

## 3. Telegram WebApp SDK usage (UNTOUCHABLE integration)

All SDK access is funneled through two wrappers — **do not bypass or modify them**:
`src/lib/telegram.ts` (typed `WebApp` wrapper) and `src/lib/haptics.ts` (HapticFeedback).
Theme is applied by `src/providers/ThemeProvider.tsx`.

| SDK surface | Where | What it does | Redesign impact |
|-------------|-------|--------------|-----------------|
| `ready()`, `expand()` | `main.tsx:16-23` via `telegram.ts:71-85` | Boot handshake + full-height. | None — keep. |
| `themeParams`, `colorScheme` | `telegram.ts:57-69`, applied by `ThemeProvider.tsx:5-14` | Maps Telegram theme → CSS vars `--tg-*` + `dark` class. | **Central to theming** — see §4 (brand vs tg model). |
| `onEvent/offEvent("themeChanged")` | `ThemeProvider.tsx:26-29`, `telegram.ts:131-142` | Live re-theme on Telegram scheme switch. | Keep; redesign inherits it. |
| `BackButton` (show/hide/onClick/offClick) | `RootLayout.tsx:39-55` | Per-route back nav. | Untouchable (it's Telegram chrome, not in-DOM). |
| `HapticFeedback` (impact/notification/selection) | `lib/haptics.ts:18-58` | Tactile feedback on every action. | Keep all call sites; restyle around them. |
| `initData` / `initDataUnsafe` | socket auth (`stores/room.ts:163`), `start_param` (`telegram.ts:184-194`), `user.language_code` (`telegram.ts:239-247`) | Auth, deep-link, locale detect. | Untouchable. |
| `openLink` / `openTelegramLink` | `telegram.ts:148-177` | External + share links. | Keep. |
| `enableClosingConfirmation` / `disable…` | `RoomPage.tsx` via `telegram.ts:92-106` | Guards swipe-to-close mid-room. | Keep. |
| `showConfirm` (confirmPopup) | `telegram.ts:112-128` | Native destructive confirms (kick/close). | Keep. |
| Safe area | **CSS only** — `index.css:99-107` `pt-safe`/`pb-safe` = `env(safe-area-inset-*)`; `100dvh` shells | Insets for headers/sheets/toasts. | **Preserve `pt-safe`/`pb-safe`/`100dvh` on every header, Sheet, Toaster.** |

**Notably absent (and out of scope to add):**
- **No `MainButton`** — every CTA is an **in-DOM `Button`** (e.g. SpinPage/RoomPage). The
  redesign keeps in-DOM CTAs; adopting Telegram's MainButton would be an *integration*
  change, not a restyle.
- **No `setHeaderColor`/`setBackgroundColor`** — the app doesn't tint Telegram chrome. A
  redesign *could* add these for polish, but that's net-new SDK usage → out of this pass.

---

## 4. Styling system inventory

### Design tokens (`tailwind.config.ts`)
- **Color:** `brand` (primary `#7C5CFF`, primary-strong, accent `#FFB84D`, accent-strong,
  pink, cyan, rigged `#FF3B6B`); `state` (success/warning/danger); `surface` + `bg` +
  `ink` in light/dark; **`tg.*` = the `var(--tg-*)` Telegram bridge**; `wheel.0..11` from
  `WHEEL_PALETTE` (`tailwind.config.ts:27-71`).
- **Type:** `font-ui` Inter, `font-display` Manrope, `font-mono` JetBrains Mono (`:72-76`).
- **Radii:** sm 10 / md 16 / lg 24 / xl 32 / pill (`:77-83`).
- **Shadows:** `card`, `spin`, `glow`, `hoba` — all purple/amber-tinted (`:84-89`).
- **Motion tokens:** easings `spring`/`wheel`/`pop`, durations fast/medium/slow (`:90-99`);
  keyframes + animations `aurora-drift`, `live-pulse`, `hoba-pop`, `code-pulse`,
  `spinner-breath`, `skeleton-shimmer` (`:100-135`).
- **Backgrounds:** `aurora-light`/`aurora-dark` multi-stop radial gradients (`:136-145`).

### Global CSS (`src/index.css`)
- Font subsets imported (Latin + Cyrillic, 3 families × several weights — `:1-19`; see
  PERF_AUDIT S4).
- `:root` / `html.dark` define the `--tg-*` fallbacks (`:25-42`).
- **Mobile-native rules to preserve:** no hover states (`@media (hover:hover)` neutralized,
  `:58-63`), `-webkit-tap-highlight-color: transparent`, `overscroll-behavior: none`.
- `@layer components`: `.ds-glass-header` (sticky blur header used by **every** page),
  `.ds-tactile` (active:scale-95 press), `.ds-tap-target` (44×44) (`:79-97`).
- `@layer utilities`: `.pt-safe` / `.pb-safe` (safe-area) (`:99-107`).

### Color/usage model — "Telegram is the frame, the brand is the painting"
`ThemeProvider` pushes Telegram's theme into `--tg-*` vars, but **brand surfaces
deliberately ignore them** and use the fixed brand palette (`tailwind.config.ts:58-67`
comment; `ThemeProvider.tsx:16-24` comment). Chrome-blending elements (sticky headers,
secondary text) use `tg.*`; hero surfaces (Wheel, HobaWord, ResultBanner, buttons) use
brand tokens. **A redesign must consciously decide per surface** whether it blends with
Telegram (`tg.*`) or asserts brand (fixed palette) — and keep the `ThemeProvider`
mechanism either way.

---

## 5. Seams + split recommendations

### Where the visual layer swaps cleanly (no data-flow touch)
1. **Tokens (`tailwind.config.ts`)** — recolor/retype/re-shadow the whole app. Master switch.
2. **Global classes (`index.css`)** — `ds-glass-header`, `ds-tactile`, focus/selection,
   fonts. Changes ripple to every screen.
3. **DS primitives (`ds/*`)** — Button variants/sizes, Card, Sheet shell, Input, Skeleton.
   Restyle once, inherited everywhere.
4. **Per-page JSX `className`** — layout/spacing/section styling, page by page.
5. **AuroraBackground placement** — `RootLayout.tsx:75` is a one-line mount; the redesign
   can scope/replace the backdrop here without touching any page.

### Components that MIX logic + presentation — flag to split (optional but recommended)
A pure restyle can leave these intact; a *clean* redesign should extract their logic into
hooks so the JSX becomes a Tier-A shell:

| Component | Recommended split |
|-----------|-------------------|
| **`RoomPage.tsx` (1521L)** | The biggest seam problem. Extract presentational sub-views — `RoomHeader`, `WheelStage`, `StandingsPanel`, `BettingPanel`, `PunishmentPanel`, `LobbyRoster` — fed by props from a `useRoom(code)` logic container. Lets the redesign work on small presentational files instead of one 1521-line file interleaving socket effects with markup. **Do this before heavy RoomPage restyling.** |
| **`Wheel.tsx` (514L)** | Split the **SVG face** (`SegmentVisual`, defs, hub, pointer, labels) into a presentational `WheelFace` component, leaving the motion-value/rAF engine in `Wheel`. The redesign (and PERF_AUDIT R2's rasterization) then targets `WheelFace` alone. |
| **RoomModePickerSheet / RoomSettingsSheet / RigEditorSheet** | Extract form/mutation logic into `useRoomModeForm` / `useRoomSettings` / `useRigEditor` hooks; the sheets become presentational bodies inside the generic `Sheet`. |

If the team prefers a pure no-refactor restyle, these can be styled in place by editing
**only** `className`/layout and never the handlers — but expect slower, riskier edits.

---

## 6. Screen-by-screen redesign plan

Ordered low-risk → high-risk so the new design language is proven on simple screens
before touching the room. **"Stays" = logic/wiring untouched. "Changes" = visual only.**

### Phase 0 — Foundation (no screen yet)
- **Change:** define the new token set in `tailwind.config.ts` (color, radii, shadow,
  type, motion) and the global classes in `index.css` (`ds-glass-header`, focus, etc.).
- **Stays:** the `--tg-*` bridge, `ThemeProvider`, safe-area utilities, the keyframe
  *names* (components reference them by name — rename in lockstep or keep names).
- **Validate in `/dev/ds`** (the showcase) before any real screen.
- **Risk:** token renames that break a className reference. Mitigate: keep token *keys*,
  change *values* first; rename keys only with a full grep.

### Phase 1 — DS primitives
- **Change:** Button (variants/sizes maps), Card, IconButton, Sheet shell, Input,
  Skeleton, EmptyState, Avatar, Toast shell, SegmentChip, RoomCodePill, RealtimeIndicator.
- **Stays:** all `handleClick`/haptics/audio wiring; Sheet's drag/ESC/portal; `pb-safe`.
- **Risk:** Low. These are Tier A/B. Confirm 44×44 tap targets + no-hover rules survive.

### Phase 2 — Static & simple screens
- **Screens:** `/credits`, `/privacy`, `/terms` (trivial), then `/settings`, `/library`,
  `/trending`, `/admin/moderation`.
- **Change:** headers, cards, list rows, toggles, spacing — all inherit Phase 1.
- **Stays:** every `api.*` call, settings store toggles, navigation.
- **Risk:** Low–Med. LibraryPage/TrendingPage have CRUD + sheets; touch markup only.

### Phase 3 — Home (first impression)
- **Screen:** `/` (`HomePage`).
- **Change:** header brand lockup, the quick-template grid (`QuickWheelCard`), the
  create-custom card, "my wheels" + trending rails. This sets the redesign's tone.
- **Stays:** the three fetch effects (`HomePage.tsx:29-60`) and `spinTemplate`
  (`:62-78`).
- **Risk:** Low — almost pure composition over DS primitives.

### Phase 4 — Solo spin + result
- **Screen:** `/spin/:wheelId` (`SpinPage`) + the **Wheel face** + ResultBanner + HobaWord
  + confetti + result overlay.
- **Change:** wheel palette/hub/pointer/labels (restyle `WheelFace`), the reveal overlay,
  ResultBanner, the bottom CTA.
- **Stays:** spin timers + reveal sequence (`SpinPage.tsx:83-141`), the Wheel motion
  engine, `computeSpin`/`spinMath`. **Coordinate with PERF_AUDIT R2** (rasterize the
  restyled face) and R1/R5 (aurora + confetti budget).
- **Risk:** Med — the Wheel is the brand centerpiece *and* the perf hotspot; split
  `WheelFace` first (§5).

### Phase 5 — The room (last, highest risk)
- **Screen:** `/room/:code` (`RoomPage`) — lobby, all 5 modes, betting, standings,
  moderation sheets, winner, reactions.
- **Pre-req:** decompose RoomPage into presentational sub-views (§5) — strongly recommended
  before restyling.
- **Change:** room header + roster + code pill, the wheel stage, standings/betting panels,
  WinnerOverlay, FlyingReactions, ReactionsBar, and the three room sheets.
- **Stays:** the entire socket layer (`stores/room.ts`), the spin orchestration
  (`RoomPage.tsx:290-403`), closing-confirmation, all mode logic, host moderation
  mutations.
- **Risk:** **High** — most logic, most modes, most overlays, real-time. Restyle leaf
  sub-views incrementally; never edit the effect/orchestration bodies.

---

## 7. Cross-cutting guardrails (do-not-break)

- **Routing & shell:** `router.tsx` paths and the single-`RootLayout`/`<Outlet>` structure
  are fixed. Restyle inside, not the tree.
- **State flow:** zustand stores (`stores/room.ts`, `settings.ts`, `spinHistory.ts`,
  `toast.ts`) shapes and the socket event wiring are fixed; components keep subscribing
  via the same selectors.
- **Telegram integration:** go through `lib/telegram.ts` + `lib/haptics.ts` only; keep
  BackButton/closing-confirmation/theme wiring; keep `--tg-*` bridge.
- **Mobile-native rules (spec §3 / `CLAUDE.md` rule 4):** no hover states, ≥44×44 tap
  targets, sheets-not-modals, body ≥14 / primary ≥16 px, safe-area insets. The redesign
  must uphold these.
- **i18n:** every visible string already flows through `t()`; the redesign must not
  hardcode copy (CLAUDE.md). `/dev/ds` is the only exempt surface.
- **Brand locale rule:** `Hoba!` (EN/Latin) vs `Хоба!` (UK) via `HobaWord`/`brand` ns —
  keep locale-aware.
- **Perf:** fold in PERF_AUDIT fixes while restyling (scope the aurora, rasterize the
  wheel face, low-power confetti, replace box-shadow pulse) rather than re-introducing them.

---

## 8. Suggested sequencing (summary)

```
Phase 0  Tokens + global CSS + /dev/ds sandbox        (whole-app reskin lever)
Phase 1  DS primitives                                 (inherited everywhere)
Phase 2  Static + simple screens                       (credits→legal→settings→library→trending→admin)
Phase 3  Home                                          (first impression)
Phase 4  Solo spin + Wheel face + result              (split WheelFace; coordinate perf)
Phase 5  Room (after RoomPage decomposition)          (highest risk, last)
```

*Map and plan only — no source files were modified and no new design was generated.*
