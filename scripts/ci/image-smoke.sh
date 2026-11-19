#!/usr/bin/env bash
set -euo pipefail

: "${IMAGE_REF:?Set IMAGE_REF to the locally built image}"
: "${SOURCE_SHA:?Set SOURCE_SHA}"
: "${BIDTOOL_APP_VERSION:?Set BIDTOOL_APP_VERSION}"
: "${BIDTOOL_BUILD_METADATA:?Set BIDTOOL_BUILD_METADATA}"

task_dir=$(mktemp -d)
owner="bidtool-ci-$(basename "$task_dir" | tr '[:upper:].' '[:lower:]-')"
network="$owner-net"
db="$owner-db"
app="$owner-app"
volume="$owner-data"
network_created=false
volume_created=false
db_created=false
app_created=false
cleanup() {
  result=$?
  if (( result != 0 )); then docker logs "$app" >&2 2>/dev/null || true; fi
  if $app_created; then docker rm -fv "$app" >/dev/null 2>&1 || true; fi
  if $db_created; then docker rm -fv "$db" >/dev/null 2>&1 || true; fi
  if $volume_created; then docker volume rm "$volume" >/dev/null 2>&1 || true; fi
  if $network_created; then docker network rm "$network" >/dev/null 2>&1 || true; fi
  rm -rf "$task_dir"
  exit "$result"
}
trap cleanup EXIT

test "$(docker image inspect "$IMAGE_REF" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$SOURCE_SHA"
docker network create --internal "$network" >/dev/null
network_created=true
docker volume create "$volume" >/dev/null
volume_created=true
docker create --name "$db" --network "$network" --network-alias database \
  -e POSTGRES_USER=bidtool_test -e POSTGRES_PASSWORD=fixture-only \
  -e POSTGRES_DB=bidtool_test_runtime postgres:16 >/dev/null
db_created=true
docker start "$db" >/dev/null
for _ in {1..60}; do
  if docker exec "$db" pg_isready -U bidtool_test -d bidtool_test_runtime >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$db" pg_isready -U bidtool_test -d bidtool_test_runtime >/dev/null
docker create --name "$app" --network "$network" \
  -e DATABASE_URL=postgres://bidtool_test:fixture-only@database:5432/bidtool_test_runtime \
  -e SKIP_ENV_VALIDATION=1 -e BIDTOOL_LOG_LEVEL=error \
  -v "$volume:/app/data" "$IMAGE_REF" >/dev/null
app_created=true
docker start "$app" >/dev/null

probe() {
  for _ in {1..90}; do
    if docker exec "$app" node -e 'fetch("http://127.0.0.1:3000/api/health", {signal: AbortSignal.timeout(2000)}).then(async r => {const b = await r.json(); process.exit(r.ok && b.ok && b.service === "bidtoolv3" ? 0 : 1)}).catch(() => process.exit(1))' >/dev/null 2>&1; then return; fi
    sleep 2
  done
  return 1
}
probe
# Check metadata baked into the runtime, without overriding it in docker run.
docker exec -e EXPECTED_VERSION="$BIDTOOL_APP_VERSION" -e EXPECTED_METADATA="$BIDTOOL_BUILD_METADATA" "$app" node -e '
  const fs = require("fs");
  if (process.env.BIDTOOL_APP_VERSION !== process.env.EXPECTED_VERSION ||
      process.env.BIDTOOL_PACKAGE_VERSION !== process.env.EXPECTED_VERSION ||
      process.env.BIDTOOL_BUILD_METADATA !== process.env.EXPECTED_METADATA) process.exit(1);
  for (const p of ["server.js", ".next/static", "public", "node_modules/next", "drizzle/meta/_journal.json"]) fs.accessSync(p);
  for (const p of [".env", ".env.local", ".env.production", ".env.production.local"]) if (fs.existsSync(p)) process.exit(1);
'
expected=$(node -p 'require("./drizzle/meta/_journal.json").entries.length')
actual=$(docker exec "$db" psql -U bidtool_test -d bidtool_test_runtime -Atc 'SELECT count(*) FROM drizzle.__drizzle_migrations')
test "$actual" = "$expected"
# Repeat the assembled migration command to catch non-idempotent startup.
docker exec "$app" node scripts/db-migrate-runtime.mjs
docker restart "$app" >/dev/null
probe
printf 'Image migration, restart and HTTP liveness passed: %s\n' "$SOURCE_SHA"
