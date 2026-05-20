# TODO

Tracked TODOs per `CLAUDE.md` rule 8 ("No TODOs without entry in `docs/TODO.md`").
Format: `- [ ] phase:N — area — description (owner, date)`. Resolve by deleting the line.

- [ ] phase:6 — auth — add Redis cache for `tg_id → user_id` (15 min TTL) per spec §6. Deferred from Phase 2; WS reconnects make this load-bearing.
- [ ] phase:6 — share — `t.me/hobagame_bot?startapp=room_<CODE>` deep link not landing recipients in the room. After `/newapp` in BotFather, second account still does not auto-join. Suspect: ngrok URL drift between BotFather + `.env`, or the auto-navigate in `RootLayout` not firing because Telegram passes `start_param` differently for Direct Link Mini Apps vs menu button. Repro: host creates room → taps Share → other account taps the message → Mini App opens but doesn't navigate. Pick up here next session.
- [ ] phase:6 — networking — cloudflared quick-tunnel was unreachable from iPhone Safari (page hangs); switched to ngrok. Document the ngrok dance in README for future sessions.
- [ ] phase:6 — tests — Socket.IO handlers + Redis client are excluded from coverage. Phase 11 polish: add async-IO test harness with fakeredis + python-socketio test client.
- [ ] phase:11 — i18n — `pnpm i18n:check` is a stub. Wire i18next-parser to detect missing/unused keys.
