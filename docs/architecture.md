# Architecture

> How the Hoba! services compose at runtime. Read this before touching boundaries between `apps/api`, `apps/bot`, and `apps/webapp`.

The spec ([`docs/spec.md`](spec.md)) is the *what*. This doc is the *how* — the runtime picture, the request/event flow, the boundaries that should not move without a deliberate decision.

---

## Bird's-eye view

```
┌─────────────────────┐     ┌──────────────────────────────────────────┐
│  Telegram client    │     │              docker compose              │
│  ────────────────   │     │                                          │
│  @hobagame_bot      │◀───▶│  bot   (aiogram polling)                 │
│  Mini App WebView   │     │   │                                      │
│  (the React app)    │◀────│   ▼     HTTPS (REST)                     │
│                     │     │  api   (FastAPI + Socket.IO @ ASGI)──┐   │
│                     │◀────│         /api/v1/*    /rooms (socket) │   │
│                     │     │             │                        │   │
│                     │     │             ▼                        │   │
│                     │     │  ┌──────────────────┐                │   │
│                     │     │  │ SQLite (aiosqlite) │              │   │
│                     │     │  │ users, rooms, ...  │              │   │
│                     │     │  └──────────────────┘                │   │
│                     │     │             ▲                        │   │
│                     │     │             │                        │   │
│                     │     │  ┌──────────┴──────┐                 │   │
│                     │     │  │ Redis 7         │ presence,       │   │
│                     │     │  │                 │ rate limits,    │   │
│                     │     │  │                 │ user-id cache   │   │
│                     │     │  └─────────────────┘                 │   │
│                     │     │                                       │   │
│                     │     │  caddy (prod profile only — TLS)     │   │
│                     │     └───────────────────────────────────────┘   │
└─────────────────────┘                                                 │
                                                                        │
        ngrok / cloudflared tunnel (dev) ◀────────────────── webapp :5173
```

There are exactly **three** application services. Anything more is over-engineering at this stage.

| Service | Owner | Boundary it protects |
|---|---|---|
| `apps/api` | `hoba_api` (Python) | All persistent state. Sole writer to SQLite. Authoritative for spin results, room state, rate limits. |
| `apps/bot` | `hoba_bot` (Python) | Telegram protocol surface — slash commands, deep-link parsing, menu button URL handoff. Reuses `hoba_api`'s SQLAlchemy models for user upsert on `/start`. |
| `apps/webapp` | React Mini App (TypeScript) | The view. Holds no canonical state — every realtime mutation comes from the server. |

---

## Backend: `apps/api`

```
apps/api/src/hoba_api/
├── main.py                # FastAPI app + Socket.IO ASGI mount
├── config.py              # pydantic-settings; all env reads happen here
├── db.py                  # SQLAlchemy async engine + SessionLocal
├── redis_client.py        # Redis client + presence + rate-limit + user-id cache
├── auth/
│   ├── initdata.py        # Telegram initData HMAC validation
│   └── dependencies.py    # FastAPI `Depends(get_current_user)`
├── api/v1/
│   ├── router.py          # /api/v1 mount
│   ├── me.py              # /me, /me/stats
│   └── rooms.py           # /rooms (create, fetch, patch, close, spins)
├── realtime/
│   ├── server.py          # socketio.AsyncServer instance + NAMESPACE constant
│   └── handlers.py        # /rooms namespace event handlers
├── services/              # Pure service layer (no FastAPI imports)
│   ├── users.py           # upsert + Redis-cached resolve
│   ├── rooms.py           # create/update/close room, validation
│   ├── participants.py    # join + presence refresh
│   ├── spins.py           # server-authoritative spin generation
│   └── room_state.py      # assemble RoomState DTO from DB + Redis
├── models/                # SQLAlchemy declarative models
└── wheel/spin_math.py     # Pure spin math; deterministic given (seed, segments)
```

### Key flows

**Authenticated HTTP request:**

```
client → POST /api/v1/rooms
   header: X-Telegram-Init-Data: <signed payload from Telegram WebApp>
   ↓
auth.dependencies.get_current_user
   ↓ validate_init_data (HMAC SHA-256 with bot token)
   ↓ services.users.resolve_telegram_user
       ├── Redis GET user:tg:<tg_id>          ← cache hit returns user_id
       │   └── SELECT FROM users WHERE id=<user_id>
       └── (cache miss) services.users.upsert_from_telegram
           └── INSERT / UPDATE users
   ↓ session.commit()
   ↓ cache_user_after_commit(user)            ← Redis SET, 15 min TTL
   ↓
api.v1.rooms.create_room_endpoint
   ↓ services.rooms.create_room (transactional)
   ↓ services.room_state.build_room_state (DTO assembly)
   ↓ → 201 RoomState
```

**Socket.IO spin (multiplayer):**

```
host client → socket.emit("spin:trigger", {})
   ↓
realtime.handlers.on_spin_trigger
   ↓ session lookup: user_id + room_code
   ↓ services.spins.trigger_spin
       ├── policy check (host_only? anyone? turn-based?)
       ├── wheel.spin_math.compute_spin(seed=fresh, segments=current)
       ├── INSERT INTO spins (..., result_segment_id, final_angle_deg, seed)
       ↓
   ↓ sio.emit("spin:announced",  room=room_code)   ← all clients
   ↓ asyncio.sleep(SPIN_ANNOUNCE_DELAY_SECONDS)
   ↓ sio.emit("spin:started",    room=room_code)   ← carries deterministic seed
   ↓ schedule _emit_settled(after duration_ms)
       └─ sio.emit("spin:settled", room=room_code)
```

The client receives the seed + duration and runs the same `spin_math` locally to animate to the same angle the server already decided. **Clients never decide the result.**

### Database

SQLAlchemy 2.0 async, with `aiosqlite` driver by default. Swap to Postgres by changing `DATABASE_URL` — no code change. Migrations via Alembic in `apps/api/alembic/versions/`. On API startup, `AUTO_MIGRATE=true` runs `alembic upgrade head`; set false for environments where migrations run as a separate deployment step.

Tables (current, see `apps/api/src/hoba_api/models/`):

- `users` — `tg_id` is the natural key from Telegram; `id` is internal.
- `rooms` — 6-char base32 code, `host_id`, `status ∈ {lobby, active, closed}`, `game_mode ∈ {classic, elimination, punishment, chaos, rigged}` (schema-ready; only `classic` is wired today), `spin_policy ∈ {host_only, anyone, turn_based}`.
- `participants` — `(room_id, user_id)` unique; role + presence timestamps.
- `questions` + `segments` — versioned wheel content per room.
- `spins` — every spin recorded for audit and replay; `result_segment_id`, `final_angle_deg`, `duration_ms`, `seed`.

### Redis keys

```
presence:{room_id}:{user_id}   = "1"          # TTL 60s, refreshed by presence:ping
react:{user_id}                = N            # rate-limit counter, window 30s, cap 10
user:tg:{tg_id}                = "{user_id}"  # 15 min TTL — auth + WS hot-path cache
```

No persistent data lives in Redis. Wiping Redis wipes presence + rate limit windows + the cache; nothing breaks except the next requests pay the DB lookup cost once.

---

## Bot: `apps/bot`

```
apps/bot/src/hoba_bot/
├── main.py               # aiogram dispatcher + polling start
├── config.py             # env read (token, webapp url, bot username)
├── handlers.py           # /start, /play, /help, /privacy, /lang (EN base)
└── middleware.py         # User upsert on first /start
```

The bot is intentionally thin. It:

1. Reuses `hoba_api`'s SQLAlchemy models (imported by package) to upsert the user on `/start`.
2. Parses `room_<CODE>` deep links from `t.me/<bot>?start=room_<CODE>` and replies with a Web App button to the Mini App URL (`WEBAPP_URL` env).
3. Hosts the menu button URL (configured via BotFather, not in code) — that's how Telegram knows where to load the Mini App when a user taps it.

The bot **does not** broadcast spin results, hold game state, or write rooms/spins. All gameplay lives in `apps/api`.

---

## Frontend: `apps/webapp`

```
apps/webapp/src/
├── main.tsx              # React root + Telegram SDK ready() + expand()
├── router.tsx            # react-router-dom routes
├── i18n/index.ts         # react-i18next + ICU; namespaces: common, brand, home, settings, dev, create, room
├── locales/{en,uk}/      # JSON locale files; parity enforced by scripts/i18n-check.mjs
├── components/
│   ├── ds/               # Design system: Button, Card, Input, Sheet, Wheel result banner, …
│   ├── layout/           # RootLayout owns BackButton + deep-link auto-navigate
│   └── room/             # ReactionsBar, FlyingReactions
├── pages/
│   ├── HomePage.tsx      # Quick Wheels grid (F2)
│   ├── SpinPage.tsx      # Solo spin flow
│   ├── CreatePage.tsx    # Custom wheel editor
│   ├── RoomPage.tsx      # Multiplayer room (Socket.IO)
│   ├── LibraryPage.tsx   # Stub for Stage F
│   ├── SettingsPage.tsx  # Locale + toggles
│   └── DevDSPage.tsx     # /dev/ds — design system showcase
├── features/wheel/
│   ├── Wheel.tsx         # SVG wheel + Framer Motion animation
│   ├── spinMath.ts       # Same algorithm as the server's wheel/spin_math.py
│   └── seededRandom.ts   # Deterministic RNG given a seed
├── lib/
│   ├── telegram.ts       # @twa-dev/sdk wrapper + readStartParam + buildRoomInviteLink
│   ├── startParam.ts     # Pure: extractStartParam (SDK → hash → query), parseRoomDeepLink
│   ├── api.ts            # REST client
│   ├── haptics.ts        # Telegram haptic feedback wrapper
│   └── safeStorage.ts    # localStorage with no-throw fallback
├── stores/
│   ├── room.ts           # Zustand store — owns the Socket.IO connection and room snapshot
│   ├── spinHistory.ts    # Solo spin history + the active custom wheel draft
│   └── toast.ts          # In-app toast queue
├── audio/index.ts        # Howler-backed sound effects
├── providers/ThemeProvider.tsx
└── data/quickWheels.ts   # 6 Quick Wheel definitions; labels via i18n
```

### Routes

| Path | Page | Phase shipped |
|---|---|---|
| `/` | `HomePage` | 4 |
| `/spin/:wheelId` | `SpinPage` (solo) | 5 |
| `/create` | `CreatePage` (custom wheel) | 5 |
| `/room/:code` | `RoomPage` (multiplayer) | 6 |
| `/library` | `LibraryPage` (stub) | 9 (Stage F) |
| `/settings` | `SettingsPage` | 4 |
| `/dev/ds` | `DevDSPage` (design system showcase) | 4 |

### Deep-link entry

`RootLayout` reads `start_param` once on mount via `lib/telegram.ts` → `lib/startParam.ts`. The extractor tries three sources in order:

1. **SDK** — `WebApp.initDataUnsafe.start_param`. Set by `@twa-dev/sdk` when Telegram delivers `start_param` *inside* `tgWebAppData` (older clients, menu-button launches).
2. **URL hash** — `tgWebAppStartParam=…` as a top-level hash param. Modern Direct Link Mini App launches use this; `@twa-dev/sdk` v7.10.1 does **not** read it (see `src/lib/startParam.ts` for the citation). The hash fallback is what makes share-deep-link delivery work on real phones.
3. **URL query** — `?startapp=…`. Only relevant in dev when pasting the link into a regular browser.

`parseRoomDeepLink` then peels the `room_` prefix and uppercases the code. `RootLayout` navigates to `/room/<CODE>`.

### Realtime store

`stores/room.ts` is the single source of multiplayer truth on the client:

- Holds one Socket.IO `Socket` instance for the app lifetime, lazily constructed on first `joinRoom`.
- Subscribes to `room:state`, `room:participant_{joined,left}`, `spin:{announced,started,settled}`, `reaction:received`, `error`.
- Exposes `joinRoom`, `leaveRoom`, `triggerSpin`, `sendReaction`.
- Maintains a `lastError` field; `RoomPage` localizes it via `room.errors.<code>` with a fallback.

The animation pipeline on the client is deterministic: when `spin:started` arrives with `{seed, duration_ms, result_segment_id, final_angle_deg}`, the wheel animates to exactly that final angle. The server has already decided; the client renders.

---

## Environment configuration

`.env` is read by `docker compose` and substituted into service environments. The full list is in `.env.example` with a one-line explanation for each variable. Highlights:

| Var | Service | Notes |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | api, bot | Empty in dev = bot starts in idle mode. |
| `TELEGRAM_BOT_USERNAME` | bot | Used for inline mode and deep-link composition. |
| `VITE_TELEGRAM_BOT_USERNAME` | webapp (build-time) | Mirrors the above; default `hobagame_bot`. |
| `VITE_TELEGRAM_APP_SHORT_NAME` | webapp (build-time) | Set when you've run `/newapp` in BotFather. Switches share links to Direct Link Mini App form, which auto-launches the Mini App with `start_param`. |
| `DATABASE_URL` | api | SQLite by default; swap for `postgresql+asyncpg://…`. |
| `REDIS_URL` | api | Required from day 1; defaults to `redis://redis:6379/0` inside compose. |
| `WEBAPP_URL` | bot | The public HTTPS URL Telegram opens. In dev = your ngrok URL. |
| `SECRET_KEY` | api | For signed internal payloads. `openssl rand -hex 32`. |
| `AUTO_MIGRATE` | api | `true` runs Alembic on startup. Set false where deploy pipeline does migrations. |

---

## Where to look when something breaks

| Symptom | First place to look |
|---|---|
| Mini App opens but doesn't navigate to room | `lib/startParam.ts` and the share-link form. `docs/testing.md` § "A1 — share deep-link". |
| WebSocket connect rejected immediately | `realtime/handlers._authenticate` — `TELEGRAM_BOT_TOKEN` mismatch between client and server, or expired `auth_date`. |
| Spin animation drifts between two devices | Both clients should be running the same build. The seed comes from the server; check the `spin:started` payload in DevTools. |
| Locale flip leaves stale English | `pnpm i18n:check` — a missing key falls back to English silently. Run the check, you'll see the divergence. |
| Coverage gate fails | `pyproject.toml` `--cov-fail-under=80`. New code without tests is the usual cause. |

For day-to-day local debugging, see [`docs/development.md`](development.md). For test layout and manual verification per stage, see [`docs/testing.md`](testing.md).
