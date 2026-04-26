#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

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

echo "==> Starting Next.js dev server"
exec bun run dev
