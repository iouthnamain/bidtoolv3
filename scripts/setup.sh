#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v bun >/dev/null 2>&1; then
  echo "Error: 'bun' not found on PATH. Install from https://bun.sh and re-run." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: 'docker' not found on PATH. Install Docker Engine + Compose plugin and re-run." >&2
  exit 1
fi

echo "==> Installing dependencies"
bun install

if [ ! -f .env ]; then
  echo "==> Creating .env from .env.example"
  cp .env.example .env
else
  echo "==> .env already exists, leaving untouched"
fi

echo "==> Starting Postgres and SearXNG"
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

echo "==> Applying database migrations"
bun run db:migrate

echo "==> Waiting for SearXNG to be reachable"
for i in $(seq 1 30); do
  if curl -fsS 'http://localhost:8080/search?q=bidtool&format=json' >/dev/null 2>&1; then
    echo "    SearXNG ready"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "Error: SearXNG did not become reachable within 30s." >&2
    exit 1
  fi
  sleep 1
done

if grep -Eq '^ENABLE_DEMO_SEED=("?)true("?)$' .env; then
  echo "==> ENABLE_DEMO_SEED=true; seeding demo data"
  bun run db:seed
else
  echo "==> Skipping demo seed (set ENABLE_DEMO_SEED=true in .env to enable)"
fi

echo
echo "Setup complete. Start the dev server with: bun run start:dev"
