#!/usr/bin/env bash
#
# Hoba! production deploy (shared-VPS profile).
#
# Run ON the server, from the repo root. Pulls the latest main, rebuilds
# the containers, runs migrations (via the API container's AUTO_MIGRATE on
# start), and prints a smoke summary. Idempotent + safe to re-run.
#
# Usage:
#   ./scripts/deploy.sh                 # pull + build + up (all services)
#   ./scripts/deploy.sh --no-pull       # skip git pull (deploy current tree)
#   ./scripts/deploy.sh --only webapp   # rebuild + restart ONE service only
#                                       # (--no-deps; leaves api/bot/redis up)
#
# Prereqs: docker compose, a populated .env, the shared-VPS compose file.
set -euo pipefail

# compose.shared.yaml is an OVERRIDE — it carries only the shared-VPS
# deltas (loopback port binds, prod webapp target, Caddy disabled) and
# relies on the base file for the actual service definitions. It MUST be
# layered on top of the base; used alone, `docker compose` sees no api/bot
# image and the deploy is silently wrong. This mirrors how the running
# stack was composed (verify with `docker compose ls`).
BASE_FILE="${HOBA_BASE_COMPOSE_FILE:-docker-compose.yml}"
OVERRIDE_FILE="${HOBA_COMPOSE_FILE:-compose.shared.yaml}"
DO_PULL=1
ONLY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-pull) DO_PULL=0 ;;
    --only)
      shift
      [[ $# -gt 0 ]] || { echo "✗ --only needs a service name (e.g. webapp)" >&2; exit 2; }
      ONLY="$1"
      ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

compose() { docker compose -f "$BASE_FILE" -f "$OVERRIDE_FILE" "$@"; }

echo "▶ Hoba! deploy — compose files: $BASE_FILE + $OVERRIDE_FILE${ONLY:+ (only: $ONLY)}"

for f in "$BASE_FILE" "$OVERRIDE_FILE"; do
  if [[ ! -f "$f" ]]; then
    echo "✗ $f not found — run this from the repo root on the server." >&2
    exit 1
  fi
done
if [[ ! -f .env ]]; then
  echo "✗ .env not found — copy .env.example and fill TELEGRAM_BOT_TOKEN etc." >&2
  exit 1
fi

if [[ "$DO_PULL" == "1" ]]; then
  echo "▶ git pull --ff-only"
  git pull --ff-only
fi

if [[ -n "$ONLY" ]]; then
  echo "▶ Building + restarting only: $ONLY (--no-deps)"
  compose up -d --build --no-deps "$ONLY"
else
  echo "▶ Building + starting containers"
  compose up -d --build
fi

echo "▶ Waiting for the API to report healthy…"
api_ok=0
for _ in $(seq 1 30); do
  if compose exec -T api python -c "import urllib.request,sys; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)" 2>/dev/null; then
    api_ok=1; break
  fi
  sleep 2
done

echo
echo "▶ Status"
compose ps
echo
if [[ "$api_ok" == "1" ]]; then
  echo "✓ API healthy. Deploy complete."
else
  echo "⚠ API health check did not pass in time — check: compose logs --tail 100 api"
  exit 1
fi
