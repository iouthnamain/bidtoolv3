#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi
SEARXNG_PROBE_URL="${SEARXNG_BASE_URL:-http://localhost:18080}"
SEARXNG_PROBE_URL="${SEARXNG_PROBE_URL%/}/search?q=bidtool&format=json"

echo "==> Ensuring Postgres and SearXNG are running"
docker compose --profile search up -d postgres searxng

echo "==> Waiting for Postgres to be ready"
for i in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U bidtool -d bidtoolv3 >/dev/null 2>&1; then
    echo "    Postgres ready"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "Error: Postgres did not become ready within 30s." >&2
    exit 1
  fi
  sleep 1
done

echo "==> Waiting for SearXNG to be reachable"
for i in $(seq 1 30); do
  if curl -fsS "$SEARXNG_PROBE_URL" >/dev/null 2>&1; then
    echo "    SearXNG ready"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "Error: SearXNG did not become reachable within 30s." >&2
    exit 1
  fi
  sleep 1
done

echo "==> Starting Next.js dev server"
exec bun run dev
