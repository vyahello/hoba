# Hoba! — Claude Code Working Instructions

> Telegram Mini App party game. Multiplayer "wheel of decisions" with 5 game modes (Classic, Elimination, Punishment, Chaos, Rigged 🎭).

## Source of truth
The full product + engineering specification is at **`docs/spec.md`**.
**You MUST read it before starting any new phase.** Re-read the relevant phase section before each `go on phase N` / `go on stage X` command. If chat instructions ever conflict with `docs/spec.md`, ask which wins.

## Current phase
> **Stage D in progress — Elimination + turn-based foundation live on prod; Punishment reworked into a turn-based personal-bet race (v3/v4), committed 2026-05-30, pending owner deploy.**
> Stage C closed 2026-05-28 with owner-override GO on Phase 7+. Stage D has shipped: the turn-based foundation slice, the mode-picker UI slice, a real-device bug-fix pass, and **Elimination mode** (first per-mode gameplay + the `GameModeEngine` abstraction in `apps/api/src/hoba_api/modes/`: base Protocol, `ClassicEngine`, `EliminationEngine`, registry — unknown modes fall back to Classic).
>
> **Punishment — turn-based personal-bet race (v3/v4), committed 2026-05-30 — pending owner deploy + real-device verify.** Each present player locks one **unique** bet before the game; players spin **in turn** (host first); your own bet hitting scores a match (first to host-picked **N** = 1/3/5/7 wins; N=1 = first correct guess ends it); any other landing deals the spinner their own dare. Dare → "I'll do it" → a random *other* player approves **Yes/No** (No reopens the card); "Refuse (−1)" only with points. Per-player + room-wide done counters. This **supersedes the v2 prediction-wager** (Slice 4). Detail in [`docs/changelog.md`](docs/changelog.md) (Slice 5) + [`docs/game-modes.md`](docs/game-modes.md).
>
> **Chaos mode (spec §5.4) — committed 2026-05-31, reworked 3× same day, pending owner deploy + real-device verify.** Final design: Chaos is a **personal-bet RACE like Punishment** (pick a unique option, spin in turn, first to N matches wins; miss = no-op confetti, no dare) **plus a chaos event on every spin**. Reuses Punishment's whole flow via `isBetRace = punishment | chaos` (shared service/columns/UI; only `resolve_turn`'s miss branch forks). Six events (≈⅙): multi_spin (2–5 fast spins), slow_burn ×4, reverse CCW, swap (shown crossing), nudge_fwd/nudge_back (settle→shake→creep ±1, generic "nudge" card). No per-spin Hoba! banner (just confetti); Punishment-style winner hero. `turn_based` default (host_only also available). Client choreography is an async cancellable sequence (`phaseSpin`+`wheelRef`, shake via `useAnimate`) — **animations written blind, need on-device tuning** (`docs/TODO.md`). Server-authoritative (`modes/chaos.py` events + `services/punishment.py` race), no DB change. **Deferred: Double-spin, Phantom-segment.** Detail in [`docs/changelog.md`](docs/changelog.md) Slice 6 + [`docs/game-modes.md`](docs/game-modes.md).
>
> **With Chaos, all four non-Rigged modes are live.** Remaining mode work is **Rigged 🎭 (spec §5.5)** — picker-excluded, long-press reveal — likely a later stage. Owner decides whether to close Stage D or continue. Each new slice gets its own brainstorming arc only when owner says "next slice".
>
> **Production live on `hobagame.duckdns.org`** (Hetzner shared VPS; host nginx TLS terminator; containers on `127.0.0.1:8800/5800/6800`; static-bundle webapp). Infra topology and deploy walkthrough live in `docs/deployment.md`.
>
> **Full delivered-slice history (Phases 1–6, Stages A–C, and the Stage D slices above) is in [`docs/changelog.md`](docs/changelog.md).** Read it for the documented record instead of re-deriving from `git log`.

Owner updates this line after each `STAGE X COMPLETE`.

## Roadmap source
Order of operations is **`docs/roadmap.md`** — stages A → G, each ending with `STAGE X COMPLETE`, owner approves before next `go`. The roadmap is the order; `docs/spec.md` is still the *what*. Re-read the roadmap section for the current stage before any work.

## Documentation index
- [`README.md`](README.md) — product pitch + tech stack + quick start. Read first if you're new to the repo.
- [`docs/spec.md`](docs/spec.md) — product + engineering specification. **Source of truth.**
- [`docs/roadmap.md`](docs/roadmap.md) — post-MVP execution order (stages A–G).
- [`docs/changelog.md`](docs/changelog.md) — **delivered history** (Phases 1–6, Stage close-outs, deploy chains). Append-only record.
- [`docs/architecture.md`](docs/architecture.md) — how the three services compose at runtime.
- [`docs/development.md`](docs/development.md) — local setup, dev tunnel, debugging recipes.
- [`docs/testing.md`](docs/testing.md) — test layout, running suites, manual verification per stage.
- [`docs/TODO.md`](docs/TODO.md) — tracked TODOs (rule 8).
- [`docs/botfather-setup.md`](docs/botfather-setup.md) — bot identity + menu button configuration.
- [`docs/deployment.md`](docs/deployment.md) — production deploy walkthrough + § 9b troubleshooting recipes.
- [`docs/privacy.md`](docs/privacy.md) — Privacy Policy hosted via BotFather.
- [`docs/validation-notes.md`](docs/validation-notes.md) — session logs + cross-session synthesis.
- [`docs/soft-launch-invite.md`](docs/soft-launch-invite.md) — friend invite copy (EN + UK) + session protocol.
- [`docs/game-modes.md`](docs/game-modes.md) — per-mode gameplay mechanics (Elimination live; Punishment/Chaos planned).

When you make a non-trivial change that affects something documented above, update the relevant doc in the same commit.

## Stage transition workflow (read at every `STAGE X COMPLETE`)
At the moment a stage closes, before stopping, update **all** of these so the next session is not misled:
1. `CLAUDE.md` "Current phase" line — point at the next stage and give a one-paragraph summary of what just closed. **Do not paste item-by-item close-outs here.**
2. `docs/changelog.md` — append the full close-out: every item closed and the files/commits involved. This is where the detailed record lives.
3. `docs/roadmap.md` — if any stage's scope shifted mid-execution, edit the relevant section.
4. `docs/TODO.md` — strike resolved items, add any carry-overs into the next stage's bucket.
5. Memory at `/home/kali/.claude/projects/-home-kali-hoba/memory/`:
   - Update `hoba-project-state.md` with the new current stage.
   - Update or add stage-specific memories with where each fix landed.
   - Refresh `MEMORY.md` index entries if any new memories were added.

Skipping any of these = future Claude opens cold and re-derives state from `git log` instead of from the documented record. Don't do that.

## Languages (locked)
EN + UK only. Brand is locale-aware per spec §0 and rule 5 below — `Hoba!` in EN/code/files/logo, `Хоба!` in UK in-app UI only. **Every user-facing string must go through `t()`. Hardcoded English in `.tsx` is a bug.** *Exception:* `apps/webapp/src/pages/DevDSPage.tsx` (the design-system showcase at `/dev/ds`) is exempt — its strings are fixtures simulating user input, not production UI copy.

## Non-negotiable rules

1. **Phase-by-phase only.** Never auto-advance. Each phase ends with: tests green + file tree diff + manual verify checklist + `PHASE N COMPLETE` / `STAGE X COMPLETE` status block. Then STOP and wait.
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
- **Infra:** Docker Compose. Caddy in dedicated-VPS prod profile (auto-TLS); shared-VPS deploys (current prod `hobagame.duckdns.org`) disable Caddy and use host nginx as TLS terminator via `compose.shared.yaml`. Dev tunnel via ngrok (developer-managed, not in compose; cloudflared had iPhone Safari reachability issues during Stage A).

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

## Key directories

- `apps/api/` — FastAPI + Socket.IO. Python package: `hoba_api`. Per-mode engines in `apps/api/src/hoba_api/modes/`.
- `apps/bot/` — aiogram bot. Python package: `hoba_bot`. Imports models from `hoba_api`.
- `apps/webapp/` — React Mini App.
- `packages/shared-types/` — TS types generated from OpenAPI.
- `docs/` — spec, roadmap, changelog, architecture, ws-protocol, game-modes, design-system, botfather-setup, audio-licenses, TODO.

## When uncertain
1. Re-read the relevant section of `docs/spec.md`.
2. If still uncertain, ASK the owner. Do not improvise.

---

*This file is operational guidance for Claude Code. The product/engineering specification is `docs/spec.md` — that is the source of truth. The delivered history is `docs/changelog.md`.*
