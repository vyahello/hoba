# Hoba! — Delivered History

> Append-only record of shipped work. Moved out of `CLAUDE.md` so the operational file stays lean (and cheap to load into every Claude Code session). Newest first. `CLAUDE.md` keeps only the *current* phase line; close-out detail lands here.

---

## Stage D — in progress (Chaos + Punishment turn-based race + Elimination + foundation)

### Slice 6 — Chaos mode (2026-05-31) — committed, pending owner deploy

Implemented Chaos (spec §5.4) as the fourth `GameModeEngine`, then **reworked it three times the same day** as the owner iterated. Final delivered design:

- **Chaos is now a personal-bet RACE** (like Punishment, minus dares): pick a unique option, spin **in turn** (host first), landing on your own bet scores a match, **first to N wins** (host picks N∈{1,3,5,7}). A miss = no-op (confetti + next turn). This **replaced** the earlier best-of-N "most-frequent-wins" model. Reuses Punishment's flow end-to-end via `isBetRace = punishment | chaos`: same service (`place_bet`/`start_game`/`resolve_turn`/`reset_game`), same columns, same betting/turn/standings/winner UI; the only fork is `resolve_turn`'s miss branch (chaos → `kind:"miss"`, advance). Dare/approval UI auto-disables (chaos outcomes are never `"punish"`). **No per-spin "Hoba!" banner** — just confetti; **winner hero** matches Punishment. Chaos is **`turn_based` only** — host_only was dropped (degenerate for a multi-player race), and the settings gear is hidden.
- **A chaos event still fires on EVERY spin** — one of **seven**, ≈⅐ each: **multi_spin** (2–5 short fast spins, last counts), **slow_burn** (×4, genuinely slow), **reverse** (CCW), **swap** (two segments trade places, shown **crossing** on the card), **nudge_fwd / nudge_back** (settle → "thinking" shake → creep ±1 sector, changing the result; both share one **generic "nudge"** card so the direction isn't spoiled), **blind_pointer** (pointer vanishes during the spin and reappears at a random screen angle on stop — server picks the angle + the segment under it; `<Wheel>` gained `pointerHidden`/`pointerDeg` props). The first cut's speed_run became multi_spin; jackpot was removed. Announcement card holds 2.5 s (read time).
- **Client choreography:** the RoomPage spin-drive effect is an async, cancellable sequence. `multi_spin` feeds sequential `SpinResult`s to `<Wheel>` via a `phaseSpin` override + `wheelRef`; `nudge_*` does spin → container shake (`useAnimate`) → one-sector creep; `swap` animates the two `swap_pair` labels crossing in the card. Server records the nudged result + `nudge_from_angle`; tunable constants (`MULTI_SPIN_*`, `NUDGE_*`, `SLOW_BURN_MULTIPLIER`) flagged for on-device tuning in `docs/TODO.md`.
- **Host picks attempts N ∈ {1,3,5,7}** in the mode picker (like Punishment) → **best-of-N**, most-frequent segment wins. Reuses the Classic best-of-N machinery via a one-line gate change (`game_mode in (classic, chaos)` in `_emit_settled`) + `isBestOfN` gate + `DEFAULT_CHAOS_SPIN_COUNT = 3`.
- **Spin policy:** default `turn_based`; settings sheet offers host_only + turn_based only ("anyone" hidden for Chaos). `MODE_DEFAULT_SPIN_POLICY["chaos"]` = `turn_based`.
- **Announcement card** leads with the skewed `<HobaWord/>` + event emoji/title, held `CHAOS_ANNOUNCE_MS = 1500` before the wheel releases (settle/reveal timers offset by the pre-roll).

Server-authoritative roll in `modes/chaos.py` (`ChaosEngine`, injected RNG for deterministic tests). The `reverse` angle flip lives in `services/spins.py` (engines never compute angles): final angle re-targeted below the start so Framer animates CCW to the same sector. `swap` reorders `SpinDecision.segments` + emits `segment_order` so the client renders the same order. Event **folded into `spin:started.mode_effects`** (no separate `chaos:event`). **No DB change.** Frontend: `features/rooms/chaos.ts` (`CHAOS_EVENTS`/`CHAOS_EVENT_EMOJI`/`orderSegmentsForSpin`); picker/badge/`GameMode`/`modes.chaos` were already wired from Slice 2. EN+UK i18n `chaos.events.*` + new "full chaos" tagline.

The intermediate first cut (commit `9c700cb`: 25% probability, 5 events incl. jackpot, env-configurable `CHAOS_PROBABILITY`, default policy `anyone`) was superseded within the day — probability config removed, jackpot removed, policy → turn_based, attempts added.

Gates green (Opus 4.8, inline — no subagent fan-out): **218 backend** (coverage 86%) / **103 frontend**, ruff + mypy --strict + tsc + eslint + i18n parity + `pnpm build` all clean. Doc `docs/game-modes.md` Chaos section rewritten. Deferred to `docs/TODO.md`: Double-spin, Phantom-segment, and on-device tuning of the choreography constants (`MULTI_SPIN_*`, `NUDGE_*`, `SLOW_BURN_MULTIPLIER`, `CHAOS_ANNOUNCE_MS`).

### Slice 5 — Punishment v3/v4: turn-based personal-bet race (2026-05-30) — committed, pending owner deploy

Reworked Punishment again, from the v2 prediction-wager (Slice 4) into a **turn-based personal-bet race**: each present player locks one **unique** bet (a segment) before the game; players spin **in turn** with the **host always first**; landing on your own bet scores a match (first to **N** wins, host picks `N = 1/3/5/7`, `N=1` = first correct guess ends the game), landing elsewhere deals the spinner their own dare and blocks the turn until resolved. Dare resolution: **I'll do it** → a random *other* online player approves with **Yes / No** (Yes advances + increments per-player & room-wide done counters; **No reopens the dare card** and keeps the turn blocked until truly approved); **Refuse (−1)** costs a match and is offered only when the player has points; solo/offline auto-approves.

Two passes landed this session (Opus 4.8, inline — no subagent fan-out):
- **v4 polish on the prior turn-based commit** — host-selectable attempts wired through (`N=1` no longer floored to 3); **unique picks are now always-on** (per-room toggle removed; server forces `punishment_unique_bets=True` for punishment, with a fallback that allows a duplicate only when players outnumber segments so betting can't deadlock); the dare card **disappears after "Done"** (replaced by a slim approval prompt); the host settings gear stays hidden for Punishment. Removed dead `punishment_unique_bets` request plumbing (schema/endpoint/`api.ts`/picker) + 2 stale ruff violations the prior commit introduced.
- **Two real-device bug fixes** — (1) the "Spin" button showed active for *both* host and guest because the frontend derived the starter from per-client presence order; the starter is now deterministically the **host** (matches server `start_game`). (2) Approval is now **Yes / No**: added `reject_punishment` service + `punishment:reject` WS handler + store action so "No" reopens the card instead of forcing the dare through.

Backend `services/punishment.py` (`place_bet` unique+fallback, `resolve_turn`, `resolve_punishment`, `approve_punishment`, `reject_punishment`, `reset_game`), `realtime/handlers.py` (`punishment:bet/resolve/approve/reject`, turn-gated `spin:trigger`). Alembic `0011_punishment_match_race` + `0012_punishment_v4`. Frontend `features/rooms/punishment.ts` + inlined RoomPage punishment branch (PunishmentPanel removed); EN+UK i18n (`approve_prompt`, `approve_yes/no`; dropped `approve`, `unique_bets_*`). Gates green: **206 backend / 99 frontend**, backend coverage 86%. Default spin policy `turn_based`. Doc `docs/game-modes.md` rewritten for the turn-based mechanic.

### Slice 4 — Punishment v2: prediction wager (2026-05-30) — SHIPPED, superseded by Slice 5

Reworked Punishment from victim-segment into a **prediction-wager** game: each round every present player secretly predicts the landing segment; the host spins once all present have locked (or "Spin anyway"); wrong guessers each draw their own dare (per-card Done), correct = safe, all-correct = "Everyone escaped 🍀"; room-wide tally; host "New round". Server-authoritative secrecy via per-viewer redaction in `build_room_state`. Alembic 0010 (`punishment_predictions` / `punishment_cards` / `punishment_result_segment_id`; legacy `punishment_active_card` left undropped — SQLite rebuild safety). Backend `services/punishment.py` (predict/resolve/draw, one distinct card per loser); host-gated spin + resolve-at-settle; `punishment:predict` / `punishment:done` / `round:reset` events; default spin policy `host_only`. Frontend `features/rooms/punishment.ts`, `components/room/PunishmentPanel.tsx`, store actions (`predictPunishment`, `markPunishmentDone(userId)`, `triggerSpin(force)`); EN+UK i18n. Built subagent-driven (Opus); 221 backend / 109 frontend tests, all gates green. Spec `docs/superpowers/specs/2026-05-30-punishment-prediction-wager-design.md`, plan `docs/superpowers/plans/2026-05-30-punishment-prediction-wager.md`, doc `docs/game-modes.md`. Commits `5c91eab … a4b9104`. Follow-ups in `docs/TODO.md` (drop `punishment_active_card` at Stage G; hard-disconnect doesn't auto-drop a pending prediction — force-start is the escape hatch).

### Slice 3 — Elimination mode (2026-05-29) — SHIPPED
First per-mode gameplay (spec §5.2) + the `GameModeEngine` abstraction (`apps/api/src/hoba_api/modes/`: base Protocol, `ClassicEngine`, `EliminationEngine`, registry — unknown/unbuilt modes fall back to Classic). `Segment.eliminated_at` (Alembic 0005) + `SegmentOut.is_eliminated`; engine-driven `trigger_spin` (spins over living segments, dramatic 1.5× at 2 left); eliminate-at-settle + `spin:settled.mode_aftereffects`; `round:reset` host action. Frontend: living-only wheel, winner hero, eliminated greyscale strip, brand-first "Хоба!→out" reveal.

**UX pass (all modes):** single centered-hub spin control (bottom SPIN buttons removed; solo bottom CTA is now "Create room"), auto-dismiss results (no manual Close), wheel hub is a real focusable/screen-reader-announced button + reduced-motion, prominent turn banner for turn_based, ~400ms reveal delay. Env-configurable room-creation rate limit (`ROOM_CREATE_RATE_LIMIT_MAX`).

Spec `docs/superpowers/specs/2026-05-29-elimination-mode-design.md`, plan `docs/superpowers/plans/2026-05-29-elimination-mode.md`, doc `docs/game-modes.md`. Commits `a4c99e3 … 478bb84`.

### Slice 2.5 — Turn-based bug-fix pass (2026-05-29, real-device)
Fixed: turn_based lobby deadlock (client `effectiveTurnUserId` + server `user_can_spin` both seed host pre-first-spin), participant `display_name` never populated (now from joined `User.first_name` in `build_room_state`), lobby→active not broadcast (`on_spin_trigger` now emits `room:updated`), header icons shrinking behind the mode badge. Commits `bd82ac2 … bf1faba`.

### Slice 2 — Mode-picker UI (2026-05-29)
Bottom sheet on Invite tap with 4 modes (Rigged stays for long-press reveal per spec §5.5). `GameModeBadge` in RoomPage header. `RoomSettingsSheet` gains `turn_based` as third option. PATCH endpoint extended to broadcast `current_turn_user_id` delta. EN + UK locales for all new strings. Spec `docs/superpowers/specs/2026-05-29-mode-picker-ui-design.md`. Commits `e6c47ba … 81092cd`.

### Slice 1 — Turn-based foundation (2026-05-28)
Backend `turn_based` spin policy + mode-default `spin_policy` derivation. Alembic 0004 added `current_turn_user_id` to rooms; `advance_turn` helper, `user_can_spin` dispatch, `_emit_settled` advance + `room:updated` broadcast, `update_room` cursor lifecycle. Frontend `computeCanSpin` turn_based branch, new `computeTurnState` helper, room-header status line in EN + UK. Spec `docs/superpowers/specs/2026-05-28-turn-based-mode-defaults-design.md`. Commits `6a91c46 … 023b6f3`.

### Stage D production deploy notes (2026-05-29)
Production live on `hobagame.duckdns.org` (Hetzner shared VPS, host nginx TLS terminator, containers on `127.0.0.1:8800/5800/6800`; static-bundle webapp). Test totals at this point: **164 backend / 82 frontend**, 91% coverage. The 2026-05-29 deploy uncovered 4 production-only issues (uvicorn `--reload` loop, Alembic `batch_alter_table` FK naming, partial-migration corruption, sudo-rm-while-container-running no-op) — all fixed and folded into `docs/deployment.md` § 9b "Troubleshooting recipes" + tracked as Stage G items in `docs/TODO.md`. See `docs/validation-notes.md` § Owner-side deploy + verification — 2026-05-29.

---

## Stage C — deploy chain (2026-05-27)

Production deploy hit a shared VPS that already ran an unrelated site on its public-facing nginx. Soft-launch path landed across 7 commits, several of which were on-the-fly fixes to the deploy walkthrough as friction surfaced:

- `0756782 → 75bd608` — shared-VPS deployment groundwork: `compose.shared.yaml` with `!override` ports + Caddy disabled, `infra/nginx/hoba.conf` server block (proxy_pass to `127.0.0.1:8800` for `/api/`, `/socket.io/`, `/openapi.json`; `127.0.0.1:5800` for the SPA), `docs/deployment.md` rewritten with both dedicated- and shared-VPS flavours.
- `a6ce1af` — Vite `allowedHosts` extended to cover `.duckdns.org` + a `VITE_ALLOWED_HOSTS` env hook for future custom domains. First-deploy Vite quirk: 403 on the new hostname.
- `2050774` — multi-stage Dockerfile pulled forward from Stage G. Vite dev server proved unreliable in prod (allowedHosts 403, then a 9 s hang during a HEAD request that Telegram aborted with "Operation was cancelled"). Webapp container is now `nginx:1.27-alpine` serving a pre-built static bundle from `pnpm build`. `apps/webapp/nginx.conf` handles SPA fallback + immutable-asset cache headers. `docker-compose.yml` pins the dev target explicitly so local workflow is unchanged.
- `c0a591e` — anchored the rsync excludes in `docs/deployment.md` after the unanchored `--exclude=data` collateral-deleted `apps/webapp/src/data/quickWheels.ts` from the server.
- `acd2c62` — `docs/privacy.md` for BotFather's Privacy Policy field.
- `2c156f7` — `docs/deployment.md` smoke-test paths fixed (FastAPI serves `openapi.json` at root, not `/api/v1/openapi.json`).
- BotFather (manual, owner-side) — name `Hoba!`, About + Description in EN, command list, profile pic, Direct Link Mini App `play` URL, Privacy Policy URL — all set against `https://hobagame.duckdns.org/`.

Stage C closed 2026-05-28 with owner-override GO on Phase 7+.

---

## Stage B — pre-launch hardening (2026-05-27)

9 items across 9 commits:

1. ✅ **B1 — server rate limits + spin cooldown.** New `cooldown_take(key, ttl_ms)` Redis primitive (SET NX PX); `on_spin_trigger` enforces 1.5 s/room cooldown + 30 spins/room/hour; `POST /api/v1/rooms` enforces 5/user/hour. +8 backend tests (`tests/services/test_cooldown.py`, `tests/api/test_rooms.py`, `tests/realtime/test_handlers.py`). Commit `f723a0f`.
2. ✅ **B2 — brand-keyed crash screen.** `AppErrorBoundary` reduced to React boundary plumbing; visible UI moved to functional `CrashScreen` with locale-aware copy + reload CTA + collapsible technical details. New `common.crash.{title,description,reload,details_label}` (EN + UK). Commit `d87371b`.
3. ✅ **B3 — enableClosingConfirmation in active rooms.** New `enableClosingConfirmation` / `disableClosingConfirmation` helpers in `lib/telegram.ts`; `RoomPage` wires them on `snapshot.room.status === "active"` only (lobby + closed are fine to swipe away). Commit `e1c16d0`.
4. ✅ **B4 — empty states.** Audit showed `HomePage` `my_wheels`, `LibraryPage` (via `StubPage`), and the `EmptyState` DS component already cover the charter; no new work needed. Closed without a code commit.
5. ✅ **B5 — Aurora background.** Mounted globally in `RootLayout`. `fixed inset-0 -z-10`, pure CSS — no per-page boilerplate. Commit `e6916bd`.
6. ✅ **B6 — host settings sheet.** New `RoomSettingsSheet` (bottom sheet) + `isHost(snapshot)` helper (+2 tests) + `api.patchRoom` + `useRoomStore.setSnapshot`. Host-only ⚙️ button next to share. Toggle "Everyone in the room" / "Only me (host)". REST PATCH refreshes calling host's snapshot; guest broadcast queued for Stage C. Commit `ac7dab2`.
7. ✅ **B7 — 360 px audit.** Static review surfaced no fixed widths that breach 360 px; checklist for real-device pass in `docs/manual-verify-stageB.md` §6. Commit `c02cc64`.
8. ✅ **B8 — prod compose boot check.** `docker compose --profile prod config` parses cleanly; the webapp dev-server-as-prod limitation deferred to Stage G via `docs/TODO.md`. Commit `544fa6d`.
9. ✅ **B9 — BotFather pre-launch checklist.** Owner-driven steps scripted in `docs/manual-verify-stageB.md` §7 (name, photo, about, description, commands, menu button, Direct Link Mini App URL). Commit `c02cc64`.

### Stage B verification-pass fix (2026-05-27)
10. ✅ **B6 follow-up — stale guest UI on policy change.** Real-device test surfaced three coupled bugs: server emitted `not_allowed_to_spin` but the locale was missing it; the cooldown check ran before the permission check so a guest's rejected tap burned the per-room cooldown; and connected guests' UIs never learned about the host's `PATCH` because the REST endpoint didn't broadcast. Fix: localized error (EN+UK), reordered `on_spin_trigger` (permission first, throttles second), `PATCH /api/v1/rooms/{code}` now emits `room:updated { patch }`, client store merges into `snapshot.room`. Commit `3f4dbeb`.
11. ✅ **Back button dead for deep-link entrants.** Guest opening `t.me/hobagame_bot?startapp=room_<CODE>` couldn't navigate back from `/room/<CODE>`. Cause: `RootLayout`'s deep-link auto-navigate uses `replace: true` so `window.history.length === 1`; `navigate(-1)` is a no-op. New `lib/navigation.ts` `safeNavigateBack(navigate)` checks history length and falls back to `navigate("/")`. Wired into all 5 call sites. +3 unit tests. Commit `150b323`.

**Stage B test totals:** 113 backend / 53 frontend, 91% backend coverage. mypy --strict, ruff, eslint, tsc, i18n:check all green.

---

## Stage A — close-out (2026-05-26)

### Original roadmap items (5)
1. ✅ Share deep-link auto-navigate fixed in `lib/startParam.ts` (SDK → hash → query fallback) + `RoomPage.handleShare` uses `buildRoomInviteLink` with optional Direct Link short_name from `VITE_TELEGRAM_APP_SHORT_NAME`. Commit `b873a00`.
2. ✅ Redis `tg_id → user_id` cache: `services/users.resolve_telegram_user` + `cache_user_after_commit`; 15 min TTL; HTTP auth dependency + WS connect both wired. Commit `b873a00`.
3. ✅ New `room` namespace in EN + UK; all `RoomPage` / `SpinPage` / `ReactionsBar` hardcoded strings removed; error codes map through `room.errors.*` with fallback. Commit `b873a00`.
4. ✅ `scripts/i18n-check.mjs` — EN ↔ UK key parity + referenced-key coverage; failure-on-divergence verified. Commit `b873a00`.
5. ✅ Realtime + Redis tests via `FakeSocketIO` + `fakeredis.aioredis` autouse fixture; coverage gate back to global 80%. Commit `b873a00`.

### Verification-pass fixes (6, found during real-device testing)
6. ✅ Docs split: README rewritten as a landing page; runtime composition → `docs/architecture.md`; local setup → `docs/development.md`; test layout + manual verification → `docs/testing.md`. Commit `6ef70a4`.
7. ✅ `VITE_TELEGRAM_BOT_USERNAME` + `VITE_TELEGRAM_APP_SHORT_NAME` piped through `docker-compose.yml` to the webapp container (env vars existed in `.env.example` but weren't reaching Vite at runtime). Commit `6b72946`.
8. ✅ Host detection bug: `RoomPage` was comparing Telegram tg_id against internal DB `user_id`. Added `me_user_id` to `RoomState` DTO. Commit `7db1b0a`.
9. ✅ UK locale rewrite: "Куди їсти?" → "Що поїсти?", ICU plurals for participant count (учасник/учасники/учасників), "Господар" → "Ведучий" in spin hint, ~15 other natural-language fixes. Commit `4efb510`.
10. ✅ `+ Invite friends` CTA now visible on the solo idle screen (was only post-settle). Commit `bfdca38`.
11. ✅ Wheel hub tap fully wired in rooms (was missing `onSpinClick` prop on `<Wheel>` in `RoomPage`) + `SPIN` label localized via `t('common:actions.spin')`. Commit `d425a7a`.
12. ✅ Default `spin_policy` flipped from `host_only` to `anyone` (model + service + REST schema + Alembic `0003`). Party-game social fit. Existing rows untouched. Commit `00f3c21`.

### Close-out batch (2026-05-27, 9 items)
13. ✅ Wheel hub stays tappable across `idle → spinning → settled` and respects spin permission. New `features/wheel/hubLogic.ts` (`isHubInteractive`) + 5 tests. Commit `31a23e8`.
14. ✅ `features/rooms/permissions.ts` (`computeCanSpin`) extracted from `RoomPage` + 7 tests — regression guard for the tg_id-vs-user_id bug. Commit `c5334ee`.
15. ✅ BotFather Direct Link Mini App `spin` deleted; `play` matched `VITE_TELEGRAM_APP_SHORT_NAME`. `docs/botfather-setup.md` §8 aligned. Commit `0756782`.
16. ✅ `docs/manual-verify-stageA.md` backfilled with two-device verification record. Stale ngrok README TODO closed. Commit `55b9ff3`.
17. ✅ Top-of-room Share Button overflowed the iPhone X viewport (UK ~56 px off-screen). Converted to `IconButton` 📤 with localized text in `aria-label`. Commit `7e21a85`.
18. ✅ Wheel spin lag on iPhone X (A11, iOS 16) — replaced `feGaussianBlur` ring-glow filter with three stacked solid strokes (18/12/6 px, decreasing opacity). Pure compositor path. **Pending iPhone X verification.** Commit `33a976b`.
19. ✅ Flying reactions emerged at random horizontal positions. New `features/rooms/reactionLanes.ts` gives each emoji a fixed lane + ±2.5% jitter. 5 tests. Commit `798788f`.
20. ✅ `RoomCodePill` default size tightened (`text-3xl`→`text-2xl`, looser→`tracking-[0.3em]`, smaller padding) — ~175 px instead of ~220 px on iPhone X. Commit `6dbfbe0`.
21. ✅ Three hardcoded EN strings in `RoomCodePill` localized through `room.code_pill.*` (EN + UK). Commit `0fb392c`.

**Stage A test totals:** 102 backend / 48 frontend, 92% backend coverage. mypy --strict, ruff, eslint, tsc, i18n:check all green.

---

## Shipped foundation (Phases 1–6)

- **Phase 1** — monorepo + docker-compose (redis, api, bot, webapp) + `.env.example`.
- **Phase 2** — User model, Alembic, FastAPI app, initData validation, `/api/v1/me`.
- **Phase 3** — aiogram bot, all commands, deep-link parsing for `room_<CODE>`.
- **Phase 4** — Vite/React/TS Mini App, full DS at `/dev/ds`, i18n EN + UK (6 namespaces), Home with Quick Wheels (F2).
- **Phase 5** — `<Wheel>` + solo spin flow + audio + custom wheel editor + spin history.
- **Phase 6** — Rooms REST (`/api/v1/rooms`), Socket.IO `/rooms` namespace, server-authoritative spin, presence, reactions, share-link generation + delivery (delivery fixed in Stage A item 1, commit `b873a00`).
