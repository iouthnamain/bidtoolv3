#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck disable=SC1091
. "$SCRIPT_DIR/onprem-lib.sh"

check_docker
load_env_file

if [ "${BIDTOOL_UPDATE_BACKUP:-true}" = "true" ]; then
  log "Creating backup before update"
  "$SCRIPT_DIR/onprem-backup.sh"
fi

log "Pulling updated images"
compose pull

log "Recreating BidTool on-prem stack"
compose up -d --remove-orphans

print_stack_summary
