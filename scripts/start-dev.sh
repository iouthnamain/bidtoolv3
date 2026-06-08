#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

echo "==> Ensuring Postgres is running"
docker compose up -d postgres

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

echo "==> Starting Next.js dev server"
exec bun run dev
