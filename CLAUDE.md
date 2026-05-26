# Hoba! — Claude Code Working Instructions

> Telegram Mini App party game. Multiplayer "wheel of decisions" with 5 game modes (Classic, Elimination, Punishment, Chaos, Rigged 🎭).

## Source of truth
The full product + engineering specification is at **`docs/spec.md`**.
**You MUST read it before starting any new phase.** Re-read the relevant phase section before each `go on phase N` command. If chat instructions ever conflict with `docs/spec.md`, ask which wins.

## Current phase
> **Stage A complete + verified (2026-05-26).** Original 5 Phase-6 blockers closed, then hands-on Telegram testing surfaced 6 more bugs which were all fixed in the same stage (see "Stage A close-out" below). The app now runs end-to-end on real phones with EN + UK locale parity, working multiplayer share, host detection, and consistent spin UX. Next: **Stage B — pre-launch hardening** (see `docs/roadmap.md`).

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
- Phase 6 — Rooms REST (`/api/v1/rooms`), Socket.IO `/rooms` namespace, server-authoritative spin, presence, reactions, share-link generation (delivery broken — see blockers)

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

### Stage A test totals (final)
102 backend tests, 31 frontend tests, 91% backend coverage. mypy --strict, ruff, eslint, tsc, i18n:check all green.

## Languages (locked)
EN + UK only. Brand is locale-aware per spec §0 and rule 5 below — `Hoba!` in EN/code/files/logo, `Хоба!` in UK in-app UI only. **Every user-facing string must go through `t()`. Hardcoded English in `.tsx` is a bug.**

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
- **Infra:** Docker Compose. Caddy in prod profile only (auto-TLS). dev tunnel via cloudflared (developer-managed, not in compose).

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
ngrok http 5173   # cloudflared was unreachable from iPhone Safari — see docs/TODO.md
# paste returned HTTPS URL into WEBAPP_URL in .env and restart bot service
```

> Dev tunnel: **ngrok preferred over cloudflared** until the cloudflared mobile issue is documented. See `docs/TODO.md`.

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
