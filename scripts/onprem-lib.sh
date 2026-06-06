#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

COMPOSE_FILE="${BIDTOOL_ONPREM_COMPOSE_FILE:-$ROOT_DIR/compose.production.yml}"
ENV_FILE="${BIDTOOL_ONPREM_ENV_FILE:-$ROOT_DIR/deploy/onprem/.env.customer}"
ENV_EXAMPLE_FILE="$ROOT_DIR/deploy/onprem/.env.customer.example"
PROJECT_NAME="${BIDTOOL_ONPREM_PROJECT:-bidtool-onprem}"

log() {
  printf '\n[bidtool-onprem] %s\n' "$*"
}

fail() {
  printf '\n[bidtool-onprem] %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -p "$PROJECT_NAME" "$@"
}

random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
    return
  fi

  LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 48
}

replace_env_value() {
  key="$1"
  value="$2"
  tmp_file="$(mktemp)"
  awk -v key="$key" -v value="$value" '
    BEGIN { replaced = 0 }
    $0 ~ "^" key "=" {
      print key "=" value
      replaced = 1
      next
    }
    { print }
    END {
      if (replaced == 0) {
        print key "=" value
      }
    }
  ' "$ENV_FILE" >"$tmp_file"
  mv "$tmp_file" "$ENV_FILE"
}

ensure_env_file() {
  if [ -f "$ENV_FILE" ]; then
    return
  fi

  [ -f "$ENV_EXAMPLE_FILE" ] || fail "Missing template: $ENV_EXAMPLE_FILE"

  mkdir -p "$(dirname "$ENV_FILE")"
  cp "$ENV_EXAMPLE_FILE" "$ENV_FILE"
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  replace_env_value "POSTGRES_PASSWORD" "$(random_secret)"
  replace_env_value "SEARXNG_SECRET" "$(random_secret)"

  log "Created customer env file at $ENV_FILE"
  log "Review APP_BASE_URL, BIDTOOL_SITE_ADDRESS, and host ports before exposing this server."
}

load_env_file() {
  ensure_env_file
  # shellcheck disable=SC1090
  set -a
  . "$ENV_FILE"
  set +a
}

check_docker() {
  require_command docker
  docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is unavailable."
  docker info >/dev/null 2>&1 || fail "Docker daemon is not running."
}

backup_dir() {
  load_env_file
  printf '%s\n' "${BIDTOOL_BACKUP_DIR:-$ROOT_DIR/backups/onprem}"
}

print_stack_summary() {
  load_env_file
  compose ps
  printf '\nBidTool URL: %s\n' "${APP_BASE_URL:-http://localhost:13000}"
  printf 'Customer env: %s\n' "$ENV_FILE"
}
