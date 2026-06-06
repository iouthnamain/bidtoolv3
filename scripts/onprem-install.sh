#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck disable=SC1091
. "$SCRIPT_DIR/onprem-lib.sh"

check_docker
ensure_env_file
load_env_file

log "Pulling on-prem images"
if ! compose pull; then
  if [ -f "$ROOT_DIR/Dockerfile" ]; then
    log "Image pull failed; building local app image from this checkout"
    compose build app
  else
    fail "Unable to pull images. Check BIDTOOL_APP_IMAGE and registry access in $ENV_FILE."
  fi
fi

log "Starting BidTool on-prem stack"
compose up -d --remove-orphans

print_stack_summary
