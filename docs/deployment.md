# Hoba! — Production deployment

> Production deploy walkthrough (in use since the Stage C deploy chain;
> current as of Stage G). Assumes an SSH-able Linux VPS with Docker +
> Docker Compose installed and ports 80/443 open. A domain you control
> (or a subdomain you can point) is required for Caddy's auto-TLS via
> Let's Encrypt. Day-to-day, `./scripts/deploy.sh` wraps the pull/build/up
> cycle (see § 8).

The webapp container is a **multi-stage build** (commit `2050774`,
pulled forward from Stage G during the Stage C deploy chain when the
Vite-dev-in-prod path proved unreliable): a Node builder stage runs
`pnpm build` to emit the static bundle, then an `nginx:1.27-alpine`
runtime stage serves it with SPA fallback + immutable-asset cache
headers (see `apps/webapp/nginx.conf`). The dev workflow is unchanged
— `docker-compose.yml` pins the dev target explicitly for local use.

---

## 0. Prereqs you need before starting

- A reachable VPS IP (Hetzner / DigitalOcean / your own metal). Anywhere
  with public ports 80 + 443.
- A domain or subdomain you control. Example below uses
  `hoba.example.com` — substitute everywhere.
- The `TELEGRAM_BOT_TOKEN` you set up via BotFather for `@hobagame_bot`.
- `docker` + `docker compose` on the server.
- (Optional) `git` on the server, OR you'll `rsync` the repo from your
  laptop.

## 1. DNS

Add an A-record at your DNS host:

```
hoba.example.com  →  <VPS public IP>
```

Verify before touching the server:

```bash
dig +short hoba.example.com   # should print the VPS IP
```

If you use Cloudflare in front, set the record to **DNS-only** (grey
cloud, not proxied) — otherwise Caddy can't complete the Let's Encrypt
HTTP-01 challenge.

## 2. Get the repo onto the server

Either clone (if the server has Git access to the repo):

```bash
ssh user@hoba.example.com
git clone <your-repo-url> ~/hoba
cd ~/hoba
```

Or rsync from your laptop:

```bash
# IMPORTANT: anchored excludes (`/data` not `data`) — without the
# leading slash, rsync matches ANY directory named `data` in the tree,
# including apps/webapp/src/data/ which contains source the webapp
# can't boot without.
rsync -avz \
    --exclude='/.git' --exclude='node_modules' --exclude='/venv' \
    --exclude='/data' --exclude='/.env' --exclude='/.venv' \
    --exclude='__pycache__' --exclude='*.pyc' --exclude='/dist' \
    /home/kali/hoba/  user@hoba.example.com:~/hoba/
ssh user@hoba.example.com
cd ~/hoba
```

## 3. Configure `.env` on the server

```bash
cp .env.example .env
nano .env   # or vim / your editor of choice
```

Fill these — **do not commit `.env`**:

```ini
TELEGRAM_BOT_TOKEN=<from BotFather for @hobagame_bot>
TELEGRAM_BOT_USERNAME=hobagame_bot

VITE_TELEGRAM_BOT_USERNAME=hobagame_bot
VITE_TELEGRAM_APP_SHORT_NAME=play     # matches the Direct Link Mini App you set up in BotFather

DATABASE_URL=sqlite+aiosqlite:///./data/hoba.db
REDIS_URL=redis://redis:6379/0

WEBAPP_URL=https://hoba.example.com
DOMAIN=hoba.example.com

SECRET_KEY=<openssl rand -hex 32>
SENTRY_DSN=
LOG_LEVEL=INFO
AUTO_MIGRATE=true
```

Generate `SECRET_KEY` quickly:

```bash
openssl rand -hex 32
```

## 4. Boot the prod profile

> **Two flavours** — pick one before running anything.
>
> - **Dedicated box (default):** Caddy bundled inside Hoba takes 80/443
>   and auto-issues a Let's Encrypt cert. Use the command below as-is.
> - **Shared box (your VPS already runs another site on 80/443):** Hoba's
>   containers bind to 127.0.0.1 only; the host's existing nginx
>   terminates TLS and reverse-proxies the Hoba subdomain. See
>   [§4b. Shared-VPS deploy](#4b-shared-vps-deploy) for the override
>   command + nginx config.

```bash
docker compose --profile prod up -d
docker compose ps
```

You should see five healthy services: `api`, `bot`, `caddy`, `redis`,
`webapp`.

**First-boot expectations:**
- Caddy hits Let's Encrypt's HTTP-01 challenge on port 80, gets a cert,
  switches the listener to 443. Logs say `certificate obtained`.
- Cert + key are stored in the `caddy-data` Docker volume — they
  persist across `docker compose down/up` so you don't get
  rate-limited by Let's Encrypt.
- API runs Alembic migrations on boot (because `AUTO_MIGRATE=true`),
  creating the SQLite schema in `./data/hoba.db`.

Tail logs to watch the boot:

```bash
docker compose logs -f caddy api bot
```

## 4b. Shared-VPS deploy

If the box already runs another site on 80/443 (an existing nginx
terminating TLS for some other vhost), let that nginx be Hoba's TLS
terminator too.

**One-time host prep** (existing nginx must support TLS already):

```bash
# 1. DNS A-record for hoba.<your-domain> → VPS public IP. Verify:
dig +short hoba.<your-domain>

# 2. Issue a Let's Encrypt cert for the subdomain
sudo certbot --nginx -d hoba.<your-domain>

# 3. Drop in Hoba's nginx server block
sudo cp ~/hoba/infra/nginx/hoba.conf /etc/nginx/sites-available/hoba
sudo sed -i 's/hoba\.example\.com/hoba.<your-domain>/g' /etc/nginx/sites-available/hoba
sudo ln -s /etc/nginx/sites-available/hoba /etc/nginx/sites-enabled/hoba
sudo nginx -t && sudo systemctl reload nginx
```

**Boot Hoba with the shared override:**

```bash
cd ~/hoba
docker compose -f docker-compose.yml -f compose.shared.yaml up -d
docker compose ps
```

The override:
- Binds `api` → `127.0.0.1:8000`, `webapp` → `127.0.0.1:5173`,
  `redis` → `127.0.0.1:6379` (not reachable from the public
  internet — only from the host).
- Disables the bundled Caddy (your nginx is doing TLS termination).

In `.env` for this flavour:

```ini
WEBAPP_URL=https://hoba.<your-domain>
# DOMAIN is unused under shared-VPS — Caddy isn't running.
```

Verify the chain works:

```bash
# From your laptop:
curl -fsI https://hoba.<your-domain>/openapi.json
# → HTTP/2 200, server: nginx, proxied to uvicorn
curl -sI https://hoba.<your-domain>/api/v1/me
# → HTTP/2 401 (missing X-Telegram-Init-Data — expected, proves /api/v1 proxies)
```

If you get a 502: the Hoba containers aren't listening on the expected
loopback ports. `docker compose ps` to confirm `127.0.0.1:8000` and
`127.0.0.1:5173` are bound; `docker compose logs api webapp --tail 50`
for the trace.

## 5. Smoke test

```bash
# From your laptop / phone, not the server:
curl -fsSL https://hoba.example.com/openapi.json | head -1
# → {"openapi":"3.1.0", ...}
# (FastAPI mounts the OpenAPI spec at root, not under /api/v1.)

# Real API routes live under /api/v1/* — sanity check with a route
# that exists but needs auth; 401 confirms the proxy chain is live.
curl -sI https://hoba.example.com/api/v1/me | head -3
# → HTTP/2 401, server: uvicorn

# Browser: open https://hoba.example.com
# → Hoba! webapp renders (without Telegram context the Mini App will
#   show its non-Telegram fallback, but the assets must load over HTTPS).
```

## 6. Point BotFather at production

Three updates in BotFather:

```
1. /setmenubutton  → @hobagame_bot  → URL: https://hoba.example.com/
                                       label: "Open Hoba!"
   (the bot also calls set_chat_menu_button on startup using
    WEBAPP_URL from .env, so step 1 happens automatically the next
    time you restart the bot service. Do it manually only as a
    belt-and-braces.)

2. /myapps → @hobagame_bot/play → Edit Web App URL
                                 → https://hoba.example.com/
   (this is the Direct Link Mini App for share deep-links —
    t.me/hobagame_bot/play?startapp=room_<CODE>)

3. Bot service auto-updates its menu button from WEBAPP_URL on boot,
   so confirm with:

   docker compose restart bot
   docker compose logs bot --tail 30
   # Look for "chat menu button set" or similar
```

## 7. End-to-end verification

In Telegram on two devices:

1. Device A: open `@hobagame_bot` → tap menu button → Mini App loads
   from `https://hoba.example.com` (check the URL bar / page source).
2. Device A: create a room → tap share → choose the chat with Device B.
3. Device B: tap the shared link → Mini App opens **and navigates
   directly to /room/<CODE>** (Stage A item 1 fix).
4. Both devices spin together; the brand-keyed `Hoba!` / `Хоба!`
   reveal fires within ±50 ms of each other.
5. Tap reactions on Device B — flying emoji appears on both screens.
6. Flip locale on Device B via `/settings` → UK polish flips
   immediately; Device A stays in EN (locale is per-user).

If any step fails, fall back to `docs/manual-verify-stageB.md` for the
detailed checklist.

## 8. Operate

Useful daily commands:

```bash
# Health
docker compose ps
docker compose logs --tail 100 api bot caddy

# Restart one service
docker compose restart bot

# Update from your laptop (after a git push to main, on the server):
git pull
docker compose --profile prod up -d --build

# Database backup (SQLite is a single file)
cp ./data/hoba.db ./data/hoba-$(date +%F).db.bak

# Free disk by pruning old images
docker image prune -af

# Room cleanup — close rooms idle > 24h (run from cron, e.g. hourly).
# Non-destructive: history is kept, the room just can't be re-entered.
docker compose exec api python -m hoba_api.tasks.cleanup
# Override the window: -e HOBA_CLEANUP_AFTER_HOURS=48
```

Suggested host crontab line (hourly):

```cron
0 * * * * cd /home/cax/_hoba && docker compose -f compose.shared.yaml exec -T api python -m hoba_api.tasks.cleanup >> /var/log/hoba-cleanup.log 2>&1
```

## 9. Common first-deploy gotchas

- **Caddy stuck on "obtaining certificate":** DNS hasn't propagated yet
  (`dig` returns the wrong IP) OR port 80 is blocked at the firewall
  (`ufw status` / VPS provider's firewall console). Caddy retries every
  ~2 minutes.
- **Bot menu button still points at ngrok URL:** you restarted the bot
  but `.env`'s `WEBAPP_URL` still has the dev URL. Update `.env`,
  `docker compose restart bot`, check `logs bot`.
- **`room_not_found` from a share link** (Stage A regression): the
  Direct Link Mini App URL in BotFather `/myapps` still points at
  ngrok. Update it to the prod URL.

See the next section for deep 502 / startup debugging.

## 9b. Troubleshooting recipes (502 / restart loop / migration breakage)

> Pulled from the 2026-05-29 mode-picker deploy session, where a
> single 502 cascaded through four distinct issues. The order below
> is the same diagnostic order used to find each one — start at the
> top and stop at the first symptom that matches.

### Diagnostic chain — narrow down before fixing

Always start by isolating *which side* of the proxy stack is failing:

```bash
# 1. Is the api container even running?
docker compose -f docker-compose.yml -f compose.shared.yaml ps api

# 2. Can you reach the api directly inside the container's bind-mount?
curl -isS http://127.0.0.1:8800/openapi.json | head -3

# 3. What does the host nginx vhost actually look like?
sudo nginx -T 2>/dev/null | grep -B 2 -A 30 "<your-domain>" | head -50
```

Interpretation matrix:

| ps STATUS | curl 127.0.0.1:8800 | https:// curl | Where to look |
|---|---|---|---|
| Up | 200 OK | 200 OK | Browser cache. Hard-reload from phone. |
| Up | 200 OK | 502 | **Host nginx vhost is broken** — see "Nginx vhost recovery" below. |
| Up | Connection refused / reset | (any) | **Container alive but uvicorn not listening** — usually a reload loop. See "Uvicorn restart loop". |
| Restarting (3) | (any) | 502 | **Lifespan startup failed** — `exited with code 3` from uvicorn. See "Lifespan exit code 3". |
| Restarting (any other) | (any) | 502 | Crash in main process. `logs api --tail 80` for traceback. |

### Recipe — Uvicorn restart loop from `--reload` watching `.venv`

**Symptom.** Container shows `Up`, but `curl 127.0.0.1:8800` returns connection reset. Logs show repeated `Started server process [1]` / `Waiting for application startup` cycles every 2-5 seconds. Near the start of the cycle: `Will watch for changes in these directories: ['/app']` + `Started reloader process [1] using WatchFiles`. The reload list contains hundreds of paths from `.venv/lib/python3.12/...`.

**Cause.** `apps/api/Dockerfile`'s `CMD` includes `--reload` (handy for dev HMR). On shared-VPS prod, `uv pip install --system` writes into `/app/.venv` inside the container, watchfiles sees those ~20k files as "changing" during startup, fires a reload, the cycle repeats. uvicorn never finishes startup → no listener on port 8000 → 502.

**Fix.** Already in `compose.shared.yaml`: `api.command` overrides the Dockerfile CMD without `--reload`. If you ever see this symptom again, verify the override is still present:

```bash
grep -A 5 "  api:" compose.shared.yaml | grep "command"
```

Should show `command: ["uvicorn", "hoba_api.main:asgi", "--host", "0.0.0.0", "--port", "8000"]`. If missing, restore it from `git log -p compose.shared.yaml` history.

### Recipe — Lifespan `exit code 3` (silent traceback)

**Symptom.** `docker compose logs api` shows `INFO: Started server process [1]` → `Waiting for application startup` → migration starts → silence → `api-1 exited with code 3 (restarting)`. No Python traceback in the structured log.

**Cause.** uvicorn's lifespan startup hook raised an exception. structlog's stdlib redirect captures the log output and hides the actual traceback because the exception bubbles up past the formatter.

**Diagnostic.** Run alembic outside the uvicorn lifespan so the traceback prints directly:

```bash
docker compose -f docker-compose.yml -f compose.shared.yaml stop api
docker compose -f docker-compose.yml -f compose.shared.yaml run --rm \
    -e AUTO_MIGRATE=false api alembic upgrade head 2>&1 | tail -40
```

This dispatches a one-shot container with migrations disabled in the application boot (so they run via the explicit `alembic upgrade head` command instead). The Python traceback prints to stdout. Common errors to look for:

- `ValueError: Constraint must have a name` — see "Alembic batch_alter_table FK".
- `duplicate column name: <name>` — see "Partial migration corruption".
- `OperationalError: no such table: <name>` — DB is empty or wrong; wipe + recreate.

### Recipe — Alembic `batch_alter_table` failure with anonymous FK

**Symptom.** `ValueError: Constraint must have a name` raised from `alembic/operations/batch.py` line ~672, `add_constraint`.

**Cause.** SQLite alters in alembic go through `batch_alter_table`, which rebuilds the table and copies all constraints. The constraint-copy step requires every constraint to have an explicit name. An anonymous `ForeignKey("users.id", ondelete="...")` in a `sa.Column` blows up.

**Fix.** For migrations that only add a single nullable column with a FK, skip `batch_alter_table` entirely — SQLite natively supports `ALTER TABLE ADD COLUMN` with inline `REFERENCES`:

```python
def upgrade() -> None:
    op.add_column(
        "rooms",
        sa.Column(
            "current_turn_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

def downgrade() -> None:
    op.drop_column("rooms", "current_turn_user_id")
```

For migrations that genuinely need `batch_alter_table` (renames, NOT NULL additions, type changes), name every FK / unique / check constraint explicitly:

```python
sa.ForeignKey("users.id", name="fk_rooms_current_turn_user_id_users", ondelete="SET NULL")
```

A longer-term fix would be to set a `naming_convention` on the SQLAlchemy `MetaData` so all auto-generated constraint names are deterministic; tracked in `docs/TODO.md`.

### Recipe — Partial migration corruption (`duplicate column name`)

**Symptom.** `OperationalError: duplicate column name: <name>` on the migration that *adds* that column. `alembic_version` is at the previous revision, but the schema already has the column.

**Cause.** A previous migration attempt was killed mid-way. For `batch_alter_table`: the rebuild path emits `CREATE _alembic_tmp_X` → `INSERT ... SELECT` → `DROP X` → `RENAME _alembic_tmp_X TO X` → `UPDATE alembic_version`. If the process dies between `RENAME` and `UPDATE alembic_version`, the table has the new schema but the version marker is stale. The next migration attempt tries to add the column again and fails.

**Fix — preserve data.** Tell alembic the migration is already applied:

```bash
docker compose -f docker-compose.yml -f compose.shared.yaml stop api
docker compose -f docker-compose.yml -f compose.shared.yaml run --rm \
    -e AUTO_MIGRATE=false api alembic stamp <target-revision>
docker compose -f docker-compose.yml -f compose.shared.yaml up -d api
```

`alembic stamp` updates the version marker without running any SQL. On the next start, alembic sees `current=head` and skips the migration.

**Fix — clean wipe (no real users yet).** Beware: a running container holds an open file descriptor on `data/hoba.db`. A naive `sudo rm` "succeeds" but the container keeps the unlinked inode until restart. Always `down` first:

```bash
docker compose -f docker-compose.yml -f compose.shared.yaml down
sudo rm -fv data/hoba.db data/hoba.db-journal data/hoba.db-wal data/hoba.db-shm
sudo ls -la data/    # confirm no hoba.db* before continuing
docker compose -f docker-compose.yml -f compose.shared.yaml up -d
```

### Recipe — Nginx vhost recovery

**Symptom.** `ps` shows api Up, direct `curl 127.0.0.1:8800` returns 200, but `https://<domain>` returns 502.

**Diagnostic.** Check that the Hoba vhost is active and targets the right upstream:

```bash
ls -la /etc/nginx/sites-enabled/
sudo nginx -T 2>/dev/null | grep -B 2 -A 30 "<your-domain>" | head -50
```

Expected: `proxy_pass http://127.0.0.1:8800;` for `/api/`, `/openapi.json`, `/socket.io/`. If the vhost is missing or the upstream port differs:

```bash
sudo cp ~/hoba/infra/nginx/hoba.conf /etc/nginx/sites-available/hoba
sudo sed -i 's/hoba\.example\.com/<your-domain>/g' /etc/nginx/sites-available/hoba
sudo ln -sf /etc/nginx/sites-available/hoba /etc/nginx/sites-enabled/hoba
sudo nginx -t && sudo systemctl reload nginx
```

### Recipe — Docker image cache during `--build`

**Symptom.** You committed a fix, `git pull`'d on the VPS, ran `docker compose up -d --build api`, but the container still behaves like the old code.

**Cause.** Docker's COPY layer cache can stick when file mtimes don't change predictably. `--build` rebuilds the image but reuses cached layers it considers identical.

**Fix.** Force a no-cache rebuild for the specific service:

```bash
docker compose -f docker-compose.yml -f compose.shared.yaml stop api
docker compose -f docker-compose.yml -f compose.shared.yaml build --no-cache api
docker compose -f docker-compose.yml -f compose.shared.yaml up -d api
```

Verify the new code actually landed by checking a known string from the diff:

```bash
grep -E "<expected-new-string>" apps/api/path/to/file.py
```

## 10. Backups + retention

`./data/hoba.db` is the only persistent state worth keeping (Redis is
ephemeral; Caddy state is auto-issued certs).

For the soft-launch phase, a daily cron is enough:

```bash
# On the server, as the same user that owns ~/hoba
crontab -e
0 3 * * * cp /home/<user>/hoba/data/hoba.db /home/<user>/hoba/data/backups/hoba-$(date +\%F).db && find /home/<user>/hoba/data/backups -name 'hoba-*.db' -mtime +7 -delete
mkdir -p /home/<user>/hoba/data/backups
```

When you graduate to Postgres (Stage G+), replace this with
`pg_dump` against a managed DB or a dedicated container.

---

## Rollback

If a release blows up:

```bash
# On the server
cd ~/hoba
git fetch origin
git checkout <previous-good-sha>
docker compose --profile prod up -d --build
```

Bring data back if the schema regressed:

```bash
docker compose stop api bot
cp data/backups/hoba-YYYY-MM-DD.db data/hoba.db
docker compose --profile prod up -d
```

---

When this entire walkthrough is green on two devices in both locales,
mark Stage B fully verified in `CLAUDE.md`, update the project-state
memory, and announce the soft-launch invite list (10–20 friends, two
short play sessions per the roadmap Stage C charter).
