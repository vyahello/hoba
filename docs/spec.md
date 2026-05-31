# Hoba! — Telegram Mini App Build Spec for Claude Code
### v3.1 — locale-aware brand, BotFather pinned

> **Brand rendering (single source of truth):**
> - Default / Latin / global identity: **`Hoba!`**
> - Ukrainian locale (in-app only): **`Хоба!`**
> - Logo, bot Name in BotFather, domain, package names, file IDs: always Latin **`Hoba!`**
> - The exclamation mark is part of the brand in both renderings.

> A multiplayer realtime party game inside Telegram. The host creates a wheel of decisions/dares/options, invites friends via Telegram deep link, and the whole room watches a synchronized dramatic spin land on the answer.
>
> The brand IS the moment of revelation. **"Hoba!"** (in EN locale) / **"Хоба!"** (in UK locale) is the exclamation people shout when something unexpected lands — it's literally the sound of the wheel stopping. The whole product packages that single emotion.
>
> Closest spiritual cousins: **Jackbox Games**, **Discord Activities**, **Gartic Phone**. Not a productivity tool. Not a generic decision wheel. A party game that lives inside Telegram chats. The viral loop is: user shows it to friends → friends laugh → friends install → loop.

---

## How Claude Code must work this spec

1. Read this entire document before writing a single line of code.
2. Reply with: (a) confirmation, (b) ambiguities (max 10), (c) one-line Phase 1 scope proposal. Then STOP.
3. After my "go on phase N", execute that phase only.
4. Every phase ends with: tests green, file tree diff, manual-verify checklist, status block `PHASE N COMPLETE`.
5. Do not invent features outside this spec. If something is missing, ASK before adding.
6. **MVP target = Phases 1–6.** That's the first public release. Phases 7–12 are post-launch iterations driven by real user feedback. Do not pre-build phases 7+ infrastructure during MVP.
7. Do not declare anything done until §17 Definition of Done is fully checked.

---

## 0. Project identity

- **Brand name:**
  - Latin / default / EN locale: `Hoba!` (with exclamation — part of the brand)
  - Ukrainian locale (in-app only): `Хоба!` (with exclamation)
  - Single logo asset (Latin): `Hoba!` — used in app icon, splash, Telegram bot profile photo, social/marketing
- **Telegram bot identity (locked):**
  - Bot Name (in BotFather): `Hoba!` (Latin)
  - Bot username: `@hobagame_bot`
  - Bot-level descriptions, commands, About text: **EN base** (Telegram does not support per-user-locale bot commands robustly; UA users see localized strings inside the Mini App itself)
- **Internal identifiers (always Latin, never localized):**
  - Python package: `hoba_api`, `hoba_bot`
  - npm package: `hoba-webapp`
  - DB schema, env vars, file names, log fields, code identifiers
- **Domain:** TBD — to be purchased before Phase 12. Candidate: `hobagame.app` (Cloudflare at-cost, ~$10/yr; available as of this writing). Не блокер для MVP — Phases 1–11 нічого hardcoded не мають
- **Deploy target:** VPS (owner's existing infrastructure). Phase 12 acceptance updated to reference VPS IP / temporary subdomain until real domain is bought
- **Tagline EN:** «Spin. Hoba! — done.»
- **Tagline UK:** «Крути. Хоба! — і вирішено»
- **Brand voice:** Surprise-driven, playful, slightly cheeky. The friend who suggests the chaotic option. Never corporate. Never apologetic.
- **The "Hoba!" / "Хоба!" moment:** every spin reveal climaxes with the brand word appearing as a typographic moment — large, bouncy, brand-amber, slight rotation, locale-aware. This is the signature beat. Treat it as ritual, not decoration.

### Aesthetic anchors (study before designing anything)
- **Jackbox Games** — card animations, result reveals, "anyone can play" lobby
- **Discord Activities** — embedded multiplayer game feel inside chat
- **Duolingo** — result screens, dopamine moments, micro-celebrations
- **Linear app** — micro-interactions, motion quality, restraint inside polish
- **Spotify Wrapped** — typographic moments, bold gradients, dramatic transitions

---

## 1. Visual language (committed, not negotiable)

Telegram light/dark is the **substrate** (background + base text). The **game surface** (wheel, lobby, result, host controls) has its own assertive brand layer that does NOT just dissolve into Telegram chrome. Telegram is the picture frame, Hoba! is the painting.

### Color tokens (CSS variables — do not improvise hexes)
```
--brand-primary:        #7C5CFF   /* electric purple */
--brand-primary-strong: #5B3DF5
--brand-accent:         #FFB84D   /* warm amber — spin button, brand word */
--brand-accent-strong:  #FF9F1C
--brand-pink:           #FF5C9C   /* secondary, reactions, chaos mode */
--brand-cyan:           #5CE5FF   /* tertiary, elimination mode */
--brand-rigged:         #FF3B6B   /* exclusive to Rigged Mode UI */

--state-success: #22C55E
--state-warning: #F59E0B
--state-danger:  #EF4444

--surface-light:   #FFFFFF
--surface-light-2: #F4F2FB
--bg-light:        #FBFAFF

--surface-dark:   #1A1530
--surface-dark-2: #241D3F
--bg-dark:        #0E0B1A

--text-light-1: #0E0B1A
--text-light-2: #4A4560
--text-dark-1:  #FFFFFF
--text-dark-2:  #B8B2D6
```

### Wheel palette (12 deterministic colors, cycled by `color_seed`)
```
#7C5CFF, #FFB84D, #FF5C9C, #5CE5FF, #22C55E, #F472B6,
#3B82F6, #F59E0B, #8B5CF6, #10B981, #EF4444, #06B6D4
```

### Motion tokens
```
--ease-spring:   cubic-bezier(0.34, 1.56, 0.64, 1)
--ease-wheel:    cubic-bezier(0.15, 0.85, 0.25, 1)   /* spin deceleration */
--ease-pop:      cubic-bezier(0.68, -0.55, 0.27, 1.55)
--dur-fast:      150ms
--dur-medium:    250ms
--dur-slow:      450ms
--dur-spin-min:  5500ms
--dur-spin-max:  8500ms
--dur-hoba:      900ms   /* the "Hoba!"/"Хоба!" word entrance — must feel like a punctuation mark */
```

### Radii / shadows / type
```
--radius-sm: 10px
--radius-md: 16px
--radius-lg: 24px
--radius-xl: 32px
--radius-pill: 999px

--shadow-card:  0 6px 24px -8px rgba(124, 92, 255, 0.22)
--shadow-spin:  0 16px 48px -8px rgba(124, 92, 255, 0.55)
--shadow-glow:  0 0 32px rgba(255, 184, 77, 0.55)
--shadow-hoba:  0 12px 60px -8px rgba(255, 184, 77, 0.75)

font-family-ui:      "Inter", system-ui, sans-serif
font-family-display: "Manrope", "Inter", sans-serif      /* brand word, result moments */
font-family-mono:    "JetBrains Mono", monospace         /* room codes */
```
All fonts must include cyrillic subsets.

### Surface treatments
- **Glass:** `backdrop-blur(20px) + 70% alpha`, used sparingly: lobby header, sheet headers only
- **Aurora gradient:** animated 3-stop radial that drifts (~30s loop), backdrop in lobby + result screens. CSS or low-cost canvas, never video
- **Confetti:** physics-based, ~80 particles, 4 brand colors, only on spin reveal — never decorative
- **"Hoba!" / "Хоба!" word:** Manrope ExtraBold, brand-accent fill, 96px on mobile, drops in with `--ease-pop`, slight 4° rotation, glows with `--shadow-hoba`. Rendered text reads from the active locale (`t('brand.exclamation')` returns `Hoba!` or `Хоба!`).

---

## 2. Tech stack (locked — justified)

### Backend: Python
Owner is a senior Python/SDET engineer. FastAPI + asyncio + python-socketio comfortably handles thousands of concurrent rooms. No reason to switch ecosystems.

- Python 3.12
- FastAPI 0.115+
- aiogram 3.13+
- python-socketio 5.x (ASGI mode, mounted into FastAPI)
- SQLAlchemy 2.0 async + asyncpg/aiosqlite
- Alembic
- Pydantic v2
- Redis 7 (ephemeral state, presence, rate limit)
- structlog
- pytest + pytest-asyncio + httpx + Faker
- `uv` for deps

### Persistence strategy
**Default: SQLite via `aiosqlite`.** Zero ops, file-based, perfect for MVP.
**Production-ready:** `DATABASE_URL` env var. Swap to Postgres = change one URL + run migrations. SQLAlchemy makes this a one-liner.
Redis is required from day 1 (ephemeral game state, rate limits).

### Frontend
- React 18 + Vite 5 + TypeScript 5 (strict)
- Tailwind CSS 3.4 + token layer
- Framer Motion 11
- Zustand 4
- @twa-dev/sdk
- socket.io-client 4
- react-i18next + i18next-icu
- React Router 6
- canvas-confetti (or custom)
- `zod` for socket payload validation
- `howler.js` for audio

### Infra
- Docker + docker-compose (dev + prod profiles)
- Caddy reverse proxy with auto-TLS
- SQLite file (or Postgres in prod) + Redis 7
- GitHub Actions CI
- Sentry (backend + frontend)

### Quality gates (non-negotiable from Phase 2)
- `ruff check` + `mypy --strict` green
- `eslint` + `tsc --noEmit` green
- Backend service-layer coverage ≥ 80%
- No `any` in TS, no `Any` in Python without `# justified:` comment
- Lighthouse mobile: Performance ≥ 90, Accessibility ≥ 95

---

## 3. Mobile-native guardrails (read before drawing a single screen)

This is a Telegram Mini App, not a website. Failing mode = "this looks like a webpage Telegram opened." Success mode = "this feels like a native mobile game inside Telegram."

**Hard rules:**
- **Min tap target: 44×44 px.** No exceptions. Tiny chevrons and icon-only buttons must have invisible padding to hit this.
- **No hover states ever.** Use `:active`, `aria-pressed`, focus rings. Hover doesn't exist on touch.
- **Body text ≥ 14px, primary text ≥ 16px.** No tiny labels. Telegram renders on small phones.
- **Fullscreen vibe.** Always `WebApp.expand()` on mount. Content fills viewport. No outer padding on the page level — components own their padding.
- **Sheets, not modals.** Anything that opens — bottom sheet with drag-to-dismiss. Centered modals only for destructive confirmations.
- **Swipe-driven navigation** where possible: horizontal carousels swipe, sheets swipe down to dismiss.
- **No scrolling chrome.** Headers stay sticky and tactile. Content scrolls under blurred glass headers.
- **Tactile feedback everywhere.** Every primary action fires `HapticFeedback.impactOccurred()`. Selection chips fire `selectionChanged()`. Errors fire `notificationOccurred('error')`.
- **Buttons that look like buttons.** Big, with shadow, with press-state scale-down (`active:scale-95`). Never flat link-style for primary actions.
- **Loading states are skeletons, never spinners** (except inside buttons during async actions).
- **Text never wraps awkwardly at 360px width.** Audit every screen at iPhone SE width before declaring done.

**If a screen feels like it could exist on a desktop website, it's wrong. Rebuild it.**

---

## 4. Domain model

### Entities

**User**
- `id`, `tg_id` (unique), `tg_username`, `first_name`, `last_name`, `photo_url`
- `language_code` ('uk' | 'en'), `sound_enabled`, `haptics_enabled`
- `is_anonymous_default` (bool)
- `created_at`, `last_active_at`

**Room**
- `id`, `code` (6 uppercase alnum, e.g. `K7M9X2`)
- `host_id`, `title` (nullable, ≤ 80 chars)
- `status` ('lobby' | 'active' | 'closed')
- `game_mode` ('classic' | 'elimination' | 'punishment' | 'chaos' | 'rigged')
- `spin_policy` ('host_only' | 'anyone' | 'turn_based')
- `suggestion_policy` ('off' | 'approval' | 'free')
- `is_locked`, `is_anonymous`
- `created_at`, `closed_at`

**Wheel** (saved reusable wheel, separate from Room)
- `id`, `owner_id`, `title`, `question_text`
- `is_public`, `is_approved`
- `category` ('food' | 'truth_dare' | 'decision' | 'punishment' | 'random' | 'custom')
- `use_count`, `like_count`
- `created_at`

**Segment**
- `id`, `parent_id` + `parent_type` ('wheel' | 'question')
- `label` (≤ 60), `emoji` (nullable, single emoji)
- `color_seed` (0–11), `weight` (default 1), `position`

**Question** (active in-room wheel state)
- `id`, `room_id`, `source_wheel_id` (nullable)
- `text`, `is_active` (exactly one true per room)
- `created_by`, `approved`

**Spin**
- `id`, `question_id`, `triggered_by`
- `result_segment_id`, `final_angle_deg`, `duration_ms`, `seed`
- `mode_state_snapshot` (JSON)
- `started_at`, `settled_at`

**Participant**
- `room_id` + `user_id` PK
- `role` ('host' | 'guest'), `display_name`, `joined_at`, `last_seen_at`, `kicked_at`

**Reaction** — Redis-only, ephemeral: `{room_id, user_id, emoji, at}`

### Constraints
- 2–12 segments per wheel/question
- Room code unique among active; recycle after 7 days idle
- One active question per room
- Spin requires active question with ≥ 2 living segments
- Max 50 participants per room

---

## 5. Game modes

Each mode lives in `apps/api/src/hoba_api/modes/` behind a `GameModeEngine` interface:

```python
class GameModeEngine(Protocol):
    mode_id: Literal['classic', 'elimination', 'punishment', 'chaos', 'rigged']
    def on_spin_request(self, ctx: SpinContext) -> SpinDecision: ...
    def on_spin_settled(self, ctx: SpinContext, result: Segment) -> ModeEffects: ...
    def get_visible_segments(self, ctx: SpinContext) -> list[Segment]: ...
    def is_round_over(self, ctx: SpinContext) -> bool: ...
```

### 5.1 Classic
Standard wheel, equal probability. Spin → reveal → reactions → spin again.

### 5.2 Elimination
Winning segment **shatters** off the wheel after each spin. Continue until one survivor remains. UI: eliminated segments fade to greyscale in history. When 2 remain, extra-dramatic slowdown.

### 5.3 Punishment
After spin, a **punishment card** is dealt. Bundled localized decks: `mild`, `spicy`, `chaos` (host picks at room creation). 3 categories × 30 cards × 2 languages. Cards drawn without replacement. "Done" tally aggregates room-wide.

### 5.4 Chaos
Random unexpected events fire (25% chance per spin):
- **Reverse wheel** — direction inverts mid-spin
- **Double spin** — wheel spins twice, both count
- **Phantom segment** — temporary 13th segment with random label ("Free roll", "Skip")
- **Speed run** — 2x fast
- **Slow burn** — 1.5x slow, extra dramatic settle
- **Segment swap** — two random segments swap positions pre-spin
- **Jackpot** — winner gets "JACKPOT!" overlay + extra confetti

Each event has 1.5s pre-roll announcement card. Document probabilities in `docs/game-modes.md`.

### 5.5 Rigged Mode 🎭 (the legendary feature)

**The pitch:** host secretly weights segments. Guests have NO indication anything is rigged. Wheel looks and feels identical to Classic Mode from the guest perspective. Only the host sees the bias slider — accessible via a hidden gesture (long-press on hub for 1.5s) → opens a sheet showing each segment with a 0–100% weight slider. Default weights are equal; host adjusts. Total normalized server-side.

**Why this matters:** this is the feature friends talk about. "Did you rig it??!" → reveal moment → table flips → screaming → laughter. Viral by design.

**Implementation rules:**
- Mode label visible to host: "Rigged 🎭". Mode label visible to guests: "Classic" (deliberate misrepresentation — host chooses to enable this)
- Wheel deceleration curve identical to Classic — no detectable difference
- Weights stored server-side only, never sent to non-host clients
- Spin result computed server-side using weighted random
- "Reveal rigging" host action — host can voluntarily expose the rig as a finale: animated bar chart appears showing actual weights, room reacts (this is the catharsis moment)
- Optional: track "rigged spin count" per room as a fun stat post-reveal
- Ethical guard: room title gets a small 🎭 emoji injected ONLY when host reveals rigging (transparency post-fact)

This is the most playtest-driven feature in the spec. Build it with extra care; iterate based on real party-test feedback.

**Mode selection at room creation. Host can change mode between spins (with confirmation). Switching INTO Rigged Mode requires explicit "I understand my guests won't be told" toggle.**

---

## 6. Telegram integration

**Bot identity:** `@hobagame_bot` (Name: `Hoba!` in BotFather).

**Bot-level localization policy:** all bot-level texts (commands, About, Description) are **EN base**. Telegram does not robustly support per-user-locale bot commands. Localized strings appear inside the Mini App via the i18n system (§13).

### Bot commands (EN base, configured via `/setcommands`)
- `/start` — Launch Hoba! (parses deep-link `room_<CODE>` automatically)
- `/new` — Create a new wheel (opens Mini App)
- `/help` — Help
- `/lang` — Change language (UI inside Mini App)
- `/about` — About Hoba!

### Bot About / Description (configured via `/setabouttext` and `/setdescription`)
About (≤ 120 chars):
> `Spin the wheel with friends. Hoba! — and you're done. 🎯`

Description (≤ 512 chars):
> `🎯 Multiplayer decision wheel for Telegram.\nBuild a wheel, invite friends, spin together in real time.\nHoba! — and it's decided.\n\n5 modes: Classic, Elimination, Punishment, Chaos, and the secret Rigged 🎭.`

### Entry points
- Menu button via Bot API (Web App URL set after Phase 4)
- Deep link `t.me/hobagame_bot?startapp=room_<CODE>`
- Inline mode: `@hobagame_bot yesno` → one-tap Yes/No wheel
- Inline mode: `@hobagame_bot wheel <wheel_id>` → share saved wheel

### Telegram WebApp APIs (use all appropriately)
- `WebApp.ready()`, `expand()`
- `enableClosingConfirmation()` only while in active room
- `BackButton` → React Router
- `MainButton` — context-driven (Create / Spin / Share / Save)
- `HapticFeedback`:
  - `impactOccurred('light')` — segment crossover during deceleration
  - `impactOccurred('heavy')` — final spin stop
  - `notificationOccurred('success')` — result reveal + brand word
  - `selectionChanged()` — chip taps
- `themeParams` → CSS vars
- `CloudStorage` — prefs, last template, saved wheel IDs
- `shareToStory` — result card as story
- `switchInlineQuery` — invite
- `showPopup` / `showAlert` — destructive confirmations

### initData validation (CRITICAL — non-negotiable)
- HMAC validate against bot token on every authenticated request
- Reject `auth_date` older than 24h (replay protection)
- Cache `tg_id → user_id` in Redis 15 min
- WS validates initData on connect + reconnect
- Without this, any browser client can fake spins → cheating

---

## 7. WebSocket protocol (Socket.IO)

Namespace: `/rooms`. Auth on connect via initData query param.

### Client → Server
- `room:join` `{code}` → ack with snapshot
- `room:leave`
- `room:update` `{title?, spin_policy?, suggestion_policy?, is_locked?, game_mode?}` (host)
- `room:kick` `{user_id}` (host)
- `room:close` (host)
- `question:create` `{text, segments: [{label, emoji?}]}` (per policy)
- `question:activate` `{question_id}` (host)
- `question:suggest` `{text, segments}` (guest)
- `question:approve` / `question:reject` `{question_id}` (host)
- `wheel:save_active` `{title, is_public}` (host)
- `rigged:set_weights` `{question_id, weights: {segment_id: int}}` (host, Rigged Mode only)
- `rigged:reveal` (host — exposes rigging to room)
- `spin:trigger` `{question_id}`
- `reaction:send` `{emoji}` (rate-limited 10/30s/user)
- `presence:ping` (every 20s)

### Server → Client
- `room:state` — full snapshot on join + after structural changes
- `room:participant_joined` `{user}`
- `room:participant_left` `{user_id}`
- `room:participant_kicked` `{user_id, by}`
- `room:closed` `{by, reason}`
- `room:updated` `{patch}`
- `question:created`, `question:activated`, `question:suggested` (host), `question:approved/rejected`
- `spin:announced` `{spin_id, triggered_by, countdown_ms}` (300ms tension)
- `spin:started` `{spin_id, question_id, final_angle_deg, duration_ms, seed, started_at_server, mode_effects}`
- `spin:settled` `{spin_id, result_segment_id, mode_aftereffects}`
- `mode:event` `{event_type, payload}` (Chaos)
- `rigged:revealed` `{weights}` (broadcast when host reveals — never before)
- `reaction:received` `{emoji, user_id, at}`
- `error` `{code, message_key}`

### Synchronization
Server-authoritative. Server computes `final_angle_deg` via secure RNG (weighted for Rigged), persists spin, broadcasts `spin:started` with `started_at_server`. Clients align via ping. Deterministic given `seed + angle + duration`.

Full protocol in `docs/ws-protocol.md`.

---

## 8. REST API

All routes require `X-Telegram-Init-Data` header.

```
POST   /api/v1/rooms                    create
GET    /api/v1/rooms/{code}
PATCH  /api/v1/rooms/{code}             (host)
POST   /api/v1/rooms/{code}/close       (host)
GET    /api/v1/rooms/{code}/spins       paginated history

GET    /api/v1/templates                built-in localized
POST   /api/v1/rooms/from-template

GET    /api/v1/wheels                   user's library
POST   /api/v1/wheels
PATCH  /api/v1/wheels/{id}
DELETE /api/v1/wheels/{id}
POST   /api/v1/wheels/{id}/like
POST   /api/v1/wheels/{id}/use          instantiate as room

GET    /api/v1/trending                 by category, paginated
GET    /api/v1/trending/search?q=

GET    /api/v1/me
PATCH  /api/v1/me
GET    /api/v1/me/stats

POST   /api/v1/moderation/report
```

OpenAPI auto-generated. TS types regenerated into `packages/shared-types`.

---

## 9. Design system

Build `<DS>` library in `apps/webapp/src/components/ds/`:

- `<Button variant size loading icon haptic />` — `primary | accent | secondary | ghost | destructive`, sizes `sm | md | lg | xl`, `haptic` fires correct Telegram haptic
- `<IconButton>` — aria-label required
- `<Card padding interactive glow />`
- `<Sheet snapPoints dismissable />` — drag-to-dismiss
- `<Modal>` — destructive confirmations only
- `<Input>`, `<Textarea>` — floating label, counter, error
- `<SegmentChip color label emoji editable onRemove onEdit />`
- `<Avatar size status />` with presence dot
- `<AvatarStack max />`
- `<EmptyState illustration title description action />`
- `<Toast />` — top-anchored, haptic-tied
- `<Skeleton />`
- `<ConfettiBurst trigger origin colors />`
- `<AuroraBackground />`
- `<RoomCodePill code />` — large mono, copy-on-tap, pulse
- `<RealtimeIndicator />` — breathing live dot
- `<ResultBanner segment triggeredBy modeEffects />` — post-spin hero
- `<HobaWord />` — the signature brand word typographic moment (renders `Hoba!` in EN, `Хоба!` in UK), used on every result reveal
- `<QuickWheelCard wheel onTap />` — home screen preset card, big, tactile

Showcase at `/dev/ds` route (dev-only). Document in `docs/design-system.md`.

---

## 10. The Wheel component

`apps/webapp/src/features/wheel/Wheel.tsx`. Treat as hero — disproportionate engineering love.

### Rendering
- Pure SVG, viewBox `0 0 400 400`, crisp at any size
- Segments: solid fill, subtle inner gradient, 1px white inner border, optional emoji at 70% radius
- Labels: tangential rotation, ellipsized at 12 chars (full label appears in reveal)
- Outer ring with subtle glow drop-shadow
- Top-anchored pointer with idle pulse
- Center hub: clickable spin button when eligible, breathes when idle, shows mode icon

### Spin animation
- Framer Motion imperative `animate(controls, { rotate: finalDeg })` with `--ease-wheel` curve, server-provided duration
- Three phases: launch (0–500ms snappy accel), cruise (~30% near-constant), decelerate (heavy easing)
- During decelerate only: compute segment crossings, fire light haptic + soft tick (throttled max 12/s)
- On settle: heavy haptic + success notification + 1.5s tension hold + confetti + brand word entrance (`<HobaWord />`, locale-aware) + result banner slides up

### Mode visual variations
- Classic: default
- Elimination: greyed-out eliminated segments, "Remaining: N" counter
- Punishment: skull/fire icon on hub
- Chaos: rainbow hub shift, event announcement card
- Rigged: **NO visual difference to guests** (intentional). Host sees a subtle 🎭 indicator in their own UI corner only

### Accessibility & perf
- `role="img"` + descriptive `aria-label`
- Result `aria-live="polite"`
- No re-renders during animation (Framer imperative)
- Mount cost ≤ 16ms on mid-range Android

---

## 11. Audio system

`apps/webapp/src/audio/`. Howler, sprite-based.

### Sounds (royalty-free, document licenses in `docs/audio-licenses.md`)
- `ui_tap` — soft tactile click
- `ui_swipe` — sheet open/close
- `wheel_tick` — sub-100ms, on decel crossings
- `wheel_launch` — whoosh on spin start
- `result_chime` — bright reveal chime
- `hoba_pop` — signature pop sync'd with the brand word entrance (same sound for both locales)
- `confetti_burst` — celebratory pop
- `chaos_event` — eerie/playful sting
- `join_ping` — soft join notification
- `rigged_reveal` — sting for the rigging reveal moment (distinct from others)

### Behavior
- Respects `sound_enabled` setting
- Master volume 0.6 default, settable
- Lazy-load sprite on first user interaction
- Never play on initial page load
- Suspend during Telegram transitional moments

---

## 12. UX flows

### F1. First open (host)
1. Bot `/start` → welcome + Mini App button
2. App opens → no prior activity → **3-screen onboarding** (cut from 4 — faster ship to fun):
   - "Будь-яке рішення — за 6 секунд" / "Any decision in 6 seconds"
   - "Запроси друзів — і крутіть разом" / "Invite friends, spin together"
   - "Хоба! — і вирішено" / "Hoba! — and you're done"
3. Onboarding done → **HOME = Quick Wheels grid (see F2)**

### F2. Home screen (the most important screen in the app)

This is the screen 80% of opens land on. It must say "tap me, I'm fun" not "configure me."

Layout (top to bottom):
- Sticky glass header: app logo `Hoba!` (Latin, single asset across locales) + settings gear
- Hero row: **"Швидко вирішити" / "Quick decide"** — 6 large pre-made wheel cards in a 2-column grid:
  - 🍕 Where to eat? / Що поїсти?
  - 💸 Who pays? / Хто платить?
  - 🎬 What to watch? / Що дивитись?
  - 😈 Truth or Dare / Правда чи дія
  - ✅ Yes or No / Так чи Ні
  - 🍻 Friday plans / Плани на п'ятницю
- Each card: gradient background using brand colors, big emoji, title, "Tap to spin" microcopy. Tap → instant single-player spin (no room needed). Quick gratification.
- Below grid: secondary row "Створити власне" / "Create custom" (smaller card) → opens editor
- Below that: "Мої" / "My wheels" — horizontal scroll of saved wheels (empty state if none, with friendly prompt)
- Below: "У тренді" / "Trending" — horizontal scroll of public wheels (post-MVP, hide section if empty)

**Critical principle:** new user must hit a spin within 10 seconds of first opening the app. Quick wheels make this real.

### F3. Solo spin (Quick wheel tap)
1. Tap quick wheel card → app navigates to wheel view with that wheel pre-loaded
2. Big SPIN button, breathing in idle
3. Tap → spin (single-player, instant — no room)
4. Result + brand word reveal (locale-aware) + confetti
5. CTA: "Покликати друзів" / "Invite friends" → converts solo spin into a room (preserves question)
6. Also: "Spin again", "Edit wheel", "Save to my wheels"

This solo-to-multiplayer conversion is critical for adoption — users feel the magic alone, then bring friends.

### F4. Create custom wheel
1. From home "Create custom" → editor
2. Question text field (with placeholder examples)
3. Segment editor: tap to add, `<SegmentChip>` with inline color and optional emoji picker
4. Mode picker (5 modes, with mini-descriptions and 🎭 lock indicator for Rigged)
5. Bottom CTA: "Створити кімнату" / "Create room" → room created → share sheet

### F5. Guest joins
1. Link `t.me/<bot>?startapp=room_K7M9X2`
2. Mini App auto-launches → skeleton "Joining…"
3. Host gets soft haptic + `join_ping` + avatar slides into stack
4. Guest sees wheel, mode badge (or fake "Classic" badge in Rigged), host name
5. Spin button shown/hidden per policy

### F6. The spin (the moment)
1. Eligible user taps SPIN (huge accent, breathing idle)
2. Button morphs → haptic press → `wheel_launch`
3. 300ms tension hold (announcement card if Chaos event)
4. Wheel: accelerate → cruise → decelerate (5.5–8.5s)
5. Tick + light haptics on decel crossings
6. Final stop → 1.5s suspense → **brand word slams in** (`<HobaWord />` — `Hoba!` or `Хоба!`) with `hoba_pop` + heavy haptic
7. Confetti burst + result banner slides up
8. Result shows: segment label (huge), emoji, who triggered
9. Reactions bar (😂🔥💀👍🎉) — taps fire real-time floating emoji across all clients
10. "Spin again" / "New question" / "Save wheel"

### F7. Reactions during spin (the social chaos)
- Reactions bar visible during entire room view, not just post-spin
- During spin, guests can spam-tap → emoji fly up across everyone's screens
- Long-press emoji = burst of 5 (rate-limited)
- Reactions float from random horizontal positions, rise + fade over 2s
- This is the "stadium crowd" energy — the thing that makes it feel alive

### F8. Guest suggests
1. Guest taps "+ Запропонувати" / "+ Suggest"
2. Sheet: question + segments editor
3. Submit → host sees badge "Suggestions (N)"
4. Host reviews → approve → activatable

### F9. Rigged Mode host flow (5.5)
1. Host creates room with Rigged Mode (must confirm awareness toggle)
2. Wheel editor → after adding segments, "Налаштувати ймовірності" / "Set probabilities" sheet
3. Sheet: each segment row with 0–100% slider, live sum bar at top (auto-normalized server-side)
4. Save → wheel ready to spin, no visible indication to guests
5. Spin behaves identically from guest perspective
6. Host has hub long-press (1.5s) to re-open sheet between spins
7. "Розкрити шахрайство" / "Reveal the rig" button in host menu → broadcasts animated bar chart to all clients showing actual weights

### F10. Library / saved wheels
- "My wheels" home section + dedicated `/library` route
- Grid: title, segment preview, use count
- Tap → "Use as room" or edit
- "Make public" toggle (post-MVP)

### F11. Settings
- Language (UK/EN)
- Sound + volume
- Haptics on/off
- Anonymous mode default
- Theme: follow Telegram / force light / force dark
- About + Privacy + Terms

### F12. Result share
- "Share result" → 1080×1920 PNG via Canvas → `shareToStory` with branded `Hoba!` backdrop (Latin logo on share card regardless of UI locale — share cards leave the app and need to be globally recognizable)

---

## 13. Internationalization

- UK + EN, both first-class. Default detection: explicit setting → Telegram `language_code` → `en`
- `react-i18next` + `i18next-icu`
- Namespaces: `common, onboarding, room, wheel, modes, templates, trending, settings, errors, punishments, rigged, brand`
- Zero hardcoded strings outside i18n
- Punishment decks written natively per language, not translated
- The brand name is **locale-aware**:
  - EN locale: renders as `Hoba!`
  - UK locale: renders as `Хоба!`
  - Both end with `!` — exclamation is part of the brand
  - Exposed via i18n key `brand.exclamation` (used by `<HobaWord />` and any inline brand mentions in copy)
- **Single Latin logo asset** (`Hoba!`) is used everywhere a brand appears outside the localized in-app context: app icon, splash screen, Telegram bot profile photo, OG images, App Store / Play Store listings, share cards, marketing
- The internal bundle has both versions baked in; runtime never has to "transliterate"
- CI: `pnpm i18n:check` fails build on missing keys
- `Intl` for dates/numbers/relative time

---

## 14. Safety, moderation, anti-abuse

- **Input sanitization:** strip zero-width chars, normalize unicode, length enforcement
- **Profanity filter:** UK + EN + transliterated Russian word list, applied to public-facing strings (room titles, public wheel titles/labels)
- **Rate limits (Redis):**
  - 30 spins/room/hour
  - 100 questions/room
  - 10 reactions/30s/user
  - 5 room creations/user/hour
  - 3 make-public/user/day
- **Public moderation queue (post-MVP):** wheels marked public start unapproved, auto-approve on profanity pass for MVP, manual queue UI later
- **Report flow:** 3+ reports auto-hides pending review
- **Replay protection:** `auth_date` check
- **Anonymous mode:** generated nicknames like "Spicy Falcon" / "Гострий Сокіл"
- **Kicked users:** `kicked_at` entry, re-join blocked with explicit error
- **Rigged Mode ethical guard:** room title gets 🎭 injected after host reveals rigging (transparency post-fact, not pre)

---

## 15. Phased delivery — MVP + Post-Launch split

> Each phase ends with tests green, file tree diff, manual verify, `PHASE N COMPLETE`. Do not advance without my "go".

### ====================
### MVP (Phases 1–6) — ship this, validate, then iterate
### ====================

### Phase 1 — Infra scaffolding (MVP)
Monorepo, docker-compose (api, bot, webapp, redis, sqlite-file-mount, caddy), env.example, pyproject for api/bot, package.json for webapp, README "run in 3 commands", CI stub.

**env.example must include:**
```
TELEGRAM_BOT_TOKEN=<from BotFather>
TELEGRAM_BOT_USERNAME=hobagame_bot
DATABASE_URL=sqlite+aiosqlite:///./data/hoba.db
REDIS_URL=redis://redis:6379/0
WEBAPP_URL=https://your.tunnel.url    # ngrok / cloudflared in dev
SECRET_KEY=<generate>
SENTRY_DSN=                            # optional in dev
LOG_LEVEL=INFO
```

**Acceptance:** `docker compose up` → webapp :5173, api docs :8000/docs, bot polling (replies to `/start` from real Telegram via ngrok), SQLite file persists across restarts, all green.

### Phase 2 — Backend foundation (MVP)
Models, Alembic initial migration, FastAPI app, structlog, initData validation, `Depends(get_current_user)`, pytest setup, `/api/v1/me` + `/me/stats` end-to-end with tests.
**Acceptance:** pytest green ≥ 80% on core/me, 401 on bad initData, 200 on valid.

### Phase 3 — Bot foundation (MVP)
aiogram bot, all commands per §6, deep-link parsing for `room_<CODE>`, menu button (Web App URL placeholder for now), User upsert on `/start`. Bot commands are EN-base per §6 policy. BotFather settings (About, Description, commands list) configured manually using strings from §6.

**Acceptance:** bot responds to all commands; deep link `t.me/hobagame_bot?startapp=room_TEST01` launches Mini App with start param `room_TEST01` visible in `initData`; About + Description visible on bot profile.

### Phase 4 — Mini App shell + Design System (MVP)
Vite/React/TS/Tailwind, full `<DS>` library, theme provider (Telegram themeParams), router, i18n UK/EN, Telegram SDK integration, `/dev/ds` showcase, **Home screen with Quick Wheels grid (F2)**, mobile-native guardrails enforced.
**Acceptance:** every DS component visible at `/dev/ds`; light + dark Telegram themes render cleanly; language switch updates UI instantly; BackButton works on every non-root route; Home shows 6 Quick Wheel cards; audit passes at 360px width.

### Phase 5 — The Wheel mechanic + Solo Mode (MVP)
`<Wheel>` SVG per §10, question editor with `<SegmentChip>`, local seeded spin animation, confetti, `<HobaWord>` reveal, haptics, sounds per §11, in-memory history. **Quick wheel cards from home work end-to-end as solo spins.** "Invite friends" CTA converts solo → room (placeholder until Phase 6).
**Acceptance:** tap a quick wheel from home → spin within 10 seconds of app open → brand word reveal (locale-aware) feels juicy; haptics + sounds + confetti fire; 20 spins feel weighty and satisfying on real phone.

### Phase 6 — Rooms & realtime multiplayer (MVP)
REST endpoints (rooms/questions/spins), Socket.IO `/rooms` namespace with full event spec from §7, server-authoritative spin generation, presence tracking, share sheet (copy link, switchInlineQuery), guest join flow (F5), spin/suggestion policies enforced server-side, **Reactions during spin (F7) live across all clients**.
**Acceptance:** two-device test — guest joins via link → host spins → both devices show identical animation within ±50ms → reactions fly across both screens during spin → guest spin button respects policy.

**🚢 MVP SHIP POINT.** After Phase 6: deploy, share with 10–20 real users, collect feedback for 1–2 weeks before starting Phase 7.

### ====================
### Post-Launch (Phases 7–12) — driven by validated demand
### ====================

### Phase 7 — Game modes (Classic + Elimination + Punishment + Chaos)
Implement `GameModeEngine` interface + the 4 non-Rigged modes. Mode picker at room creation, mode badge, mode-specific UI (elimination shatter, punishment card draw, chaos event announcement). Punishment decks: 3 categories × 30 cards × 2 languages.
**Acceptance:** all 4 modes playable end-to-end with proper visuals; documented in `docs/game-modes.md`.

### Phase 8 — Rigged Mode 🎭 (the legendary feature)
Implement per §5.5 in full. Weighted server-side RNG. Host weight-editor sheet. Hidden gesture (1.5s hub long-press). "Reveal the rig" host action with broadcast animation. Ethical guard (🎭 injection post-reveal).
**Acceptance:** playtest with real friends — they cannot detect rigging until host reveals; reveal moment lands with audible "yo wait what" energy; weights are accurate to within ±2% over 50 spins.

### Phase 9 — Library + Saved wheels + Templates expansion
Seed 8+ built-in templates per F2. Saved wheels CRUD + library UI. Template carousel on home. Save-from-active-room flow.
**Acceptance:** every flow from F10 end-to-end, both languages.

### Phase 10 — Public wheels + Trending + Moderation
Public wheel flow with auto-approve + profanity filter. Trending tab with categories, search, like, report. Moderation queue (admin endpoint sufficient for now).
**Acceptance:** make-public flow works, trending lists wheels correctly, report leads to auto-hide at 3 reports.

### Phase 11 — Host moderation toolkit + Polish pass
Kick, lock, anonymous mode, mode change mid-room, room close — all with confirmations. Anonymous nickname generator. Onboarding illustrations (custom SVG). Empty states everywhere. Aurora background. Result share-card PNG. `enableClosingConfirmation` in active room. Audit every screen at 360px.
**Acceptance:** walk every flow on real phone, screenshot each, zero jank, zero unstyled flashes, zero untranslated strings.

### Phase 12 — Hardening + Launch
All rate limits per §14. Profanity filter active. Input sanitization. Replay protection. Room cleanup cron. Sentry both ends. Frontend error boundary. Fuzz API — no 500s. Full README with GIF. Architecture/WS/modes/design docs. Privacy + Terms in both languages. Production docker-compose with Caddy auto-TLS (host names driven by `WEBAPP_HOST` and `API_HOST` env vars — no hardcoded domains in compose/Caddyfile). Deploy script for VPS (rsync or registry push). BotFather `@hobagame_bot` fully configured (commands per §6, About, Description, profile photo with Latin `Hoba!` logo, menu button pointing to the production webapp URL).
**Acceptance:** fresh VPS deploys in < 30 min following README. Production webapp reachable over HTTPS at whatever host env vars dictate. All BotFather settings done. Smoke checklist green.

---

## 16. Engineering guardrails (Claude — re-read every phase)

1. No premature abstraction — no plugin systems, event buses, "frameworks" without ≥ 3 in-codebase use sites
2. No silent fallbacks — fail loud with logged errors, user-facing message keys
3. Server-authoritative everything — spin results, room state, weights (Rigged), permissions; never trust the client
4. Types non-optional: `mypy --strict` + `tsc --noEmit` must pass; stub third-party libs missing types, never `any`
5. No commented-out code
6. No TODOs without entry in `docs/TODO.md`
7. Tests for every service-layer function with branching logic; routers smoke-tested; `<Wheel>` math unit-tested; Rigged Mode weight distribution statistically tested (over 1000-spin simulation)
8. Migrations reversible; one logical change per migration
9. Secrets only via env; `.env.example` documents every var with fake value + `# what this does`
10. Conventional Commits
11. Accessibility: semantic HTML, aria-labels, focus rings, WCAG AA contrast
12. Perf budget: initial JS ≤ 250KB gzipped; TTI ≤ 2s on mid-range Android
13. Logging: structured JSON with `room_id`, `user_id`, `event` always present; no PII (no full names, no usernames) in logs
14. **Mobile-native rules from §3 are non-negotiable.** If a screen feels webby, rebuild it.

---

## 17. Definition of Done

### MVP Done (Phases 1–6)
- [ ] All 6 Quick Wheels on home work as solo spins
- [ ] New user hits a spin within 10 seconds of first open
- [ ] Two-device sync test: ≤ 50ms spin delta on same Wi-Fi
- [ ] Brand word moment feels juicy — confetti + haptic + sound + `<HobaWord />` entrance all sync'd; renders `Hoba!` in EN, `Хоба!` in UK
- [ ] Reactions fly across both devices during spin
- [ ] Both languages, zero missing keys, copy reads native
- [ ] Real device test: iPhone 12+ and mid-range Android, both Telegram themes
- [ ] Mobile-native audit passes — no screen looks webby
- [ ] `pytest`, `ruff`, `mypy --strict`, `eslint`, `tsc --noEmit`, `i18n:check` all green
- [ ] Lighthouse mobile: Performance ≥ 90, Accessibility ≥ 95
- [ ] Sentry receiving events from both ends
- [ ] BotFather configured (basic commands + menu + descriptions)
- [ ] Deployed and accessible to 10 real users

### Full Done (Phases 7–12)
- [ ] All 5 game modes playable end-to-end with proper visuals
- [ ] Rigged Mode passes playtest — guests can't detect, reveal lands satisfyingly
- [ ] Public wheels + trending + moderation working
- [ ] Host moderation toolkit complete
- [ ] All 12 UX flows verified
- [ ] Privacy + Terms drafted both languages
- [ ] README has 60-second walkthrough video/GIF
- [ ] At least one public wheel passes moderation and appears in trending
- [ ] Smoke test on staging passed; production deploy successful

---

## 18. Claude — your immediate next reply

1. Confirm you have read this spec in full.
2. List any ambiguities you want resolved (max 10).
3. Propose a 2-line summary of Phase 1 deliverables.
4. STOP. Do not code until I reply "go on phase 1".

After my go, execute Phase 1 only, then stop at the acceptance checkpoint. Repeat for each subsequent phase. Do not auto-advance.

**Remember:** MVP target is Phases 1–6. Ship the brand-word moment first (locale-aware: `Hoba!` in EN, `Хоба!` in UK), validate with real users, then build the rest.

---

*End of spec. Source of truth. If chat instructions ever contradict this document, ask which wins before proceeding.*
