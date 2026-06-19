# Hoba! — Performance & Thermal Audit

> **Scope:** why phones heat up and the app feels slow on the *current* logic.
> **Method:** static read of `apps/webapp/src` + the deployed bundle. **No code was changed.**
> **Date:** 2026-06-19. **Audited commit:** `51d4068` (deployed `index-tBWzYfxv.js`).

This is an audit, not a change. Every finding cites `file:line`, the mechanism
(why it heats or slows), a severity, and a concrete fix. Findings are ranked by
impact and split into **[CURRENT]** (already costing you in the live build) and a
**Redesign guardrails** section (mistakes the rebuild must not re-introduce, plus
the good patterns it must preserve).

Severity legend: **Critical** (dominant cost) · **High** · **Medium** · **Low**.

---

## TL;DR — the four things actually hurting you

1. **One 230 KB-gzip JS chunk loads the entire app before first paint** — no route
   code-splitting; all 12 pages + framer-motion + howler + socket.io + canvas-confetti
   + full ICU + both languages are in the first chunk. This is the "feels slow to open."
2. **A full-screen blurred, GPU-promoted gradient animates on *every* screen — including during the spin.** Its own source comment says it should be lobby/result only and that it "steals GPU from the spin." It's mounted app-wide.
3. **The spin rotates a complex live SVG for 5.5–8.5 seconds.** Vector groups don't
   reliably get a GPU layer on mobile Safari, so the whole tree re-rasterizes each
   frame for 5–8 s. This is the main *spin* heat.
4. **Background music streams and decodes continuously for the whole session, on every
   screen.** Steady CPU/radio/battery that compounds the heat over a session.

Nothing leaks a runaway `requestAnimationFrame`/particle loop after a spin — the spin's
rAF and confetti both self-terminate (good). The heat is from **persistent always-on
effects + an expensive 5–8 s SVG rotation + a fat startup chunk**, not from a leaked loop.

---

## Impact ranking (all findings)

| # | Area | Finding | Severity | Bucket |
|---|------|---------|----------|--------|
| S1 | Startup | No route code-splitting — whole app in one 230 KB-gzip chunk | **Critical** | CURRENT |
| R1 | Runtime | Aurora blur layer animates app-wide, incl. during the spin | **High** | CURRENT |
| R2 | Runtime | 5.5–8.5 s rotation of a complex live SVG | **High** | CURRENT |
| S2 | Startup | Dev-only `DevDSPage` shipped in the prod chunk | **High** | CURRENT |
| S3 | Startup | Both locales + all namespaces + full ICU eager, sync init before paint | **Medium–High** | CURRENT |
| R4 | Runtime | Background music streams/decodes the entire session, every screen | **Medium** | CURRENT |
| R5 | Runtime | Canvas confetti fires every reveal, stacked over aurora + wheel | **Medium** | CURRENT |
| R3 | Runtime | Second hand-rolled rAF loop runs the full spin duration | **Medium** | CURRENT |
| R6 | Runtime | `code-pulse` animates `box-shadow` (paint) infinitely in-room | **Medium** | CURRENT |
| R7 | Runtime | Nothing pauses on `document.hidden` (presence ping + music keep going) | **Low–Medium** | CURRENT |
| S4 | Startup | Three font families × many weights bundled | **Low–Medium** | CURRENT |
| R8 | Runtime | Perpetual cheap CSS loops (spinner-breath, live-pulse) | **Low** | CURRENT |
| R9 | Runtime | 28 px `drop-shadow` filter at each reveal | **Low** | CURRENT |
| R10 | Runtime | 1521-line RoomPage recomputes derived state each event-render | **Low** | CURRENT |

---

## STARTUP findings

### S1 — No code-splitting: the whole app is one chunk *(Critical, CURRENT)*

- **Where:** `src/router.tsx:4-14` (all 12 pages statically imported), `vite.config.ts:33-34` (no `build.rollupOptions.output.manualChunks`).
- **Evidence:** deployed `assets/index-tBWzYfxv.js` = **724.6 KB raw / ~230 KB gzip**, single file. The build log itself warns: *"Some chunks are larger than 500 kB after minification."*
- **Why it slows:** Telegram's in-app WebView must download, parse, and execute ~230 KB of gzipped JS *before first paint*. Opening the Home screen pulls in `RoomPage` (1521 lines), the socket layer, `framer-motion`, `howler`, `canvas-confetti`, `intl-messageformat`, and every other page — none of which Home needs. On a mid/low-end phone the parse+exec alone is hundreds of ms of main-thread block. This is the dominant "feels slow to launch."
- **Fix:** `React.lazy(() => import(...))` per route + a `<Suspense>` fallback in `RootLayout`. Add `manualChunks` to split `framer-motion`, `howler`, `socket.io-client`, `canvas-confetti` into async chunks loaded only on the screens that use them (Home needs none of howler/socket/confetti). Target: Home interactive on a <50 KB-gzip entry.

### S2 — The design-system showcase ships to real users *(High, CURRENT)*

- **Where:** `src/router.tsx:7` & `:31` import and route `DevDSPage`; `src/pages/DevDSPage.tsx` (403 lines, pulls `fireConfetti`, many DS components).
- **Why it slows:** `/dev/ds` is a developer-only fixture page (CLAUDE.md even exempts it from i18n). Because it's a static import in the eager router, its code is in the **production first chunk** that every real user downloads.
- **Fix:** lazy-load it and gate the route behind `import.meta.env.DEV`, or drop it from the prod build entirely. Pure dead weight removed from the hot path.

### S3 — i18n: both languages, all namespaces, full ICU, synchronous before paint *(Medium–High, CURRENT)*

- **Where:** `src/i18n/index.ts:14-33` (20 JSON imports — EN+UK × 10 namespaces), `:51-87` (`i18n.init` at module top), `src/main.tsx:5` (`import "@/i18n"` runs that init synchronously before `createRoot`). Deps: `i18next-icu` + `intl-messageformat` (a full ICU MessageFormat parser) in `package.json`.
- **Why it slows:** a session is one language, yet both locales' strings are bundled and parsed at boot, and `intl-messageformat` is a heavy library for what is mostly simple interpolation/plurals. `i18n.init(...)` runs synchronously on the main thread before React mounts.
- **Fix:** load only the detected locale's resources; lazy-import the other only on locale switch. Split namespaces per route (Home doesn't need `room`/`admin`/`legal`/`credits`). Evaluate whether the ICU features used justify `intl-messageformat`, or lazy-load it.

### S4 — Three font families, many weights, all bundled *(Low–Medium, CURRENT)*

- **Where:** `package.json` → `@fontsource/inter`, `@fontsource/manrope`, `@fontsource/jetbrains-mono`. The webapp build emits Inter 400/500/600/700 (woff2 **and** woff), JetBrains Mono 500/700, plus Manrope.
- **Why it slows:** extra network + decode at first paint; multiple weights per family when the UI uses few. JetBrains Mono is only the `font-mono` "live" pill.
- **Fix:** subset to the weights actually rendered; ship woff2 only (drop woff); `font-display: swap`; preload just the one critical display weight.

### S5 — Telegram init order is fine; StrictMode is **not** a prod cost *(info, no action)*

- `src/main.tsx:16-23` calls `ready()` → `expand()` → `audio.installUnlock()` synchronously before render, wrapped in try/catch. These are cheap (SDK signal + `expand` + binding passive listeners); they do not block paint meaningfully. **Leave as-is.**
- `src/main.tsx:31` `<StrictMode>` double-invokes effects/renders **in development only** — it is a no-op in the production build. Do **not** attribute runtime heat to it.

---

## RUNTIME HEAT findings

### R1 — The aurora blur layer animates on every screen, including during the spin *(High, CURRENT)*

- **Where:** `src/components/layout/RootLayout.tsx:75` mounts `<AuroraBackground />` as a sibling of every route's `<Outlet />`. The element: `src/components/ds/AuroraBackground.tsx:34-40` — `absolute -inset-[16%]` (≈132% of viewport), `blur-2xl` (~40 px), `transform-gpu will-change-transform`, `motion-safe:animate-aurora-drift`. Keyframe: `tailwind.config` `aurora-drift` = `30s ease-in-out infinite` (translate3d + rotate).
- **Self-contradiction:** the component's own doc comment (`AuroraBackground.tsx:11`) says *"Per spec §1 it goes behind the lobby + result screens, not anywhere else,"* and the perf comment (`:27-33`) explains `will-change` exists so the blur doesn't "steal GPU from the spin … the 'hangs at moments' jank." Yet it is mounted **everywhere, including SpinPage and RoomPage during the spin.**
- **Why it heats:** `will-change: transform` **permanently** promotes a larger-than-viewport blurred layer to its own compositor surface → constant GPU memory held for the whole session, and the 30 s drift keeps the compositor working continuously on every screen. During a spin it composits **alongside** the rotating wheel — exactly the contention the code warns about. MDN guidance is to *not* leave `will-change` on indefinitely; here it never comes off.
- **Fix:** mount the aurora **only on lobby + result** (as the spec/comment intend); unmount it during the spin. Remove `will-change` when the element is not actively animating (toggle it on only for the brief windows it drifts). Consider a static gradient (no blur, no animation) as the default and the animated one as a `prefers-reduced-motion: no-preference` + not-low-power upgrade.

### R2 — The spin rotates a complex live SVG for 5.5–8.5 s *(High, CURRENT)*

- **Where:** `src/features/wheel/Wheel.tsx:370-409` — a `<motion.g style={{ rotate }}>` whose children are: a white disc, **N × `SegmentVisual`** (each = an arc `<path>` + an emoji `<text>` + a label `<text>` with up to two `<tspan>` lines drawn with `paintOrder: stroke` + a 2 px stroke, `Wheel.tsx:80-145`), and an inner `radialGradient` overlay. Duration: `spinMath.ts:15-16` `MIN_DURATION_MS = 5_500 … MAX_DURATION_MS = 8_500`.
- **Why it heats:** transforming an **SVG group** is not reliably promoted to a GPU layer on mobile Safari (unlike an HTML element). The browser re-rasterizes the whole vector subtree — arcs, gradients, and stroked text — on **every frame for 5–8 seconds**. Stroked/`paintOrder` text is especially paint-heavy. The long, randomized duration maximizes the time spent re-rasterizing. This is the core per-spin GPU/CPU burn.
- **Mitigation already present (good, keep):** the outer glow is **three stacked strokes instead of an SVG filter** (`Wheel.tsx:336-368`) precisely because iOS rasterizes SVG filters on the CPU each frame. The author understands the failure mode — but the rotating face itself is still a live vector repaint.
- **Fix:** rasterize the wheel face **once** to a bitmap (render the static `<svg>` to an offscreen `<canvas>` / `OffscreenCanvas`, or snapshot to an `<image>`/CSS background on an HTML element) and rotate that **single composited layer** via `transform: rotate` with `will-change` only for the spin's duration. Then the 5–8 s animation is one cheap composite. Secondary: cap/clamp the max spin duration; precompute per-segment geometry; avoid stroked text on the rotating layer.

### R3 — A second hand-rolled rAF loop runs the entire spin *(Medium, CURRENT)*

- **Where:** `src/features/wheel/Wheel.tsx:273-294` — a `tick()` `requestAnimationFrame` loop (scheduled at `:277`, `:291`, `:294`) that runs from spin start to `endMs`, calling `rotation.get()` + `segmentUnderPointer(...)` each frame to detect sector crossings for the tick sound/haptic. It runs **in addition to** framer-motion's own internal rAF that drives `rotation`.
- **Why it heats:** two per-frame JS loops during the (already expensive) 5–8 s spin. The work is light per frame, but it's redundant main-thread wakeups stacked on the render. (Tick audio itself is correctly throttled to 12/s via `TICK_MIN_INTERVAL_MS`, `Wheel.tsx:23`.)
- **Not a leak:** cleanup is correct — `tickWatchActive.current = false` + `controls.stop()` on unmount/dep-change (`Wheel.tsx:296-299`), and the loop self-stops at `endMs`. So nothing keeps spinning afterward.
- **Fix:** drop the separate rAF; subscribe once via `rotation.on("change", …)` (fires per frame from the same animation, no second loop), or compute tick timestamps analytically from the easing curve and schedule them. Restrict work to the decelerate window only.

### R4 — Background music streams & decodes for the whole session, on every screen *(Medium, CURRENT)*

- **Where:** `src/components/layout/RootLayout.tsx:69-71` calls `audio.requestMusic()` once at boot, app-wide. Tracks are 1.0–3.9 MB MP3s (`src/audio/manifest.ts:53-60`); playback is `html5: true` streaming, chained forever via `onend → playTrack(next)` (`src/audio/index.ts:169-201`).
- **Why it heats:** continuous audio **decode + network streaming for the entire time the app is open**, on Home, Library, Settings — every screen, not just gameplay. Steady CPU + radio wake + battery that compounds with the visual effects. (Memory is handled well — only one track is loaded at a time and the previous Howl is `unload()`-ed, `:171-174`.)
- **Fix:** scope music to the screens where it adds value (lobby / active room) rather than globally; or default it off and make it an opt-in. Pause on `document.hidden` (see R7). The host-only gate (`setMusicAllowed`, `:127`) already proves per-context gating is feasible — extend it to "not while sitting on a static utility screen."

### R5 — Confetti fires every reveal, stacked over the aurora + wheel *(Medium, CURRENT)*

- **Where:** `canvas-confetti` via `src/components/ds/ConfettiBurst.tsx:18-28` (80 particles, `ticks: 220` ≈ 3.6 s, full-screen canvas). Fired at `SpinPage.tsx:104` (every reveal) and `RoomPage.tsx:394` (per-spin), `:424` (`celebrateWinner`), `:460` (rigged reveal). `celebrateWinner` (`RoomPage.tsx:420-425`) also plays **two** sounds + confetti at once.
- **Why it heats:** a full-screen 2D-canvas particle simulation runs its own rAF for ~3.6 s **on top of** the still-animating aurora (R1) and the just-finished/settling wheel — a simultaneous GPU+CPU spike at the single hottest UX moment, repeated every single spin.
- **Not a leak:** canvas-confetti self-terminates when particles expire. The issue is the *stacking* and the per-spin frequency.
- **Fix:** ensure the aurora is unmounted/paused during reveal (R1 fixes this); reduce `particleCount`/`ticks` on low-power devices; skip confetti under `prefers-reduced-motion` / low battery; reserve it for *wins*, not every spin reveal.

### R6 — `code-pulse` animates `box-shadow` (a paint op) infinitely in-room *(Medium, CURRENT)*

- **Where:** `tailwind.config` keyframe `code-pulse` animates `boxShadow` `0 0 0 0 → 0 0 0 10px` over `2.4s … infinite`; applied at `src/components/ds/RoomCodePill.tsx:48` (`animate-code-pulse`), visible the whole time you're in a room lobby.
- **Why it heats:** `box-shadow` cannot be GPU-composited — animating it forces a **repaint of the pill's region every frame, forever**. Unlike transform/opacity loops, this one actually paints.
- **Fix:** replace with a pseudo-element ring animated via `transform: scale` + `opacity` (compositor-only), or make the pulse a brief one-shot on mount/copy instead of infinite.

### R7 — Nothing pauses when the view is hidden *(Low–Medium, CURRENT)*

- **Where:** the only `visibilitychange` handler is `src/audio/index.ts:63-65`, and it only **revives** audio when visible — it never pauses anything on hidden. Genuine background work that keeps running: the presence ping `setInterval(…, 20_000)` (`src/stores/room.ts:474-482`, started at `RoomPage.tsx:132`) and the background music stream (R4).
- **Nuance (avoid over-claiming):** the browser already throttles `requestAnimationFrame` and pauses CSS animations when the page is truly hidden, so the wheel rAF / aurora / CSS loops largely self-suspend when backgrounded. The real residual cost is the **20 s socket ping** (keeps the radio/CPU waking) and **continuous music**. Telegram "collapsed but not closed" may also keep the view non-hidden, in which case *everything* keeps running.
- **Fix:** on `document.hidden`, pause the presence loop and music; resume on visible (the revive hook is the natural place). Lengthen or suspend the ping while hidden.

### R8 — Perpetual cheap CSS loops *(Low, CURRENT)*

- **Where:** `spinner-breath` on the idle hub (`Wheel.tsx:433`; `transform: scale` 2.2 s infinite) and `live-pulse` on the realtime dot (`RealtimeIndicator.tsx:26`; transform+opacity 1.8 s infinite).
- **Why it heats:** these are compositor-cheap (transform/opacity), but they never rest and several can run at once with the aurora; on weak GPUs every always-on layer adds baseline draw.
- **Fix:** acceptable to keep. `spinner-breath` already honors `motion-safe`; `live-pulse` does **not** — add `motion-safe`/reduced-motion gating, and consider pausing when offscreen.

### R9 — 28 px `drop-shadow` filter at every reveal *(Low, CURRENT)*

- **Where:** `src/components/ds/HobaWord.tsx:45` — `drop-shadow-[0_8px_28px_rgba(255,184,77,0.7)]`, rendered at each result reveal and in `WinnerOverlay`.
- **Why it heats:** `drop-shadow` is a filter (paint), and it lands exactly when the wheel + confetti are also active. It's transient and the author already cut it from 60 px → 28 px (comment `:43-44`).
- **Fix:** acceptable; if reveal frames still drop, swap for a pre-baked glow (static PNG/box-shadow on a non-animated element) or drop under reduced-motion.

### R10 — RoomPage recomputes derived state on every event-render *(Low, CURRENT)*

- **Where:** `src/pages/RoomPage.tsx` (1521 lines) — e.g. `punishTakenByOther` Map rebuilt every render (`:232-239`), `segLabel` does `Array.find` per call (`:222-225`), many inline derivations. It re-renders the whole tree on each socket event because it selects the entire `snapshot` (`:105`), which is replaced wholesale by most handlers in `stores/room.ts`.
- **Why it's only Low:** this is **per-event**, not per-frame (the wheel animates via motion values, not React state — see "preserve" below), and N is small (party game). It is *not* a heat driver today.
- **Fix (for the rebuild):** memoize derived maps; split RoomPage into smaller subscribers so a participant join doesn't reconcile the entire spin/standings/settings tree; patch snapshot slices instead of replacing the whole object.

---

## Redesign guardrails

### Must NOT re-introduce
- **Eager-everything bundling.** Code-split by route from day one; keep `framer-motion`/`howler`/`socket.io`/`canvas-confetti` out of the entry chunk. (S1, S2)
- **Animating complex live SVG/DOM via transform without rasterization.** Anything that spins/moves for seconds must be a single pre-rasterized, layer-promoted bitmap, not a live vector tree. (R2)
- **`will-change` left on permanently**, or full-screen blur layers mounted globally. Promote only while animating; scope heavy backdrops to the screens that need them. (R1)
- **Animating `box-shadow`/`filter`/`background-position` on infinite loops.** Use transform/opacity for anything that repeats. (R6, R8)
- **Per-frame React state for animation.** Keep animation off the React render path. (preserved today — don't regress)
- **Effects that ignore `document.hidden`.** Every loop/timer/stream must pause when hidden. (R7)
- **Stacking simultaneous full-screen effects** (aurora + confetti + wheel + glow) at the reveal without a low-power/reduced-motion budget. (R1, R5, R9)
- **Unbounded effect queues.** Cap concurrent flying reactions/particles regardless of inbound event rate.
- **Loading both locales + full ICU eagerly.** One locale, lazy the rest. (S3)

### Already RIGHT — preserve these
- **Wheel animates via `useMotionValue` + imperative `transform`, not React state** — no per-frame re-render storm (`Wheel.tsx:201-300`).
- **Spin orchestration cancels cleanly** — `cancelled` flag + cleared timers (`RoomPage.tsx:304-403`); wheel rAF + framer controls stopped on teardown (`Wheel.tsx:296-299`).
- **Glow as stacked strokes, not an SVG filter** — deliberately avoids iOS CPU-rasterized filters (`Wheel.tsx:336-368`).
- **Howls created lazily on first play; music is `html5` streaming with previous track `unload()`-ed** — low boot cost, low memory (`audio/index.ts:85-101`, `:169-201`).
- **One Socket.IO connection, fully event-driven — no HTTP polling** (`stores/room.ts:160-168`).
- **`motion-safe` gating** already on the aurora and spinner-breath (extend to all loops).

---

## Suggested order of attack (impact ÷ effort)

1. **S1/S2** — route `React.lazy` + `manualChunks`, drop `DevDSPage` from prod. Biggest "feels slow" win, low risk, no behavior change.
2. **R1** — scope the aurora to lobby/result and unmount it during the spin. Biggest *idle + spin* heat win for a one-line mount change + conditional.
3. **R4/R7** — gate music to gameplay and pause presence+music on `document.hidden`. Big battery/steady-heat win.
4. **R2** — rasterize the wheel face and rotate a single bitmap layer. Biggest *per-spin* heat win; largest effort.
5. **R5/R6/R3** — low-power confetti budget, replace the `box-shadow` pulse, collapse the dual rAF.
6. **S3/S4** — single-locale i18n + font subsetting.

*Audit only — no source files were modified.*
