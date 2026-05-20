# TODO

Tracked TODOs per `CLAUDE.md` rule 8 ("No TODOs without entry in `docs/TODO.md`").
Format: `- [ ] phase:N — area — description (owner, date)`. Resolve by deleting the line.

- [ ] phase:6 — auth — add Redis cache for `tg_id → user_id` (15 min TTL) per spec §6. Deferred from Phase 2: `/me` is not on a hot path, but WS reconnects in Phase 6 will be. Add then.
