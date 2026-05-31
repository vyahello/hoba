# TODO

Tracked TODOs per `CLAUDE.md` rule 8 ("No TODOs without entry in `docs/TODO.md`").
Format: `- [ ] phase:N — area — description (owner, date)`. Resolve by deleting the line.

- [ ] stage:F — trending (carry-over) — make-public publishes with `category=null` (no picker in the Library UI), so user wheels only ever surface under the "All" trending tab, never under a specific category chip. Backend already accepts + validates `category` on `POST /wheels/{id}/publish`; add a small category chooser (sheet or inline chips) to the Library make-public action so the category filter is useful for user-generated wheels. Polish, not a blocker.
- [ ] stage:F — moderation (carry-over) — report flow auto-hides at 3 distinct reporters but there's no admin review/un-hide UI (spec §14 "manual queue UI later"). An `is_hidden` wheel is invisible to everyone including its owner on trending, and there's no endpoint to list/restore reported wheels. Add an admin moderation endpoint (Phase 11/12) before this matters at scale.
- [ ] stage:G — deploy — `apps/api/Dockerfile` `CMD` hardcodes `uvicorn --reload`, fine for dev but caused a production outage during the 2026-05-29 mode-picker deploy when watchfiles started seeing `/app/.venv` changes and looped. Currently mitigated by `command:` override in `compose.shared.yaml`. Proper fix: add a `prod` target to `apps/api/Dockerfile` (matching the `dev`/`prod` multi-stage pattern already in `apps/webapp/Dockerfile`) that runs uvicorn without `--reload`; then `shared.yaml` override can be removed. See `docs/deployment.md` § 9b "Uvicorn restart loop".
- [ ] stage:G — migrations — add a `naming_convention` to `MetaData` in `apps/api/src/hoba_api/models/_base.py` so all auto-generated constraint names are deterministic (`fk_<table>_<column>_<reftable>`, etc.). Today migrations that touch FKs must either (a) name the constraint explicitly via `sa.ForeignKey(..., name="...")` or (b) avoid `batch_alter_table` entirely under SQLite. Anonymous FKs blow up the SQLite rebuild path with `ValueError: Constraint must have a name` (hit during 2026-05-29 deploy of Alembic 0004, fixed via switch to plain `op.add_column`). See `docs/deployment.md` § 9b "Alembic batch_alter_table FK".
- [ ] stage:G — observability — structlog's stdlib redirect swallows uvicorn lifespan tracebacks. When startup raises, the container exits with code 3 but the actual exception never reaches the logs — operator only sees the migration-start line followed by silence. Today's workaround: run `alembic upgrade head` as a one-shot with `-e AUTO_MIGRATE=false` to bypass structlog. Proper fix: configure structlog so unhandled exceptions during lifespan are formatted + emitted before the process exits. See `docs/deployment.md` § 9b "Lifespan exit code 3".
- [ ] stage:G — migrations — drop the deprecated `punishment_active_card` column on `rooms` (superseded by `punishment_cards` in Alembic 0010; left undropped to avoid a SQLite batch table-rebuild on the live DB). Safe to drop during a Postgres consolidation, or once the `naming_convention` MetaData fix above makes batch rebuilds reliable.
- [ ] stage:D — punishment — a hard socket disconnect (no explicit `room:leave`) does not auto-drop a pending prediction in Punishment v2, so a ghost can keep "waiting on …" non-empty; the host "Spin anyway" force-start is the intended escape hatch. Revisit if real-device testing shows it's annoying — drop-on-disconnect needs a clean DB session in the disconnect path.
- [ ] stage:F — chaos (carry-over) — two spec §5.4 events still deferred: **Double-spin** (two fully-counted results — needs a 2-result settle payload) and **Phantom segment** (ephemeral non-DB 13th segment — needs a wire shape + client render for a segment with no id). Add a follow-up slice if playtests want more variety. Shipped 8 events: multi_spin, slow_burn, reverse, swap, nudge ↔, blind_pointer, roaming_pointer.
- [ ] stage:F — chaos (carry-over) — **feedback-driven animation tuning** of the Chaos choreography constants: `MULTI_SPIN_STEP_MS`/`MULTI_SPIN_FINAL_MS` + `NUDGE_SHAKE_MS`/`NUDGE_CREEP_MS` (`RoomPage.tsx`), `buildRoamHops` hop pace (`features/rooms/chaos.ts`), and `SLOW_BURN_TURNS` + the slow-burn ease (`modes/chaos.py` / wheelSpin). Written blind; adjust as the owner gives device feel notes.

## Resolved in Stage A (2026-05-26)

- [x] phase:6 — share — `RootLayout` now reads `start_param` from SDK → URL hash → URL query (the SDK at v7.10.1 ignores top-level `tgWebAppStartParam`); share link builder supports the optional Direct Link Mini App `/<short_name>?startapp=` form via `VITE_TELEGRAM_APP_SHORT_NAME`.
- [x] phase:6 → phase:2 — auth — Redis `tg_id → user_id` cache (15 min TTL) wired into the auth dependency + WS connect.
- [x] phase:6 — tests — Socket.IO handlers + Redis client now covered (94% / 96%) via a `FakeSocketIO` test double in `tests/realtime/test_handlers.py` and `fakeredis` autouse fixture.
- [x] phase:11 → stage:A — i18n — `pnpm i18n:check` now enforces EN ↔ UK parity + referenced-key coverage (`scripts/i18n-check.mjs`).

## Resolved in Stage A close-out (2026-05-27)

- [x] stage:A — wheel — hub button now stays tappable across the idle → spinning → settled cycle and respects the spin permission (no SPIN affordance for guests in host_only rooms). Pure `isHubInteractive()` helper with five unit tests. Commit `31a23e8`.
- [x] stage:A — rooms — `computeCanSpin(snapshot)` extracted from `RoomPage` with seven unit tests covering anyone / host_only / turn_based / -1 sentinel / unknown user_id. Regression guard for the tg_id-vs-user_id bug fixed in `7db1b0a`. Commit `c5334ee`.
- [x] stage:A — docs — BotFather short_name aligned to `play` (the `spin` Direct Link Mini App was deleted to remove the duplicate). Commit `0756782`.
- [x] stage:B → stage:A — networking — README delegates the ngrok walkthrough to `docs/development.md` "Dev tunnel for real Telegram testing"; the original TODO line is now stale and removed in this entry.

## Resolved in Stage B (2026-05-27)

- [x] stage:B — moderation — host toggle in Room settings sheet to flip `spin_policy`. Shipped as `RoomSettingsSheet` (bottom sheet) + `isHost(snapshot)` helper + `api.patchRoom` + `useRoomStore.setSnapshot`. Commit `ac7dab2`.
- [x] stage:B — anti-spam — server-side cooldown on `spin:trigger` via new `cooldown_take(key, ttl_ms)` Redis primitive (1.5 s/room + 30 spins/room/hour) + room-creation throttle (5/user/hour). Commit `f723a0f`.
- [x] stage:C → stage:B — broadcast — `room:updated` Socket.IO event from `PATCH /api/v1/rooms/{code}` so guests pick up host policy changes without reconnect. Closes the Stage C carry-over. Commit `3f4dbeb`.

## Resolved in Stage C deploy chain (2026-05-27)

- [x] stage:G — deploy — multi-stage Dockerfile static build serving via `nginx:1.27-alpine` in-container (Vite dev server proved unreliable in prod). Pulled forward from Stage G because the soft-launch path needed it. `apps/webapp/nginx.conf` handles SPA fallback + immutable-asset caching. Commit `2050774`.

## Resolved in Stage C close (2026-05-28)

- [x] stage:C — verify — iPhone X spin-lag fix (commit `33a976b`, stacked-strokes replacement for feGaussianBlur ring-glow filter). Confirmed smooth on real iPhone X (A11, iOS 16) during owner-side verification — see `docs/validation-notes.md` § Owner-side verification — 2026-05-28.

## Resolved in Stage D foundations (2026-05-28)

- [x] stage:D — modes — `turn_based` spin policy shipped end-to-end. Backend: `current_turn_user_id` column on rooms (Alembic 0004), `advance_turn` helper (presence-aware skip), `user_can_spin` dispatch, initial cursor on lobby→active, WS `_emit_settled` advance + `room:updated` broadcast, `update_room` cursor lifecycle. Frontend: `computeCanSpin` turn_based branch, new `computeTurnState` helper, room-header status line in EN + UK. Spec at `docs/superpowers/specs/2026-05-28-turn-based-mode-defaults-design.md`; plan at `docs/superpowers/plans/2026-05-28-turn-based-mode-defaults.md`. Commits `6a91c46 … 023b6f3`.
- [x] stage:D — mode defaults — `game_mode` on `RoomCreateIn` (defaults `classic`), `spin_policy` optional with `_derive_spin_policy` fallback (Elimination→host_only, Punishment→turn_based, Chaos→anyone, Rigged→host_only). Explicit user value wins. Commits `9bd462f`, `cfeb648`, `2490e95`.

## Resolved in Stage D mode-picker UI (2026-05-29)

- [x] stage:D — mode picker UI — mode-picker bottom sheet on `+ Invite friends` (4 modes: Classic / Elimination / Punishment / Chaos; Rigged stays for long-press reveal per spec §5.5). `GameModeBadge` chip in RoomPage header (hidden for Classic, defensive null for Rigged). `RoomSettingsSheet` gets `turn_based` as a third spin_policy option. New `data/gameModes.ts` is the single source of truth for mode metadata (10 unit tests). PATCH endpoint now broadcasts `current_turn_user_id` delta alongside the patch dict so guests pick up cursor changes from mid-room policy flips without a reconnect. EN + UK locales added for `room.modes.*`, `room.mode_picker.*`, `settings.spin_policy.turn_based`. Spec at `docs/superpowers/specs/2026-05-29-mode-picker-ui-design.md`; plan at `docs/superpowers/plans/2026-05-29-mode-picker-ui.md`. Commits `e6c47ba … 81092cd` (+ deploy fixes `7d9f70b`, `0bf737f`).

## Resolved in Stage D — Elimination mode + UX pass (2026-05-29)

- [x] stage:D — turn-based bug fixes (real-device) — turn_based lobby deadlock (host couldn't take the first spin: client `effectiveTurnUserId` + server `user_can_spin` now seed host pre-first-spin), participant `display_name` populated from joined `User.first_name`, lobby→active broadcast via `on_spin_trigger`, header-icon shrink behind the mode badge. Commits `bd82ac2 … bf1faba`.
- [x] stage:D — Elimination mode (spec §5.2) — `GameModeEngine` abstraction (`apps/api/src/hoba_api/modes/`: base Protocol, `ClassicEngine`, `EliminationEngine`, `registry`; unknown modes fall back to Classic). `Segment.eliminated_at` (Alembic 0005) + `SegmentOut.is_eliminated`; engine-driven `trigger_spin` (spins over living, 1.5× dramatic at 2 left); eliminate-at-settle + `spin:settled.mode_aftereffects`; `round:reset` host action. Frontend: living-only wheel, winner hero, eliminated strip, brand-first reveal. Spec `docs/superpowers/specs/2026-05-29-elimination-mode-design.md`; plan `docs/superpowers/plans/2026-05-29-elimination-mode.md`; doc `docs/game-modes.md`. Commits `a4c99e3 … 8a47a36`.
- [x] stage:D — room UX pass (all modes) — single centered-hub spin control (bottom SPIN buttons removed; solo bottom CTA = "Create room"), auto-dismiss results (no manual Close), wheel hub is a real focusable/screen-reader-announced `<button>` + reduced-motion, prominent turn banner for turn_based, ~400 ms reveal delay, solo result-overlay timer-clear fix. Commits `6c72793 … 4d6edc0`.
- [x] stage:D — env-configurable room-creation rate limit — `ROOM_CREATE_RATE_LIMIT_MAX` / `_WINDOW_SECONDS` in settings + `.env.example`, wired through docker-compose `environment:`; default 5/hr (prod), set to 1000 on the VPS `.env` for testing. Commits `4328e7c`, `478bb84`.
