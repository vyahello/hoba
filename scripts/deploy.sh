#!/usr/bin/env bash
#
# Hoba! production deploy (shared-VPS profile).
#
# Run ON the server, from the repo root. Pulls the latest main, rebuilds
# the containers, runs migrations (via the API container's AUTO_MIGRATE on
# start), and prints a smoke summary. Idempotent + safe to re-run.
#
# Usage:
#   ./scripts/deploy.sh                 # pull + build + up
#   ./scripts/deploy.sh --no-pull       # skip git pull (deploy current tree)
#
# Prereqs: docker compose, a populated .env, the shared-VPS compose file.
set -euo pipefail

COMPOSE_FILE="${HOBA_COMPOSE_FILE:-compose.shared.yaml}"
DO_PULL=1
for arg in "$@"; do
  case "$arg" in
    --no-pull) DO_PULL=0 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

echo "▶ Hoba! deploy — compose file: $COMPOSE_FILE"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "✗ $COMPOSE_FILE not found — run this from the repo root on the server." >&2
  exit 1
fi
if [[ ! -f .env ]]; then
  echo "✗ .env not found — copy .env.example and fill TELEGRAM_BOT_TOKEN etc." >&2
  exit 1
fi

if [[ "$DO_PULL" == "1" ]]; then
  echo "▶ git pull --ff-only"
  git pull --ff-only
fi

echo "▶ Building + starting containers"
compose up -d --build

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
