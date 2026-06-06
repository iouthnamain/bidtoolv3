#!/bin/sh
set -eu

if [ "${BIDTOOL_RUN_MIGRATIONS:-true}" = "true" ]; then
  node /app/scripts/db-migrate-runtime.mjs
fi

exec "$@"
