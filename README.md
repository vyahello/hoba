# Hoba!

> Telegram Mini App party game. Multiplayer "wheel of decisions" with 5 game modes (Classic, Elimination, Punishment, Chaos, Rigged 🎭). The wheel stops — **Hoba!** — and it's decided.

- **Brand:** `Hoba!` (Latin / default / EN), `Хоба!` (Ukrainian locale only). See `docs/spec.md`.
- **Bot:** [@hobagame_bot](https://t.me/hobagame_bot) (configured via BotFather; Name `Hoba!`).
- **Phase:** see `CLAUDE.md` → "Current phase".

The product + engineering specification is **`docs/spec.md`**. That is the source of truth.

## Run in 3 commands

```bash
cp .env.example .env             # then fill TELEGRAM_BOT_TOKEN from @BotFather
docker compose up                # api :8000, webapp :5173, bot polling, redis, sqlite
cloudflared tunnel --url http://localhost:5173   # in another terminal — paste returned HTTPS into WEBAPP_URL
```

Then:
- API docs: <http://localhost:8000/docs>
- Webapp: <http://localhost:5173>
- Telegram: open the bot, `/start`, tap the Web App button.

The bot service starts in **disabled (idle)** mode when `TELEGRAM_BOT_TOKEN` is empty — set the token and `docker compose restart bot` to enable polling.

## Repo layout

```
apps/
  api/         FastAPI + Socket.IO (Python package: hoba_api)
  bot/         aiogram bot         (Python package: hoba_bot)
  webapp/      React + Vite + TS Mini App
packages/
  shared-types/   TS types generated from OpenAPI (filled in Phase 2+)
docs/
  spec.md      product + engineering spec — source of truth
  TODO.md      tracked TODOs (see CLAUDE.md rule 8)
infra/
  caddy/       Caddyfile (prod profile only)
```

## Tooling

| | tool | version |
|---|---|---|
| Python | [`uv`](https://github.com/astral-sh/uv) | latest; pinned by `.python-version` to **3.12** |
| Node | `pnpm` | pinned by `.nvmrc` to **22** |
| Containers | `docker` + `docker compose` | v2+ |
| Tunnel (dev) | `cloudflared` | developer-managed, not in compose |

## Quality gates (from Phase 2)

```bash
# Python (each of apps/api, apps/bot)
uv run ruff check .
uv run mypy --strict src
uv run pytest -q

# Frontend (apps/webapp)
pnpm run lint
pnpm run typecheck
pnpm run test
```

## Phased delivery

Spec §15. MVP = Phases 1–6. **You are reading the repo after Phase 1.**

## License

Proprietary — see `LICENSE`.
