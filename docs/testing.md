# Testing

> The full test layout, what each suite covers, how to run them, and the manual verification checklist for each shipped stage.

For local setup, debugging, and dev tunnels see [`docs/development.md`](development.md). For runtime architecture see [`docs/architecture.md`](architecture.md).

---

## Test suites

| Suite | Tool | Where | Runs |
|---|---|---|---|
| Backend unit + integration | `pytest` (+ `pytest-asyncio`, `pytest-cov`, `fakeredis`) | `apps/api/tests/` | `pytest` from `apps/api/` |
| Backend type check | `mypy --strict` | `apps/api/src/hoba_api/` | `mypy --strict src/hoba_api` |
| Backend lint | `ruff` | `apps/api/{src,tests}` | `ruff check src tests` |
| Frontend unit | `vitest` | `apps/webapp/src/**/__tests__/` | `pnpm test` from `apps/webapp/` |
| Frontend type check | `tsc --noEmit` | `apps/webapp/src/` | `pnpm typecheck` |
| Frontend lint | `eslint` | `apps/webapp/src/` | `pnpm lint` |
| Locale parity | bespoke (`scripts/i18n-check.mjs`) | `apps/webapp/src/locales/` | `pnpm i18n:check` from root |

All seven gates must be green before a stage closes.

---

## Running everything in one go

```bash
# From repo root
cd /home/kali/hoba

# Backend (uses the bundled venv)
( cd apps/api && source ../../venv/bin/activate && pytest && mypy --strict src/hoba_api && ruff check src tests )

# Frontend + locales
pnpm typecheck && pnpm lint && pnpm test && pnpm i18n:check
```

Expected as of Stage A: **102 pytest passed**, **31 vitest passed**, mypy / ruff / eslint / tsc clean, `i18n:check` exits 0 (with advisory warnings for unused-but-reserved keys).

---

## Backend test layout

```
apps/api/tests/
├── conftest.py              # autouse fakeredis + autouse DB engine rebind to StaticPool :memory:
├── test_smoke.py            # health checks, app boot
├── api/                     # FastAPI route tests via TestClient
│   └── test_me.py
├── auth/
│   └── test_initdata.py     # initData HMAC validation
├── services/
│   ├── test_users.py        # upsert paths
│   ├── test_user_cache.py   # Redis tg_id→user_id cache (Stage A)
│   ├── test_rooms.py        # create/update/close/policy
│   ├── test_participants.py # join + presence
│   └── test_spins.py        # server-authoritative spin generation
├── realtime/                # Stage A
│   └── test_handlers.py     # Socket.IO /rooms namespace via FakeSocketIO double
└── wheel/
    └── test_spin_math.py    # Pure spin math (no DB, no I/O)
```

### Conftest behavior

The autouse `_test_db_engine` fixture creates a fresh `:memory:` SQLite engine per test with `StaticPool` so every connection (including those opened by Socket.IO handlers via `SessionLocal()`) sees the same schema. It rebinds `hoba_api.db.SessionLocal` *and* `hoba_api.realtime.handlers.SessionLocal` for the test's lifetime, then restores both on teardown.

The autouse `fake_redis` fixture swaps the real Redis client for an in-process `fakeredis.aioredis.FakeRedis`, freshly per-test, so no test leaks state into another.

### Coverage gate

Set in `apps/api/pyproject.toml`:

```toml
[tool.pytest.ini_options]
addopts = "--cov=hoba_api --cov-report=term-missing --cov-fail-under=80"
```

Only `main.py` is excluded (boot code with no meaningful branches). Realtime handlers (94%) and `redis_client.py` (96%) are fully in the gate as of Stage A.

### Running subsets

```bash
cd apps/api && source ../../venv/bin/activate

pytest tests/realtime/                                 # whole realtime suite
pytest tests/services/test_user_cache.py -v            # one file, verbose
pytest -k "cache_hit"                                  # by name fragment
pytest tests/realtime/test_handlers.py::test_room_join_happy_path
pytest -x --ff                                         # stop on first fail, run failed first next time
pytest --no-cov                                        # skip the coverage gate (faster local iteration)
```

### Test patterns to follow

- **DB tests** request the `db` fixture; it yields a session bound to the same engine as `SessionLocal()`, so service-layer code is exercised end-to-end against real SQLAlchemy (no mocked ORM).
- **Redis tests** request the `fake_redis` fixture and verify both behavior (cache hit shape) and side effects (correct keys, correct TTL).
- **Socket.IO handler tests** use `FakeSocketIO` from `tests/realtime/test_handlers.py`. Register handlers, dispatch by name via `sio.call("event", *args)`, assert on `sio.emitted`, `sio.sessions`, `sio.rooms_joined`. This is intentionally not a live `python-socketio.AsyncClient` round-trip — that would need a uvicorn fixture and adds substantial flake.

---

## Frontend test layout

```
apps/webapp/src/
├── features/wheel/__tests__/spinMath.test.ts    # pure spin math; matches server
└── lib/__tests__/telegram.test.ts               # Stage A: extractStartParam, parseRoomDeepLink, buildRoomInviteLink
```

vitest config is in `apps/webapp/vitest.config.ts`. Default environment is `node` (faster) — UI integration tests would need `jsdom`/`happy-dom` if added later.

### Running subsets

```bash
cd apps/webapp

pnpm test                                          # whole suite
pnpm test -- src/lib/__tests__/telegram.test.ts    # one file
pnpm test -- -t "buildRoomInviteLink"              # by name fragment
pnpm test -- --reporter=verbose
```

### Test patterns

- **Pure functions** are extracted out of side-effect-y modules so they're testable without the SDK. Example: `lib/startParam.ts` is fully unit-tested; the SDK-touching wrapper in `lib/telegram.ts` is exercised via the pure layer.
- **Avoid importing modules that touch `window` at import time** (the SDK does) from test files — see `src/lib/startParam.ts` as the template for the split.

---

## Locale parity (`pnpm i18n:check`)

What it does:

1. **Namespace parity** — `apps/webapp/src/locales/en/` and `…/uk/` must have the same `.json` files.
2. **Key parity** — within each namespace, the recursive key set in EN must exactly match UK.
3. **Referenced-key coverage** — every `t("ns:key.path")` call in `apps/webapp/src/` must resolve to a real EN key. Catches typos and rebases that missed locale updates.
4. **Dynamic-key suppression** — calls of the form ``t(`room:errors.${code}`)`` are recognized; the script treats the prefix `room:errors.` as dynamically referenced and won't warn about unused keys in that subtree.
5. **Bare-key suppression** — calls without a namespace prefix (`t("not_found.wheel")` after `useTranslation("common")`) are also recognized; the script checks whether that key exists in *any* namespace.

What it does *not* catch:

- A UK string that's accidentally identical to EN ("Settings" left untranslated).
- A semantically wrong translation.
- Layout overflow from longer Ukrainian phrases.

Run:

```bash
pnpm i18n:check     # from repo root; exits non-zero on parity violation
```

Advisory warnings (`[ref] unused (maybe): …`) do not fail the check. They flag keys that look unused — review and either delete (preferred) or accept that the key is reserved for a later stage.

Confirm the script actually catches divergence:

```bash
# Inject a key only in EN, confirm i18n:check fails, then revert.
node -e "const f=require('node:fs');const p='apps/webapp/src/locales/en/common.json';const o=JSON.parse(f.readFileSync(p,'utf8'));o.actions.test_only_en='x';f.writeFileSync(p,JSON.stringify(o,null,2));"
pnpm i18n:check
echo "exit=$?"     # 1
git checkout apps/webapp/src/locales/en/common.json
```

---

## Manual verification — Stage A

These are the human-in-the-loop checks the spec calls for at every stage close. Automated tests cover the algorithms; these cover the user experience.

### Setup (one-time)

Run the app following [`docs/development.md`](development.md). For checks 1–4 you can use a regular browser at `http://localhost:5173`. For check 5 you need a real Telegram client on a second device (see § Two-device verification below).

### 1. Share deep-link auto-navigate (in a browser)

In a regular browser we exercise the third extractor fallback (URL query).

```
1. Open http://localhost:5173/
2. Tap any Quick Wheel → spin → on the settled screen tap "+ Invite friends"
3. You're now on /room/<CODE> — note the code in the URL.
4. Open a new tab to: http://localhost:5173/?startapp=room_<CODE>
5. Expected: tab lands on /room/<CODE>, NOT the home screen.
```

Real Telegram delivers `start_param` via the URL hash (`#tgWebAppStartParam=…`). The unit tests in `apps/webapp/src/lib/__tests__/telegram.test.ts` exercise all three fallback paths.

### 2. Redis cache hit skips DB write

```bash
# Start API with DEBUG logs so you see SQL.
docker compose logs api -f | grep -E "INSERT|UPDATE|SELECT.*users"

# Open the webapp in two browser tabs and trigger several API calls
# (open a room, refresh, navigate around). After the FIRST request:
#   - No further `INSERT INTO users` should appear.
#   - No further `UPDATE users SET last_active_at`.
#   - No `SELECT users WHERE tg_id = ?` either — the cache returns
#     the user_id directly and we fetch by PK.
```

Inspect the cache directly:

```bash
docker exec -it $(docker ps -q -f ancestor=redis:7-alpine) redis-cli
> KEYS user:tg:*
> GET user:tg:<your_tg_id>
> TTL user:tg:<your_tg_id>      # 0 < TTL ≤ 900
```

### 3. Locale parity inside the room

```
1. Open http://localhost:5173/
2. ⚙️ Settings → switch to Українська.
3. Back to home:
   - Header shows "Хоба!" (not "Hoba!").
   - Quick Wheels and segments render in Ukrainian.
4. Create a custom wheel → spin → on settled, tap "Запросити друзів".
5. Inside /room/<CODE>:
   - Share button reads "Поділитись".
   - Participant count uses Ukrainian plural ("1 у кімнаті", "5 у кімнаті").
   - If you're not host: "Господар крутить. Реагуйте панеллю вище."
   - Tap Share → if outside Telegram, fallback toast shows "Посилання скопійовано".
6. Switch back to English — every visible string flips instantly.
```

### 4. Error code → localized message

```
1. While logged in, manually visit http://localhost:5173/room/ZZZZZZ
   (a code that doesn't exist).
2. Expected: toast shows the localized "Room not found." (EN) or
   "Кімнату не знайдено." (UK), NOT the raw enum code "room_not_found".
```

### 5. WS handler test coverage proof

```bash
cd apps/api && source ../../venv/bin/activate
pytest tests/realtime/test_handlers.py tests/services/test_user_cache.py --cov=hoba_api/realtime --cov=hoba_api/redis_client --cov-report=term-missing
# realtime/handlers.py ≥ 94%, redis_client.py ≥ 96%
```

### Two-device verification (real Telegram)

This is the *real* multiplayer test. Without it, "multiplayer works" is unproven.

Prereq: dev tunnel set up per [`docs/development.md`](development.md) § Dev tunnel.

```
Device A (host):
  1. Open t.me/hobagame_bot, tap the menu button → Quick Wheel → spin
  2. On settled, tap "+ Invite friends" → you land in /room/<CODE>
  3. Tap "Share" → pick the chat with Device B

Device B (guest):
  4. In the chat, you see a message with link
     t.me/hobagame_bot?startapp=room_<CODE>
     (or t.me/hobagame_bot/<short>?startapp=… if you set VITE_TELEGRAM_APP_SHORT_NAME)
  5. Tap the link.

Expected:
  6. Mini App opens and IMMEDIATELY navigates to /room/<CODE>
     (NOT the home screen). This is the A1 fix.
  7. On Device A, presence list grows: new participant appears in the
     header avatars within 1-2 seconds.
  8. Device A host taps Spin. Both screens animate to the same result
     within ±50 ms. Confetti + Hoba!/Хоба! word reveal fires on both.
  9. Device B taps a reaction emoji. A flying emoji appears on BOTH
     screens (skip-sid means it doesn't appear on the sender's side
     before it round-trips through the server — by design).
 10. Spam reactions on Device B: the 11th in 30 seconds is rate-limited
     (server emits `error: rate_limited`; toast localizes appropriately).
 11. On Device B, change Settings → Українська. The room UI flips to
     Ukrainian instantly. Device A stays in English (locale is per-user).
```

Record the result in `docs/manual-verify-stageA.md` (create if missing) — outcome of each numbered step, plus screenshots if anything looks off.

---

## When tests are flaky

Watch list:

- **`StaticPool` + `:memory:` SQLite**: every new test connection shares the same in-memory DB. If you see "no such table", the autouse engine rebind didn't run — check that `pytest-asyncio`'s `asyncio_mode = "auto"` is still set in `pyproject.toml` and the test isn't accidentally pinned to a different event loop.
- **`fakeredis` state**: the autouse fixture creates a fresh `FakeRedis` per test, but if a test forgets to await something, state can leak in pathological cases. Solution: always `await` Redis writes; never store the client across tests.
- **Socket.IO handler tests**: don't share `FakeSocketIO` across tests. Each test gets its own via the `sio` fixture.

---

## Adding tests for new code

| You wrote… | Add a test in… |
|---|---|
| Service function with branching | `apps/api/tests/services/test_<name>.py` |
| Realtime handler | `apps/api/tests/realtime/test_handlers.py` (add to the existing file unless it grows past ~500 lines) |
| FastAPI route | `apps/api/tests/api/test_<route>.py` |
| New SQLAlchemy model | Add at minimum a smoke insert in the relevant service test |
| Pure frontend helper | `apps/webapp/src/<dir>/__tests__/<name>.test.ts` |
| New locale namespace | Add the `.json` file in both `en/` and `uk/` — `pnpm i18n:check` is the gate |
| New `t("ns:key")` reference | `pnpm i18n:check` verifies the key resolves; missing → CI fails |

The coverage gate at 80% global is a floor. Code with branching logic should land closer to 100%. The realtime handlers' 94% and `redis_client`'s 96% are the recent baselines.
