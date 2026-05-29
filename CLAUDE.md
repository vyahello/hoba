# Hoba! — Claude Code Working Instructions

> Telegram Mini App party game. Multiplayer "wheel of decisions" with 5 game modes (Classic, Elimination, Punishment, Chaos, Rigged 🎭).

## Source of truth
The full product + engineering specification is at **`docs/spec.md`**.
**You MUST read it before starting any new phase.** Re-read the relevant phase section before each `go on phase N` command. If chat instructions ever conflict with `docs/spec.md`, ask which wins.

## Current phase
> **Stage D in progress — two foundation slices live on prod (2026-05-29).** Stage C closed 2026-05-28 with owner-override GO on Phase 7+. Stage D slices delivered so far:
>
> 1. **Foundation slice (2026-05-28).** Backend `turn_based` spin policy + mode-default `spin_policy` derivation. Alembic 0004 added `current_turn_user_id` to rooms; `advance_turn` helper, `user_can_spin` dispatch, `_emit_settled` advance + `room:updated` broadcast, `update_room` cursor lifecycle. Frontend `computeCanSpin` turn_based branch, new `computeTurnState` helper, room-header status line in EN + UK. Spec `docs/superpowers/specs/2026-05-28-turn-based-mode-defaults-design.md`. Commits `6a91c46 … 023b6f3`.
>
> 2. **Mode-picker UI slice (2026-05-29).** Bottom sheet on Invite tap with 4 modes (Rigged stays for long-press reveal per spec §5.5). `GameModeBadge` in RoomPage header. `RoomSettingsSheet` gains `turn_based` as third option. PATCH endpoint extended to broadcast `current_turn_user_id` delta. EN + UK locales for all new strings. Spec `docs/superpowers/specs/2026-05-29-mode-picker-ui-design.md`. Commits `e6c47ba … 81092cd`.
>
> **Production live on `hobagame.duckdns.org`** (Hetzner shared VPS, host nginx TLS terminator, containers on `127.0.0.1:8800/5800/6800`; static-bundle webapp). Test totals at exit: **146 backend / 72 frontend**, 91 % coverage. 2026-05-29 deploy uncovered 4 production-only issues (uvicorn `--reload` loop, Alembic `batch_alter_table` FK naming, partial-migration corruption, sudo-rm-while-container-running no-op) — all fixed and folded into `docs/deployment.md` § 9b "Troubleshooting recipes" + tracked as Stage G items in `docs/TODO.md`. See `docs/validation-notes.md` § Owner-side deploy + verification — 2026-05-29.
>
> **Next Stage D slice:** per-mode gameplay UI — Elimination segment-shatter animation, Punishment card deck broadcast, Chaos pre-spin event announcement. Spec §5.2–5.4 + §15 Phase 7. Has its own brainstorming arc when owner says "next slice".

Owner updates this line after each `STAGE X COMPLETE` (post-MVP we run stages, not phases — stages map to spec phases per `docs/roadmap.md`).

## Roadmap source
Order of operations is **`docs/roadmap.md`** — stages A → G, each ending with `STAGE X COMPLETE`, owner approves before next `go`. The roadmap is the order; `docs/spec.md` is still the *what*. Re-read the roadmap section for the current stage before any work.

## Documentation index
- [`README.md`](README.md) — product pitch + tech stack + quick start. Read first if you're new to the repo.
- [`docs/spec.md`](docs/spec.md) — product + engineering specification. **Source of truth.**
- [`docs/roadmap.md`](docs/roadmap.md) — post-MVP execution order (stages A–G).
- [`docs/architecture.md`](docs/architecture.md) — how the three services compose at runtime.
- [`docs/development.md`](docs/development.md) — local setup, dev tunnel, debugging recipes.
- [`docs/testing.md`](docs/testing.md) — test layout, running suites, manual verification per stage.
- [`docs/TODO.md`](docs/TODO.md) — tracked TODOs (rule 8).
- [`docs/botfather-setup.md`](docs/botfather-setup.md) — bot identity + menu button configuration.
- [`docs/deployment.md`](docs/deployment.md) — Stage C / production deploy walkthrough.
- [`docs/privacy.md`](docs/privacy.md) — Privacy Policy hosted via BotFather.
- [`docs/validation-notes.md`](docs/validation-notes.md) — Stage C session log + cross-session synthesis.
- [`docs/soft-launch-invite.md`](docs/soft-launch-invite.md) — friend invite copy (EN + UK) + session protocol.

When you make a non-trivial change that affects something documented above, update the relevant doc in the same commit.

## Stage transition workflow (read at every `STAGE X COMPLETE`)
At the moment a stage closes, before stopping, update **all** of these so the next session is not misled:
1. `CLAUDE.md` "Current phase" line — point at the next stage and summarise what just closed.
2. `CLAUDE.md` Stage X close-out section — list each item closed and the files involved.
3. `docs/roadmap.md` — if any stage's scope shifted mid-execution, edit the relevant section.
4. `docs/TODO.md` — strike resolved items, add any carry-overs into the next stage's bucket.
5. Memory at `/home/kali/.claude/projects/-home-kali-hoba/memory/`:
   - Update `hoba-project-state.md` with the new current stage.
   - Update or add stage-specific memories (e.g. `hoba-mvp-blockers.md` was rewritten when Stage A closed) with where each fix landed.
   - Refresh `MEMORY.md` index entries if any new memories were added.

Skipping any of these = future Claude opens cold and re-derives state from `git log` instead of from the documented record. Don't do that.

## What is already shipped (read this before exploring)
- Phase 1 — monorepo + docker-compose (redis, api, bot, webapp) + .env.example
- Phase 2 — User model, Alembic, FastAPI app, initData validation, `/api/v1/me`
- Phase 3 — aiogram bot, all commands, deep-link parsing for `room_<CODE>`
- Phase 4 — Vite/React/TS Mini App, full DS at `/dev/ds`, i18n EN + UK (6 namespaces), Home with Quick Wheels (F2)
- Phase 5 — `<Wheel>` + solo spin flow + audio + custom wheel editor + spin history
- Phase 6 — Rooms REST (`/api/v1/rooms`), Socket.IO `/rooms` namespace, server-authoritative spin, presence, reactions, share-link generation + delivery (delivery fixed in Stage A item 1, commit `b873a00`)

## Stage A close-out (2026-05-26)

### Original roadmap items (5)
1. ✅ Share deep-link auto-navigate fixed in `lib/startParam.ts` (SDK → hash → query fallback) + `RoomPage.handleShare` uses `buildRoomInviteLink` with optional Direct Link short_name from `VITE_TELEGRAM_APP_SHORT_NAME`. Commit `b873a00`.
2. ✅ Redis `tg_id → user_id` cache: `services/users.resolve_telegram_user` + `cache_user_after_commit`; 15 min TTL; HTTP auth dependency + WS connect both wired. Commit `b873a00`.
3. ✅ New `room` namespace in EN + UK; all `RoomPage` / `SpinPage` / `ReactionsBar` hardcoded strings removed; error codes map through `room.errors.*` with fallback. Commit `b873a00`.
4. ✅ `scripts/i18n-check.mjs` — EN ↔ UK key parity + referenced-key coverage; failure-on-divergence verified. Commit `b873a00`.
5. ✅ Realtime + Redis tests via `FakeSocketIO` + `fakeredis.aioredis` autouse fixture; coverage gate is back to global 80% (handlers/redis no longer omitted). Commit `b873a00`.

### Verification-pass fixes (6, found during real-device testing)
6. ✅ Docs split: README rewritten as a landing page; runtime composition → `docs/architecture.md`; local setup → `docs/development.md`; test layout + manual verification → `docs/testing.md`. Commit `6ef70a4`.
7. ✅ `VITE_TELEGRAM_BOT_USERNAME` + `VITE_TELEGRAM_APP_SHORT_NAME` piped through `docker-compose.yml` to the webapp container (Stage A regression — env vars existed in `.env.example` but weren't reaching Vite at runtime). Commit `6b72946`.
8. ✅ Host detection bug: `RoomPage` was comparing Telegram tg_id (`initDataUnsafe.user.id`, e.g. `7740882501`) against internal DB `user_id` (e.g. `1`). Added `me_user_id` to `RoomState` DTO so the client knows its own internal id. Commit `7db1b0a`.
9. ✅ UK locale rewrite: "Куди їсти?" → "Що поїсти?", proper ICU plurals for participant count (учасник/учасники/учасників), "Господар" → "Ведучий" in spin hint, and ~15 other natural-language fixes. Commit `4efb510`.
10. ✅ `+ Invite friends` CTA now visible on the solo idle screen (was only post-settle). Commit `bfdca38`.
11. ✅ Wheel hub tap fully wired: works in rooms (was missing `onSpinClick` prop on `<Wheel>` in `RoomPage`) + `SPIN` label inside the hub localized via `t('common:actions.spin')` (was hardcoded English). Commit `d425a7a`.
12. ✅ Default `spin_policy` flipped from `host_only` to `anyone` (model + service + REST schema + Alembic `0003`). Party-game social fit. Existing rows untouched. Commit `00f3c21`.

### Close-out batch (2026-05-27, 4 items)

13. ✅ Wheel hub stays tappable across the `idle → spinning → settled` cycle and respects the spin permission (no `SPIN` affordance for guests in `host_only` rooms). New `apps/webapp/src/features/wheel/hubLogic.ts` (`isHubInteractive`) with 5 unit tests; `Wheel.tsx` and `SpinPage.handleSpin` consume it. Commit `31a23e8`.
14. ✅ `apps/webapp/src/features/rooms/permissions.ts` (`computeCanSpin`) extracted from `RoomPage` with 7 unit tests — direct regression guard for the tg_id-vs-user_id bug in commit `7db1b0a`. Resolves the carry-over previously sitting in `docs/TODO.md` as a Stage B test debt. Commit `c5334ee`.
15. ✅ BotFather Direct Link Mini App `spin` deleted; remaining `play` already matched `VITE_TELEGRAM_APP_SHORT_NAME`. `docs/botfather-setup.md` §8 aligned. Commit `0756782`.
16. ✅ `docs/manual-verify-stageA.md` backfilled — the file referenced by `docs/roadmap.md:48` and `docs/testing.md:279` finally exists with the two-device verification record for 2026-05-26 and the pending real-device pass for the 2026-05-27 batch. Plus the stale ngrok README TODO closed in `docs/TODO.md`. Commit `55b9ff3`.
17. ✅ Top-of-room Share Button overflowed the iPhone X viewport (UK locale ~56 px off-screen; EN ~2 px). Converted to `IconButton` 📤 with the localized text moved into `aria-label`. Pill stays full brand size. Commit `7e21a85`.
18. ✅ Wheel spin lag on iPhone X (A11, iOS 16) — replaced the `feGaussianBlur` ring-glow filter with three stacked solid strokes (18/12/6 px at decreasing opacity). Same silhouette, pure compositor path, no SVG-filter CPU rasterization. **Pending iPhone X verification.** Commit `33a976b`.
19. ✅ Flying reactions emerged at random `Math.random()` horizontal positions. New `apps/webapp/src/features/rooms/reactionLanes.ts` (`REACTION_EMOJIS` + `reactionLaneFor`) gives each emoji a fixed lane aligned with its bar button; ±2.5 % jitter prevents pixel-stacking on bursts. 5 unit tests. Commit `798788f`.
20. ✅ `RoomCodePill` default size tightened from `text-3xl + tracking-[0.35em] + px-7 py-4` to `text-2xl + tracking-[0.3em] + px-6 py-3` — pill now sits at ~175 px instead of ~220 px on iPhone X, proportional to the rest of the room screen. Commit `6dbfbe0`.
21. ✅ Three hardcoded EN strings in `RoomCodePill` (toast titles + aria-label) localized through `room.code_pill.*` (EN + UK). Closes the i18n gap surfaced while inspecting the pill for item 20. Commit `0fb392c`.

### Stage A test totals (final)
102 backend tests, **48 frontend tests** (was 31; +17 across hubLogic, computeCanSpin, reactionLanes), 92% backend coverage. mypy --strict, ruff, eslint, tsc, i18n:check all green.

## Stage B close-out (2026-05-27)

Pre-launch hardening, 9 items across 9 commits:

1. ✅ **B1 — server rate limits + spin cooldown.** New `cooldown_take(key, ttl_ms)` Redis primitive (SET NX PX); `on_spin_trigger` enforces 1.5 s/room cooldown + 30 spins/room/hour; `POST /api/v1/rooms` enforces 5/user/hour. +8 backend tests (`tests/services/test_cooldown.py`, `tests/api/test_rooms.py`, `tests/realtime/test_handlers.py`). Commit `f723a0f`.
2. ✅ **B2 — brand-keyed crash screen.** `AppErrorBoundary` reduced to React boundary plumbing; visible UI moved to functional `CrashScreen` with locale-aware copy + reload CTA + collapsible technical details. New `common.crash.{title,description,reload,details_label}` (EN + UK). Commit `d87371b`.
3. ✅ **B3 — enableClosingConfirmation in active rooms.** New `enableClosingConfirmation` / `disableClosingConfirmation` helpers in `lib/telegram.ts`; `RoomPage` wires them on `snapshot.room.status === "active"` only (lobby + closed are fine to swipe away). Commit `e1c16d0`.
4. ✅ **B4 — empty states.** Audit showed `HomePage` `my_wheels`, `LibraryPage` (via `StubPage`), and the `EmptyState` DS component already cover the charter; no new work needed. Closed without a code commit.
5. ✅ **B5 — Aurora background.** Mounted globally in `RootLayout`. `fixed inset-0 -z-10`, pure CSS — no per-page boilerplate. Commit `e6916bd`.
6. ✅ **B6 — host settings sheet.** New `RoomSettingsSheet` (bottom sheet) + `isHost(snapshot)` helper (+2 tests) + `api.patchRoom` + `useRoomStore.setSnapshot`. Host-only ⚙️ button next to share. Toggle "Everyone in the room" / "Only me (host)". REST PATCH refreshes calling host's snapshot; guest broadcast queued for Stage C (`docs/TODO.md`). Commit `ac7dab2`.
7. ✅ **B7 — 360 px audit.** Static review surfaced no fixed widths that breach 360 px; checklist for real-device pass in `docs/manual-verify-stageB.md` §6. Commit `c02cc64`.
8. ✅ **B8 — prod compose boot check.** `docker compose --profile prod config` parses cleanly; the webapp dev-server-as-prod limitation deferred to Stage G via `docs/TODO.md`. Commit `544fa6d`.
9. ✅ **B9 — BotFather pre-launch checklist.** Owner-driven steps scripted in `docs/manual-verify-stageB.md` §7 (name, photo, about, description, commands, menu button, Direct Link Mini App URL). Commit `c02cc64`.

### Stage B verification-pass fix (2026-05-27)

10. ✅ **B6 follow-up — stale guest UI on policy change.** Real-device test of the host settings sheet surfaced three coupled bugs: server emitted `not_allowed_to_spin` but the locale was missing it; the cooldown check ran before the permission check so a guest's rejected tap burned the per-room cooldown; and connected guests' UIs never learned about the host's `PATCH` because the REST endpoint didn't broadcast. Fix: localized error (EN+UK), reordered `on_spin_trigger` (permission first, throttles second), `PATCH /api/v1/rooms/{code}` now emits `room:updated { patch }` to the room namespace, client store merges into `snapshot.room`. Closes the Stage C carry-over from commit `544fa6d`. Commit `3f4dbeb`.
11. ✅ **Back button dead for deep-link entrants.** Real-device test: guest opening `t.me/hobagame_bot?startapp=room_<CODE>` couldn't navigate back from `/room/<CODE>` — neither the ← IconButton nor Telegram's native BackButton. Cause: `RootLayout`'s deep-link auto-navigate uses `replace: true` so `window.history.length === 1`; `navigate(-1)` is a no-op. New `lib/navigation.ts` `safeNavigateBack(navigate)` checks history length and falls back to `navigate("/")`. Wired into all 5 call sites (RootLayout BackButton handler, RoomPage skeleton + active headers, CreatePage, SpinPage). +3 unit tests. Commit `150b323`.

### Stage B test totals
**113 backend tests** (was 110; +3 from cooldown-no-burn-on-guest-rejection and room:updated broadcast), **53 frontend tests** (was 50; +3 from navigation), 91 % backend coverage. mypy --strict, ruff, eslint, tsc, i18n:check all green.

## Stage C deploy chain (2026-05-27)

Production deploy hit a shared VPS that already ran an unrelated site on its public-facing nginx. Soft-launch path landed across 7 commits, several of which were on-the-fly fixes to the deploy walkthrough as friction surfaced:

- `0756782 → 75bd608` — shared-VPS deployment groundwork: `compose.shared.yaml` with `!override` ports + Caddy disabled, `infra/nginx/hoba.conf` server block (proxy_pass to `127.0.0.1:8800` for `/api/`, `/socket.io/`, `/openapi.json`; `127.0.0.1:5800` for the SPA), `docs/deployment.md` rewritten with both dedicated- and shared-VPS flavours.
- `a6ce1af` — Vite `allowedHosts` extended to cover `.duckdns.org` + a `VITE_ALLOWED_HOSTS` env hook for future custom domains. First-deploy Vite quirk: 403 on the new hostname.
- `2050774` — multi-stage Dockerfile pulled forward from Stage G. Vite dev server proved unreliable in prod (allowedHosts 403, then a 9 s hang during a HEAD request that Telegram aborted with "Operation was cancelled"). Webapp container is now `nginx:1.27-alpine` serving a pre-built static bundle from `pnpm build`. `apps/webapp/nginx.conf` handles SPA fallback + immutable-asset cache headers. `docker-compose.yml` pins the dev target explicitly so local workflow is unchanged.
- `c0a591e` — anchored the rsync excludes in `docs/deployment.md` after the unanchored `--exclude=data` collateral-deleted `apps/webapp/src/data/quickWheels.ts` from the server.
- `acd2c62` — `docs/privacy.md` for BotFather's Privacy Policy field.
- `2c156f7` — `docs/deployment.md` smoke-test paths fixed (FastAPI serves `openapi.json` at root, not `/api/v1/openapi.json`).
- BotFather (manual, owner-side) — name `Hoba!`, About + Description in EN, command list, profile pic, Direct Link Mini App `play` URL, Privacy Policy URL — all set against `https://hobagame.duckdns.org/`.

## Languages (locked)
EN + UK only. Brand is locale-aware per spec §0 and rule 5 below — `Hoba!` in EN/code/files/logo, `Хоба!` in UK in-app UI only. **Every user-facing string must go through `t()`. Hardcoded English in `.tsx` is a bug.** *Exception:* `apps/webapp/src/pages/DevDSPage.tsx` (the design-system showcase at `/dev/ds`) is exempt — its strings are fixtures simulating user input, not production UI copy.

## Non-negotiable rules

1. **Phase-by-phase only.** Never auto-advance. Each phase ends with: tests green + file tree diff + manual verify checklist + `PHASE N COMPLETE` status block. Then STOP and wait.
2. **Server-authoritative everything.** Never trust the client for spin results, weights (Rigged Mode), permissions, room state.
3. **Types are not optional.** `mypy --strict` and `tsc --noEmit` must pass. No `any` / `Any` without `# justified: <reason>` comment.
4. **Mobile-native UI.** No hover states. 44×44 px minimum tap target. Sheets, not modals. Body ≥14px, primary ≥16px. If a screen could exist on a desktop website, it's wrong. See `docs/spec.md` §3.
5. **Brand is locale-aware.** `Hoba!` (Latin, EN/default, logo, files, code). `Хоба!` (Ukrainian locale, in-app UI only). Never mix.
6. **No premature abstraction.** No plugin systems, event buses, or "frameworks" without ≥3 in-codebase use sites.
7. **No silent fallbacks.** Fail loud with logged errors and user-facing message keys.
8. **No commented-out code.** No TODOs without an entry in `docs/TODO.md`.
9. **Conventional Commits** (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`). One logical change per commit.
10. **Ask before adding features not in `docs/spec.md`.**

## Tech stack (locked)

- **Backend:** Python 3.12 + FastAPI + aiogram 3 + SQLAlchemy 2.0 (async) + Alembic + python-socketio + Redis + structlog + pytest. Deps via `uv`.
- **Frontend:** React 18 + Vite 5 + TypeScript 5 (strict) + Tailwind + Framer Motion + Zustand + @twa-dev/sdk + socket.io-client + react-i18next + Howler. Deps via `pnpm`.
- **Persistence:** SQLite (default, `aiosqlite`) via `DATABASE_URL`. Postgres-ready (URL swap). Redis required from day 1.
- **Infra:** Docker Compose. Caddy in dedicated-VPS prod profile (auto-TLS); shared-VPS deploys (e.g. current Stage C `hobagame.duckdns.org`) disable Caddy and use host nginx as TLS terminator via `compose.shared.yaml`. Dev tunnel via ngrok (developer-managed, not in compose; cloudflared was tried but had iPhone Safari reachability issues during Stage A).

## Telegram bot identity

- Name: `Hoba!`
- Username: `@hobagame_bot`
- Bot-level texts (commands, About, Description): EN base. Localization happens inside the Mini App.

## Workflow (every stage / phase)

1. Owner says `go on stage X` (post-MVP) or `go on phase N` (legacy).
2. Re-read the relevant **`docs/roadmap.md` stage** *and* the spec sections it references.
3. Implement only what that stage requires. Do not pre-build later stages.
4. Run all quality gates: `pytest` + `ruff` + `mypy --strict` + `eslint` + `tsc --noEmit` + `i18n:check`.
5. Output: status block `STAGE X COMPLETE — verify by Y, expect Z`, file tree diff of changes, manual verification checklist.
6. STOP. Wait for owner verification and the next `go`.

## Quick start (for owner reference)

```bash
cp .env.example .env  # fill in TELEGRAM_BOT_TOKEN from BotFather (@hobagame_bot)
docker compose up
# webapp → http://localhost:5173
# api docs → http://localhost:8000/docs
# in another terminal, for real Telegram testing:
ngrok http 5173   # cloudflared had iPhone Safari reachability issues; ngrok is the current preference
# paste returned HTTPS URL into WEBAPP_URL in .env and restart bot service
```

> Dev tunnel: **ngrok preferred over cloudflared** based on Stage A real-device testing. See `docs/development.md` § "Dev tunnel for real Telegram testing".

## Key directories (created across Phase 1+)

- `apps/api/` — FastAPI + Socket.IO. Python package: `hoba_api`.
- `apps/bot/` — aiogram bot. Python package: `hoba_bot`. Imports models from `hoba_api`.
- `apps/webapp/` — React Mini App.
- `packages/shared-types/` — TS types generated from OpenAPI.
- `docs/` — spec, architecture, ws-protocol, game-modes, design-system, botfather-setup, audio-licenses, TODO.

## When uncertain
1. Re-read the relevant section of `docs/spec.md`.
2. If still uncertain, ASK the owner. Do not improvise.

---

*This file is operational guidance for Claude Code. The product/engineering specification is `docs/spec.md` — that is the source of truth.*
