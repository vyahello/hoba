# TODO

Tracked TODOs per `CLAUDE.md` rule 8 ("No TODOs without entry in `docs/TODO.md`").
Format: `- [ ] phase:N — area — description (owner, date)`. Resolve by deleting the line.

- [ ] stage:B — networking — document the ngrok dance in README (replaces cloudflared after the iPhone Safari issue). Move out of TODO once README has a clear "Dev tunnel" subsection.

## Resolved in Stage A (2026-05-26)

- [x] phase:6 — share — `RootLayout` now reads `start_param` from SDK → URL hash → URL query (the SDK at v7.10.1 ignores top-level `tgWebAppStartParam`); share link builder supports the optional Direct Link Mini App `/<short_name>?startapp=` form via `VITE_TELEGRAM_APP_SHORT_NAME`.
- [x] phase:6 → phase:2 — auth — Redis `tg_id → user_id` cache (15 min TTL) wired into the auth dependency + WS connect.
- [x] phase:6 — tests — Socket.IO handlers + Redis client now covered (94% / 96%) via a `FakeSocketIO` test double in `tests/realtime/test_handlers.py` and `fakeredis` autouse fixture.
- [x] phase:11 → stage:A — i18n — `pnpm i18n:check` now enforces EN ↔ UK parity + referenced-key coverage (`scripts/i18n-check.mjs`).
