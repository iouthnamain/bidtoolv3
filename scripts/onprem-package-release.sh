#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
VERSION="${1:-$(node -e "console.log(require('./package.json').version)")}"
DIST_DIR="$ROOT_DIR/dist-onprem"
STAGE_DIR="$DIST_DIR/bidtoolv3-onprem-$VERSION"
ARCHIVE_PATH="$DIST_DIR/bidtoolv3-onprem-$VERSION.tar.gz"

rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"

copy_path() {
  source_path="$1"
  target_path="$STAGE_DIR/$source_path"
  mkdir -p "$(dirname "$target_path")"
  cp -R "$ROOT_DIR/$source_path" "$target_path"
}

copy_path "compose.production.yml"
copy_path "deploy/caddy"
copy_path "deploy/onprem/.env.customer.example"
copy_path "README.md"
copy_path "scripts/onprem-backup.sh"
copy_path "scripts/onprem-install.sh"
copy_path "scripts/onprem-lib.sh"
copy_path "scripts/onprem-restore.sh"
copy_path "scripts/onprem-update.sh"

env_template="$STAGE_DIR/deploy/onprem/.env.customer.example"
tmp_file="$(mktemp)"
awk -v image="ghcr.io/iouthnamain/bidtoolv3:$VERSION" '
  /^BIDTOOL_APP_IMAGE=/ {
    print "BIDTOOL_APP_IMAGE=" image
    next
  }
  { print }
' "$env_template" >"$tmp_file"
mv "$tmp_file" "$env_template"

chmod +x "$STAGE_DIR"/scripts/onprem-*.sh

tar -C "$DIST_DIR" -czf "$ARCHIVE_PATH" "bidtoolv3-onprem-$VERSION"
printf '%s\n' "$ARCHIVE_PATH"
