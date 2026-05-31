# Hoba! — Execution Roadmap

> Operational layer over `docs/spec.md`. The spec is the *what*; this file is the *next-N-stages order of operations*. Both live in the repo; this one rotates as we ship.
>
> Updated: 2026-05-28 (Stage A + B + C deploy chain reflected).

---

## Where we are right now

**Stage C open with NO-GO on Phase 7+** (recorded 2026-05-28). Stages A + B + C shipped on top of the Phase 6 MVP commits `dbbf570 … 559d534`. Stage A closed the original five MVP blockers plus six verification-pass fixes plus a nine-item close-out batch (multiplayer invite flow lands, RoomPage i18n cleared, hub-tap regression guards, etc.). Stage B added pre-launch hardening (server rate limits + spin cooldown, brand-keyed crash screen, host settings sheet, `room:updated` broadcast). Stage C deployed to `hobagame.duckdns.org` (Hetzner shared VPS, host nginx as TLS terminator, multi-stage Dockerfile pulled forward from Stage G), but no soft-launch sessions were logged — the verdict in `docs/validation-notes.md` is **NO-GO**, rationale = insufficient real-user evidence.

Test totals at the current freeze: **113 backend / 53 frontend, 91 % coverage**.

The spec calls Phase 6 the **🚢 MVP ship point** — Stage C is its validation gate. Phase 7 work is gated on either real-device session data or an explicit owner override.

---

## Stages

> Each stage ends like a phase: tests green, file-tree diff, manual verify checklist, `STAGE X COMPLETE`. Owner says `go on stage X` to advance. No auto-advance.

### Stage A — Close Phase 6 MVP blockers

The Phase 6 commit shipped, but `docs/TODO.md` carries five unresolved items that together prevent a clean two-device demo and break UK locale parity in the room. This stage closes them and *only* them.

**A1 — Multiplayer share deep-link actually delivers (TODO.md:6).**
Repro: host taps Share → recipient taps `t.me/hobagame_bot?startapp=room_<CODE>` message → Mini App opens but does **not** auto-navigate to `/room/<CODE>`. Probable causes (in order of suspicion):
  1. Telegram delivers `start_param` differently for Direct Link Mini Apps vs menu-button launches; `RootLayout`'s effect only reads `initDataUnsafe.start_param` and may need fallback to URL `?tgWebAppStartParam=`.
  2. The `WEBAPP_URL` registered with BotFather drifts from the running tunnel between sessions.
  3. The auto-navigate effect (`RootLayout.tsx:21-31`) may fire before `WebApp.ready()` settles, so `start_param` is still undefined.
Acceptance: cold open of `t.me/hobagame_bot?startapp=room_TEST01` on a second physical device lands the user inside `/room/TEST01` with the room state painted, `room:participant_joined` fires on the host's socket, both wheels animate in sync on a manual spin.

**A2 — Redis `tg_id → user_id` cache (TODO.md:5, deferred since Phase 2).**
Every WS reconnect re-runs `upsert_from_telegram` on the hot path. Add a 15 min TTL cache keyed by `tg_id` returning `user_id`. Invalidate on profile-edit (none today; just set on hit). Hook into both `auth.dependencies.get_current_user` and `realtime.handlers._authenticate`.
Acceptance: WS reconnect under load skips the DB upsert when the cache is warm; new tests cover hit / miss / TTL-expiry paths.

**A3 — RoomPage i18n parity (audit).**
`apps/webapp/src/pages/RoomPage.tsx` ships these untranslated strings today: `"Share"` (line 224), `"Host spins. React with the bar above."` (245), `"in room"` (202). Plus the room-flow namespace is missing from `apps/webapp/src/locales/{en,uk}/`. Add `room.json` to both locales, route every literal through `t()`, audit `SpinPage`, `RoomPage`, `CreatePage`, `LibraryPage` for the same drift. Document UK + EN strings for: share CTA, "in room" count, host-only spin notice, reactions caption, share-link toast title + description, ApiError mapping (`create_failed`, `room_not_found`, `rate_limited`, `not_host`, `room_closed`, …).
Acceptance: `grep -RE "\"[A-Z][a-zA-Z ]{2,}\"" apps/webapp/src/pages` returns zero non-translated UI strings; manual switch EN ⇄ UK in `/settings` flips every visible string in solo and multiplayer flows.

**A4 — Wire up `pnpm i18n:check` (TODO.md:9).**
Replace the stub with `i18next-parser` configured against `apps/webapp/src/locales/{en,uk}/*.json`. CI fails when keys diverge between locales or unused keys accumulate.
Acceptance: deleting a key from one locale fails the check; the script is wired into the package.json `lint` step.

**A5 — WS handler + Redis client test coverage (TODO.md:7).**
Today both are excluded. Add an async test harness using `fakeredis` and `python-socketio.AsyncClient` (test mode). Cover: connect with valid initData, connect rejected on bad initData, room:join happy path, room:join on closed room, spin:trigger as host (allowed) vs guest (denied under `host_only`), reaction:send rate-limited at 11th in 30s, disconnect emits `room:participant_left`.
Acceptance: `pytest --cov` shows realtime + redis_client modules at ≥80% line coverage; `mypy --strict` still green.

**End-of-stage gate:** all five items closed, all CLAUDE.md quality gates green, two-device manual test recorded in `docs/manual-verify-stageA.md`. Then `STAGE A COMPLETE`.

#### Stage A verification-pass fixes (closed in same stage, 2026-05-26)

Hands-on Telegram testing after the five-item close surfaced six more bugs that block the same MVP goal. They were fixed in Stage A rather than punted to Stage B because they all fall under "make multiplayer + solo work in EN+UK on real devices" — the literal stage charter:

- Docs split into `architecture.md` / `development.md` / `testing.md`; README rewritten as a landing page (`6ef70a4`).
- `VITE_TELEGRAM_*` env vars wired through `docker-compose.yml` (`6b72946`).
- **Host detection bug** (`7db1b0a`): RoomPage compared Telegram `tg_id` against internal DB `user_id`. Server now returns `me_user_id` on `RoomState`. Lesson: client-side state checks need server-provided identity, never `initDataUnsafe.user.id`.
- UK locale rewrite for natural Ukrainian + proper ICU plurals (`4efb510`).
- `+ Invite friends` CTA on solo-idle screen (was post-settle only) (`bfdca38`).
- Wheel hub tap wired in RoomPage + `SPIN` label localized (`d425a7a`).
- **Default `spin_policy` flipped `host_only` → `anyone`** (`00f3c21`, Alembic `0003`). Party-game social fit. Existing rows untouched. Stage B has the host-toggle UI queued.

Closing rule going forward: bugs found in stage verification belong to that stage, not the next.

---

### Stage B — Pre-launch hardening (compressed Phase 11 + Phase 12 minimum)

Goal: a real-friend can install the bot, share the link, both languages work, nothing crashes on touch. Cherry-pick the subset of Phase 11/12 work needed to invite ~20 real users without embarrassment. Bigger Phase 11/12 (full moderation toolkit, profile photos, deploy script polish) waits until after Stage D.

- Aurora background, empty states for solo history, library placeholder, settings.
- Error boundary catches unhandled WS / route errors; user sees the brand-keyed error screen, not a white page.
- `enableClosingConfirmation` on active rooms only.
- Audit every screen at 360px width on real Android + iPhone Safari (still ngrok in dev).
- Server-side rate limits per spec §14 §7: spin trigger (host 1/3s), reactions (already done in handlers — verify), room creation (5/min/user).
- `pytest`, `ruff`, `mypy --strict`, `eslint`, `tsc --noEmit`, `i18n:check` all green.
- Production `docker-compose --profile prod up` with Caddy auto-TLS on env-driven hostnames boots cleanly against a dummy VPS (verified locally with a hosts-file trick or staging VPS).
- BotFather: bot profile photo (Latin `Hoba!` logo from `docs/brand/`), Description + About in EN, command list per spec §6.

**End-of-stage gate:** fresh-clone `docker compose up` → working bot → working webapp → joinable room from a second device → both languages flip cleanly → no console errors over a 5-minute play session.

---

### Stage C — Soft-launch + validation

Deploy to a small VPS (Hetzner / DigitalOcean / wherever; the prod compose profile is already designed for this). Invite 10–20 friends, schedule two short play sessions, collect:

- Console + Sentry errors.
- Subjective feedback on the brand-word moment (does the Hoba! / Хоба! land?).
- Whether anyone tries to invite a second person and fails.
- Which game mode they ask for first (signal for prioritizing Phase 7 order vs jumping to Phase 8 Rigged).

No code work in this stage — only telemetry review and a `docs/validation-notes.md` file capturing what we heard. Stage exits when we have a written go/no-go on Phase 7+.

---

### Stage D — Phase 7: Classic + Elimination + Punishment + Chaos modes — ✅ STAGE D COMPLETE (2026-05-31)

Per spec §5 + §15 Phase 7. Implemented the `GameModeEngine` interface (`apps/api/src/hoba_api/modes/`) + mode picker + mode badge + per-mode UI. Delivered:

- **Elimination** — winning segment shatters off, list shrinks, `eliminated_at` + `round:reset`. *(as planned)*
- **Punishment** — turn-based personal-bet race (lock a unique bet → spin in turn → hit = match → first to N wins; miss = a dealt dare, resolved by a random approver's Yes/No or Refuse −1). **Scope shifted** from the original "deck card on every spin" to a personal-bet race during execution (v2 prediction-wager → v3/v4 race); the server-owned deck (3×30×EN/UK) survives as the dare source.
- **Chaos** — **scope shifted significantly**: instead of a `chaos:event` broadcast before `spin:started`, the event is **folded into `spin:started.mode_effects`**, and Chaos became a **Punishment-style bet race + a chaos event on every spin** (8 events: multi_spin, slow_burn, reverse, swap, nudge ↔, blind_pointer, roaming_pointer). Reuses Punishment's flow via `isBetRace`. turn_based only. Double-spin + Phantom-segment deferred (`docs/TODO.md`).

WS protocol grew but stayed in `/rooms` (events ride `mode_effects`, no new top-level event). `docs/game-modes.md` is the source of truth for each mode. Punishment-deck content lives in `modes/punishment_decks.py`.

**End-of-stage gate (met):** four modes playable end-to-end, mode badge visible, mode-specific sounds/haptics, `docs/game-modes.md` matches behavior, mode engines unit-tested (223 backend / 106 frontend green). Chaos + Punishment iterated on real device 2026-05-31. **Carry-overs → Stage E:** Chaos animation-constant tuning (feedback-driven), deferred Chaos events. Full close-out in `docs/changelog.md` (STAGE D COMPLETE).

---

### Stage E — Phase 8: Rigged Mode 🎭 — ✅ STAGE E COMPLETE (2026-05-31)

The legendary feature, per spec §5.5. Delivered with two slices (secret weighting + secrecy, then the reveal). **Scope notes vs the original plan:**
- **Weights live in `Segment.weight`, not Redis** — `compute_spin` already consumes that column, so weighted spins needed no engine change. Secrecy is enforced at serialization time (`build_room_state` per-viewer redaction: non-host pre-reveal sees `game_mode="classic"` + weights `1`) rather than by withholding the value from a separate store.
- **Reveal entry** is a hidden ~1.5 s long-press on the hub → `RigEditorSheet` (Rigged stays out of the room-creation picker), with a "Reveal the rig 🎭" button.
- **Ethical guard**: 🎭 stamped into the **room title** on reveal (spec's wording) rather than into each spin announcement.
- **CI fairness**: weighted RNG within ±2% over 40k picks (`test_rigged.py`).
- **Reveal**: full-screen takeover (skewed Хоба! + animated weight bar-chart + rigged-spin-count + confetti). Alembic 0013 (`rigged_revealed`) + 0014 (`rigged_spin_count`).

**End-of-stage gate (met):** guests cannot distinguish a rigged room from Classic pre-reveal (server-side redaction guarantees it); the reveal lands as a full-screen moment. Gates green (232 backend / 106 frontend). The "playtest energy" is owner-verified on device; reveal animation feel is tunable. Full close-out in `docs/changelog.md` (STAGE E COMPLETE).

---

### Stage F — Phase 9 + Phase 10: Library, Saved wheels, Templates, Public + Trending + Moderation — ✅ STAGE F COMPLETE (2026-05-31)

Two phases bundled because the data model + UI work overlaps heavily. Shipped in three slices (`17c812c` saved wheels, `e1b8f4c` templates, `3394183` public/trending/moderation).

- Phase 9: ✅ 8 server-side localized built-in templates (the "expanded Quick Wheels") + `GET /templates` + `POST /rooms/from-template`; Saved Wheels CRUD (per-user `wheels` table, Alembic 0015); save-from-Create + host save-from-Room.
- Phase 10: ✅ make-public/unpublish (profanity-gated, 3/user/day), profanity filter (EN/UK/translit-RU), Trending (categories, search, like, report), auto-hide on 3 distinct reports (Alembic 0016). Admin moderation queue UI deferred to Stage G (carry-over) — report→auto-hide is live.

**End-of-stage gate (met):** F10 flows work EN + UK; profanity filter rejects a curated test list (`tests/services/test_wheel_social.py`); trending paginates + sorts by an explicit signal documented in `docs/architecture.md` (`like_count*3 + use_count`). 260 backend (85%) / 106 frontend green. **Carry-overs → Stage G:** category picker in make-public UI, admin un-hide/review UI. Full close-out in `docs/changelog.md` (STAGE F COMPLETE).

---

### Stage G — Phase 11 (full) + Phase 12: Host moderation + Final hardening + Launch — ✅ STAGE G COMPLETE (2026-06-01) · 🎉 ROADMAP COMPLETE

Delivered in three slices (`ba74992` moderation, `67cbf11` hardening, `b9af6d6` launch content+ops):
- ✅ Host moderation toolkit: kick (re-join blocked), lock, anonymous mode + nickname generator (`anon.py`), mid-room mode change, close with confirmation — all in the reworked host `RoomSettingsSheet` + native confirm + `room:kicked`/`room:closed` broadcasts.
- ✅ Hardening: input sanitization (`sanitize.py`) at every write boundary, room-cleanup task (`tasks/cleanup.py` + cron), API fuzz suite (no 5xx); replay + §14 rate limits audited (already in place).
- ✅ Launch content+ops: in-app `/privacy` + `/terms` (EN+UK), `scripts/deploy.sh`, README walkthrough + deploy section.
- ⏳ Deferred to Stage G scope but NOT built (carry-overs, not blockers): custom SVG onboarding illustrations + result share-card PNG (polish; the app already has empty states + aurora from Stage B).

> Note: the multi-stage Dockerfile static build (originally Stage G scope, Phase 12) was pulled forward into Stage C deploy chain (commit `2050774`) when the Vite-dev-in-prod path proved unreliable.

**End-of-stage gate (met):** spec §17 "Full Done" boxes that are code/content tick; the remaining boxes (staging smoke, production deploy, BotFather final config, walkthrough GIF) are the **owner-only launch checklist** in `docs/TODO.md`. 289 backend (86%) / 106 frontend green. Full close-out in `docs/changelog.md` (STAGE G COMPLETE).

---

## 🎉 Roadmap complete

All stages A→G are delivered. There is no Stage H — further work is feature requests, the polish carry-overs in `docs/TODO.md`, and the owner-only launch tasks. The product implements the full `docs/spec.md`.

---

## What this roadmap deliberately defers

- Postgres migration — SQLite is fine through Stage E; spec says we're URL-swap-ready.
- Push notifications — out of scope (Telegram Mini App lifecycle covers most of it).
- Internationalization beyond EN + UK — spec is explicit that those two are the launch set.
- Web (non-Telegram) host — Mini App only.

---

## Open clarifications for the owner

None blocking. Two things worth deciding before Stage D:

1. Will host-customizable weights (Rigged Mode) be visible to the host across reconnects, or do they reset per-session? Spec doesn't say; default to Redis-only ephemeral.
2. Punishment deck localization — same card translated, or culturally distinct cards per locale? Spec says "3 categories × 30 cards × 2 languages" which reads as the former. Default to same cards translated unless told otherwise.
