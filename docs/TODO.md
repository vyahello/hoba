# TODO

Tracked TODOs per `CLAUDE.md` rule 8 ("No TODOs without entry in `docs/TODO.md`").
Format: `- [ ] phase:N — area — description (owner, date)`. Resolve by deleting the line.

- [ ] stage:B — moderation — host toggle in Room settings sheet to flip spin_policy between anyone (default since 2026-05-26) and host_only without leaving the room. Server-side: PATCH /api/v1/rooms/{code} already accepts it; UI is missing.
- [ ] stage:B — anti-spam — server-side cooldown on spin:trigger (1.5–2s after the previous spin:settled in the same room) so thumb-mashing the SPIN hub can't shower duplicate spins. Today the only throttle is the client-side `state !== "spinning"` gate (relaxed from `!== "idle"` in commit 31a23e8), which is bypassable. Surfaced during Stage A verification; folded into Stage B because it shares scope with the broader rate-limit work already listed there (spec §14 §7).
- [ ] stage:D — modes — finish `turn_based` spin policy. services/spins.user_can_spin currently treats it as host_only. Required by Punishment + Elimination game modes (spec §5).
- [ ] stage:D — mode defaults — when a room is created with a non-Classic game_mode, override the default spin_policy: Elimination → host_only, Punishment → turn_based, Chaos → anyone, Rigged → host_only.
- [ ] stage:G — deploy — replace `apps/webapp/Dockerfile` `CMD ["pnpm", "dev"]` with a multi-stage build that emits a static bundle into `/srv` and have Caddy serve it directly (`root * /srv` + `file_server`) instead of reverse-proxying Vite. Current prod profile boots but runs the dev server — fine for the Stage C soft-launch (≤20 users), wrong for any serious traffic. Spec §15 Phase 12.
- [ ] stage:C → stage:B — broadcast — emit a `room:updated` Socket.IO event from `PATCH /api/v1/rooms/{code}` so guests pick up host policy changes without a reconnect. Today only the host's local snapshot refreshes after they flip `spin_policy` via the new settings sheet (see commit `ac7dab2`).

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
