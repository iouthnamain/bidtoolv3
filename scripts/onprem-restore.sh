#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck disable=SC1091
. "$SCRIPT_DIR/onprem-lib.sh"

backup_file="${1:-}"
[ -n "$backup_file" ] || fail "Usage: scripts/onprem-restore.sh <backup.dump|backup.sql>"
[ -f "$backup_file" ] || fail "Backup file not found: $backup_file"

check_docker
load_env_file

log "Stopping app before restore"
compose stop app >/dev/null 2>&1 || true

case "$backup_file" in
  *.sql)
    log "Restoring plain SQL backup"
    compose exec -T postgres psql \
      -U "${POSTGRES_USER:-bidtool}" \
      -d "${POSTGRES_DB:-bidtoolv3}" <"$backup_file"
    ;;
  *)
    log "Restoring custom-format PostgreSQL backup"
    compose exec -T postgres pg_restore \
      -U "${POSTGRES_USER:-bidtool}" \
      -d "${POSTGRES_DB:-bidtoolv3}" \
      --clean \
      --if-exists <"$backup_file"
    ;;
esac

log "Starting app and applying migrations"
compose up -d app caddy

print_stack_summary
