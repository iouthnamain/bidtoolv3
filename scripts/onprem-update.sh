#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck disable=SC1091
. "$SCRIPT_DIR/onprem-lib.sh"

check_docker
load_env_file

if [ -n "${BIDTOOL_IMAGE_TAG:-}" ]; then
  image="ghcr.io/iouthnamain/bidtoolv3:${BIDTOOL_IMAGE_TAG}"
  log "Pinning on-prem image to ${image}"
  tmp_file="$(mktemp)"
  awk -v image="$image" '
    /^BIDTOOL_APP_IMAGE=/ {
      print "BIDTOOL_APP_IMAGE=" image
      next
    }
    { print }
  ' "$ENV_FILE" >"$tmp_file"
  mv "$tmp_file" "$ENV_FILE"
  # shellcheck disable=SC1090
  set -a
  . "$ENV_FILE"
  set +a
fi

if [ "${BIDTOOL_UPDATE_BACKUP:-true}" = "true" ]; then
  log "Creating backup before update"
  "$SCRIPT_DIR/onprem-backup.sh"
fi

log "Pulling updated images"
compose pull

log "Recreating BidTool on-prem stack"
compose up -d --remove-orphans

print_stack_summary
