# Development

> Running Hoba! locally, with or without Docker. Dev tunnel setup for real Telegram testing. Day-to-day debugging recipes.

For the runtime architecture (services, routes, realtime flow) see [`docs/architecture.md`](architecture.md). For tests and manual verification, see [`docs/testing.md`](testing.md).

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Docker + `docker compose` | v2+ | Easiest path. |
| Python | 3.12 | Pinned by `.python-version`. The repo has a `venv/` baked in for direct shell use. |
| Node | ≥ 22 | Pinned by `.nvmrc`. |
| pnpm | ≥ 9 | `corepack enable` brings it in. |
| `uv` *(optional)* | latest | If you don't want to use the bundled `venv`. |
| `ngrok` *(only for real Telegram)* | latest | Free tier is fine. |

---

## First-time setup

```bash
git clone <repo>
cd hoba
cp .env.example .env
# Open .env. Minimal change to start:
#   SECRET_KEY=<paste output of: openssl rand -hex 32>
# Everything else can stay default for local-only dev.
```

If you have a bot token from `@BotFather`, also set:

```env
TELEGRAM_BOT_TOKEN=123456:ABCdef...
```

Without a token, the bot service starts in **idle mode** (process running, polling disabled). The API and webapp still work for solo and local-only multiplayer testing.

---

## Run option A: Docker Compose (recommended)

```bash
docker compose up
```

Brings up four services on these ports:

- `api` → `http://localhost:8000` (Swagger at `/docs`)
- `webapp` → `http://localhost:5173`
- `redis` → `localhost:6379`
- `bot` → polls Telegram if `TELEGRAM_BOT_TOKEN` set, otherwise idle

SQLite lives at `./data/hoba.db` (volume-mounted from the host). To start fresh:

```bash
docker compose down -v   # drops Redis data volume too
rm -rf data/
```

Restart a single service after env changes:

```bash
docker compose restart bot
docker compose restart api
```

Live source: the API and webapp containers mount source directories so changes hot-reload. After a dependency change (new pip package, new pnpm package), rebuild:

```bash
docker compose build api    # or bot, or webapp
docker compose up -d
```

---

## Run option B: Bare metal (faster iteration)

When you're rapidly iterating on the API or webapp, skipping Docker is noticeably faster.

**Terminal 1 — Redis only:**

```bash
docker run --rm -p 6379:6379 redis:7-alpine
```

**Terminal 2 — API:**

```bash
cd apps/api
source ../../venv/bin/activate
export DATABASE_URL="sqlite+aiosqlite:///./data/hoba.db"
export REDIS_URL="redis://localhost:6379/0"
export SECRET_KEY="$(openssl rand -hex 32)"
export TELEGRAM_BOT_TOKEN="test-token-123:ABCdefGHIJK"   # fake; matches conftest test token
export AUTO_MIGRATE=true
uvicorn hoba_api.main:app --reload --port 8000
```

**Terminal 3 — Webapp:**

```bash
cd apps/webapp
pnpm dev    # http://localhost:5173, HMR enabled
```

The webapp's Vite dev server proxies `/api/*` and `/socket.io/*` to `http://localhost:8000` automatically — see `apps/webapp/vite.config.ts`. Override with `VITE_API_TARGET=http://other:8000 pnpm dev` if your API runs elsewhere.

---

## Dev tunnel for real Telegram testing

Telegram WebView refuses `http://localhost`. To open the Mini App from your phone, expose `:5173` over HTTPS.

**ngrok (current preference — cloudflared had iPhone Safari reachability issues during Stage A; the older TODO entry tracking the cloudflared bug was closed when we standardised on ngrok):**

```bash
ngrok http 5173
# → forwarding https://xxxxxxxxxxxx.ngrok-free.app
```

Update three places with this URL:

1. **`.env`:**
   ```env
   WEBAPP_URL=https://xxxxxxxxxxxx.ngrok-free.app
   ```

2. **BotFather** (`@BotFather` in Telegram):
   - `/mybots` → `@hobagame_bot` → `Bot Settings` → `Menu Button` → `Configure menu button`
   - URL: `https://xxxxxxxxxxxx.ngrok-free.app`
   - Button text: e.g. `Play`

3. *(Optional, for Direct Link Mini App share link form)*:
   - In BotFather: `/newapp` → choose `@hobagame_bot` → short name e.g. `play` → URL: `https://xxxxxxxxxxxx.ngrok-free.app`
   - In `.env`: `VITE_TELEGRAM_APP_SHORT_NAME=play`
   - Restart the webapp service so the build picks up the env: `docker compose restart webapp` (or kill `pnpm dev` and re-run).

Apply env changes:

```bash
docker compose restart bot api      # bot uses WEBAPP_URL for the menu button URL it serves
```

In Telegram, open `@hobagame_bot` and tap the menu button. The Mini App should load from the ngrok URL.

> **ngrok URL drift.** Free-tier ngrok issues a new subdomain every restart. Keep the tunnel terminal alive for the whole dev session. If the URL changes, update all three places above.

---

## Editing locales

EN and UK files live under `apps/webapp/src/locales/{en,uk}/<namespace>.json`. The namespaces today: `common`, `brand`, `home`, `settings`, `dev`, `create`, `room`.

**Rules** (enforced by `pnpm i18n:check`):

- Every key in EN must exist in UK (and vice versa) with the same nested path.
- Every `t("ns:key.path")` call in source must resolve to an existing EN key.
- Dynamic keys built via template literals (e.g. ``t(`room:errors.${code}`)``) are recognized — see `scripts/i18n-check.mjs`.

After editing locales:

```bash
pnpm i18n:check   # run from repo root; exits non-zero on divergence
```

The script also emits advisory `[ref] unused (maybe): …` warnings — those are not failures, they're nudges to delete dead keys (or accept that the key is reserved for a future stage).

---

## Database operations

**Inspect the SQLite file:**

```bash
sqlite3 data/hoba.db
sqlite> .tables
sqlite> .schema rooms
sqlite> SELECT id, code, host_id, status, game_mode FROM rooms ORDER BY id DESC LIMIT 5;
sqlite> SELECT id, tg_id, first_name, last_active_at FROM users ORDER BY id DESC LIMIT 5;
```

**New migration:**

```bash
cd apps/api && source ../../venv/bin/activate
alembic revision --autogenerate -m "add wheel_templates"
# Edit the generated file in alembic/versions/, review the SQL, then:
alembic upgrade head
```

Reset DB without losing tracked migrations:

```bash
rm data/hoba.db
# API restart → AUTO_MIGRATE=true reapplies everything from scratch
```

---

## Redis operations

```bash
docker exec -it $(docker ps -q -f ancestor=redis:7-alpine) redis-cli

> KEYS user:tg:*          # cached tg_id → user_id mappings
> GET user:tg:42
> TTL user:tg:42          # should be ≤ 900 (15 min)
> KEYS presence:*         # live participants per room
> KEYS react:*            # active rate-limit windows
> FLUSHDB                 # wipe everything (safe — no persistent data lives here)
```

---

## Logs

Structured JSON (structlog), one event per line, always carries `event`, `room_id` (when applicable), `user_id` (when authenticated). No PII (no usernames, no full names).

```bash
docker compose logs api --tail 100 -f
docker compose logs bot --tail 100 -f
docker compose logs webapp --tail 100 -f
docker compose logs -f                 # all of them, interleaved
```

Filter by event in production by piping to `jq`:

```bash
docker compose logs api | jq -c 'select(.event == "ws.room.join")'
```

---

## Debugging recipes

### "WebSocket connects then immediately disconnects"

The connect handler in `apps/api/src/hoba_api/realtime/handlers.py` returns `False` if `initData` is missing or signature mismatched. Verify:

```bash
docker compose logs api | grep "ws.auth.rejected"
```

Common cause: bot token in API container doesn't match the token Telegram used to sign `initData` (e.g. you rotated the token but only restarted the bot service).

### "Deep-link recipient lands on home, not the room"

The bug Stage A fixed. If it regresses:

1. Check the share URL form. The current builder is `apps/webapp/src/lib/startParam.ts` → `buildRoomInviteLink`. Without `VITE_TELEGRAM_APP_SHORT_NAME`, it emits the menu-button form `t.me/<bot>?startapp=room_<CODE>`.
2. Check the launch surface. In the receiving Mini App's DevTools (Telegram Desktop allows web inspection via `--remote-debugging-port`):
   ```js
   window.Telegram.WebApp.initDataUnsafe.start_param   // SDK source
   window.location.hash                                // hash source — should contain tgWebAppStartParam=...
   ```
3. Confirm `RootLayout` ran its effect — add a `console.log` next to the `readStartParam()` call.
4. If using a Direct Link Mini App, confirm `WEBAPP_URL` (env) and BotFather's `/newapp` URL match exactly.

### "Spin animations drift between devices"

The server's `spin:started` payload carries `seed`, `duration_ms`, `final_angle_deg`, `result_segment_id`. Both clients should reach the same final angle.

1. In each client's DevTools, log the `spin:started` payload (the room store does this at debug level).
2. Confirm both clients are on the same build (`pnpm build` output hash visible in DevTools network tab).
3. Confirm the wheel content (`active_question.segments`) is identical on both — drift here means `room:state` is stale on one side. Force a `socket.emit("room:join", { code })` to refresh.

### "Tests pass locally but fail in CI"

The autouse `_test_db_engine` fixture rebinds `hoba_api.db.SessionLocal` to a `StaticPool` `:memory:` engine. If CI has stricter timing, ensure your test doesn't rely on the rebind surviving a `pytest_asyncio` event-loop reset. Symptom: `OperationalError: no such table`.

### "i18n:check passes but UK still shows English"

The script catches *missing* keys and divergent *structure*. It does **not** catch a UK value that's accidentally copied from EN ("Settings" instead of "Налаштування"). Visual audit is still the final gate — see [`docs/testing.md`](testing.md) § Manual verification.

---

## Quality gates (run before pushing)

```bash
# Repo root — runs every workspace gate
pnpm typecheck && pnpm lint && pnpm test && pnpm i18n:check

# Backend (needs the bundled venv active)
cd apps/api && source ../../venv/bin/activate
pytest && mypy --strict src/hoba_api && ruff check src tests
```

CI fails on any one of these. The Stage close-out checklist in `docs/roadmap.md` lists them all.

---

## Where to put new code

| You're building… | Lives in… |
|---|---|
| A new HTTP endpoint | `apps/api/src/hoba_api/api/v1/` + service in `services/` + schema in `schemas/` |
| New Socket.IO event | `apps/api/src/hoba_api/realtime/handlers.py` |
| Game logic with side effects | `apps/api/src/hoba_api/services/` |
| Pure game math (deterministic) | `apps/api/src/hoba_api/wheel/` (or a new sibling — see spec §16 rule 1, the 3-use-sites threshold for new packages) |
| Frontend page | `apps/webapp/src/pages/<Name>Page.tsx` + add to `router.tsx` |
| Reusable UI piece (used ≥ 2 places) | `apps/webapp/src/components/ds/` |
| Room-specific UI piece | `apps/webapp/src/components/room/` |
| Pure helper (browser-globals-free) | `apps/webapp/src/lib/<name>.ts` (testable without jsdom — see `lib/startParam.ts`) |
| Bot handler | `apps/bot/src/hoba_bot/handlers.py` |

Spec §16 forbids "plugin systems, event buses, frameworks" until they have ≥ 3 in-codebase use sites. Resist abstracting prematurely; ship the third concrete use site first.
