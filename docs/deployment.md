# Hoba! — Production deployment

> Stage C / soft-launch deploy walkthrough. Assumes an SSH-able Linux VPS
> with Docker + Docker Compose installed and ports 80/443 open. A domain
> you control (or a subdomain you can point) is required for Caddy's
> auto-TLS via Let's Encrypt.

This doc bakes in the **dev-server-as-prod** choice for the soft launch
(per `docs/TODO.md` Stage G). The webapp container runs `pnpm dev` behind
Caddy. Acceptable for ≤ 20 simultaneous users; the static-build
replacement is filed for Stage G.

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
rsync -avz --exclude '.git' --exclude 'node_modules' --exclude 'venv' \
    --exclude 'data' --exclude '.env' \
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

If the box already runs another site on 80/443 (e.g. cyberalertx.com on
an existing nginx), let that nginx be Hoba's TLS terminator too.

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
curl -fsI https://hoba.<your-domain>/api/v1/openapi.json
# → HTTP/2 200, server: nginx, then proxied to uvicorn
```

If you get a 502: the Hoba containers aren't listening on the expected
loopback ports. `docker compose ps` to confirm `127.0.0.1:8000` and
`127.0.0.1:5173` are bound; `docker compose logs api webapp --tail 50`
for the trace.

## 5. Smoke test

```bash
# From your laptop / phone, not the server:
curl -fsSL https://hoba.example.com/api/v1/docs/openapi.json | head -1
# → {"openapi":"3.1.0", ...}

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
```

## 9. Common first-deploy gotchas

- **Caddy stuck on "obtaining certificate":** DNS hasn't propagated yet
  (`dig` returns the wrong IP) OR port 80 is blocked at the firewall
  (`ufw status` / VPS provider's firewall console). Caddy retries every
  ~2 minutes.
- **Bot menu button still points at ngrok URL:** you restarted the bot
  but `.env`'s `WEBAPP_URL` still has the dev URL. Update `.env`,
  `docker compose restart bot`, check `logs bot`.
- **Webapp loads but `/api/v1/*` 502s:** API container crashed.
  `docker compose logs api --tail 200` to see the trace.
- **`room_not_found` from a share link** (Stage A regression): the
  Direct Link Mini App URL in BotFather `/myapps` still points at
  ngrok. Update it to the prod URL.

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
