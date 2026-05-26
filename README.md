# Hoba!

> A Telegram Mini App party game. Tap a wheel, the wheel spins, it stops — **Hoba!** — and the decision is made. Built for the moment four people are arguing about where to eat.

`Hoba!` (Latin) is the brand in English / code / logo / bot identity. `Хоба!` (Cyrillic) is the same brand inside the Ukrainian locale. Both renderings are first-class.

- **Bot:** [@hobagame_bot](https://t.me/hobagame_bot)
- **Spec (the source of truth):** [`docs/spec.md`](docs/spec.md)
- **Where we are right now:** see `CLAUDE.md` → "Current phase" and [`docs/roadmap.md`](docs/roadmap.md)

---

## What it does

- **Solo mode.** Pick a Quick Wheel ("Where to eat?", "Truth or Dare", "Who pays?", …) or build a custom one in `/create`. Spin → branded `Hoba!` / `Хоба!` reveal → confetti, haptics, sound.
- **Multiplayer rooms.** Server-authoritative spin. Two phones, one room, identical animation within ±50 ms. Reactions fly across every connected client during the spin. Share via Telegram's native picker.
- **Five game modes** (Classic available today; Elimination, Punishment, Chaos, and the legendary **Rigged 🎭** mode are scheduled for Stage D–E — see [`docs/roadmap.md`](docs/roadmap.md)).
- **EN and UK locales only.** Every user-facing string goes through `t()`; CI enforces parity via `pnpm i18n:check`.
- **Mobile-native UI.** No hover states, 44×44 px tap targets, sheets instead of modals. If a screen looks at home on a desktop browser, the spec considers it a bug.

---

## Tech stack

| Layer | Choice | Why it's locked in |
|---|---|---|
| Backend framework | **FastAPI** (Python 3.12, async) | Speedy DX, OpenAPI for free, plugs into Socket.IO via ASGI. |
| Realtime | **python-socketio** on the `/rooms` namespace | Server-authoritative spin announcements, presence, reactions. |
| Bot | **aiogram 3** | Idiomatic async, type-friendly, modern Telegram API surface. |
| Persistence | **SQLAlchemy 2.0 async** + **SQLite** (`aiosqlite`) — swap to Postgres by URL | SQLite is enough through Stage E per spec. Migrations: **Alembic**. |
| Ephemeral state | **Redis 7** (presence, rate limits, `tg_id → user_id` cache) | Required from day one; everything ephemeral lives here. |
| Frontend | **React 18** + **Vite 5** + **TypeScript 5 strict** | Familiar, fast HMR, strict typing across boundaries. |
| Styling | **Tailwind** + **Framer Motion** | Utility CSS for mobile-native rules; Motion for the wheel + reveal. |
| State | **Zustand** | One store for the realtime room snapshot, no Redux boilerplate. |
| Telegram | **@twa-dev/sdk** | Theme + viewport + share + back-button bindings. |
| i18n | **react-i18next** + **ICU** | Plural rules + interpolation in EN and UK; parity enforced by `scripts/i18n-check.mjs`. |
| Sound | **Howler** | Cross-platform mobile audio with predictable iOS behavior. |
| Tooling | `uv` (Python), `pnpm` (Node), `docker compose`, `ruff`, `mypy --strict`, `eslint`, `vitest`, `pytest` | Locked versions, zero "works on my machine." |

Production deploy uses **Caddy** for auto-TLS in the `prod` compose profile. Dev tunnel is **ngrok** (cloudflared had an iPhone Safari reachability issue — see [`docs/development.md`](docs/development.md)).

---

## Repository layout

```
apps/
  api/             FastAPI + Socket.IO  (Python package: hoba_api)
  bot/             aiogram bot          (Python package: hoba_bot)
  webapp/          React + Vite + TS Mini App
packages/
  shared-types/    TS types generated from OpenAPI (filled in Stage D+)
docs/
  spec.md          Product + engineering spec — source of truth
  roadmap.md       Post-MVP execution order, stage by stage
  architecture.md  How the services compose at runtime
  development.md   Local setup, dev tunnel, debugging
  testing.md       Running tests + manual verification per stage
  TODO.md          Tracked TODOs (CLAUDE.md rule 8)
  botfather-setup.md  Bot identity + menu button configuration
  audio-licenses.md   Sound asset attribution
  brand/           Brand assets
infra/
  caddy/           Caddyfile (prod profile only)
scripts/
  i18n-check.mjs   EN ↔ UK locale parity + referenced-key coverage
CLAUDE.md          Operational guide for Claude Code working in this repo
```

---

## Quick start

> Three commands for a working local environment. The bot runs in **idle mode** with no token, which is fine for everything except the actual Telegram launch.

```bash
cp .env.example .env             # then fill TELEGRAM_BOT_TOKEN from @BotFather if you have one
docker compose up                # api :8000, webapp :5173, bot, redis, sqlite volume
ngrok http 5173                  # only when you want to test inside real Telegram
```

Then:

- **Webapp:** <http://localhost:5173>
- **API docs (Swagger):** <http://localhost:8000/docs>
- **Telegram:** open `@hobagame_bot`, `/start`, tap the menu button (requires the tunnel above + a configured BotFather menu button — see [`docs/botfather-setup.md`](docs/botfather-setup.md))

For the full local setup (running services without Docker, environment variables, dev tunnel walkthrough), see [`docs/development.md`](docs/development.md).
For automated tests and the manual two-device verification checklist, see [`docs/testing.md`](docs/testing.md).

---

## Quality gates

Each gate is required before a stage closes — none of them are optional.

```bash
# Backend
cd apps/api
source ../../venv/bin/activate
pytest                          # tests + coverage gate (≥ 80%)
mypy --strict src/hoba_api
ruff check src tests

# Frontend
cd ../webapp
pnpm typecheck                  # tsc --noEmit
pnpm lint                       # eslint, --max-warnings 0
pnpm test                       # vitest

# Locale parity (run from repo root)
pnpm i18n:check
```

---

## Status

**Stage A complete (2026-05-26).** MVP code is shipping-ready: Phase 6 carry-overs closed (share deep-link delivery, Redis `tg_id` cache, EN + UK room namespace parity, WS + Redis test coverage, `pnpm i18n:check`).

Next: **Stage B — pre-launch hardening** (see [`docs/roadmap.md`](docs/roadmap.md)).

The bot is **disabled (idle)** when `TELEGRAM_BOT_TOKEN` is empty. Set the token in `.env` and `docker compose restart bot` to enable polling.

---

## License

Proprietary — see [`LICENSE`](LICENSE).
