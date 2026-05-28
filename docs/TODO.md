# TODO

Tracked TODOs per `CLAUDE.md` rule 8 ("No TODOs without entry in `docs/TODO.md`").
Format: `- [ ] phase:N — area — description (owner, date)`. Resolve by deleting the line.

- [ ] stage:D — modes — finish `turn_based` spin policy. services/spins.user_can_spin currently treats it as host_only. Required by Punishment + Elimination game modes (spec §5).
- [ ] stage:D — mode defaults — when a room is created with a non-Classic game_mode, override the default spin_policy: Elimination → host_only, Punishment → turn_based, Chaos → anyone, Rigged → host_only.
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
