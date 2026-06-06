#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck disable=SC1091
. "$SCRIPT_DIR/onprem-lib.sh"

check_docker
load_env_file

BACKUP_DIR="$(backup_dir)"
mkdir -p "$BACKUP_DIR"

timestamp="$(date +%Y%m%d-%H%M%S)"
backup_file="$BACKUP_DIR/bidtool-${timestamp}.dump"

log "Writing PostgreSQL backup to $backup_file"
if compose exec -T postgres pg_dump \
  -U "${POSTGRES_USER:-bidtool}" \
  -d "${POSTGRES_DB:-bidtoolv3}" \
  -Fc >"$backup_file"; then
  chmod 600 "$backup_file" 2>/dev/null || true
  printf '\nBackup created: %s\n' "$backup_file"
else
  rm -f "$backup_file"
  fail "Backup failed."
fi
