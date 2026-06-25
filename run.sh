#!/usr/bin/env bash
#
# BidTool v3 - one-click local startup for Linux / Ubuntu.
#
# Bash equivalent of run.ps1 / run.bat. From the repo root:
#   ./run.sh
#
# It will:
#   1. Pull the latest code from git
#   2. Make sure the Docker daemon is running
#   3. Ensure .env exists, then refresh deps, start Postgres + SearXNG in
#      Docker, and apply DB migrations (bun run dev:update)
#   4. Prepare auth (host-tenant backfill) and show how to create the
#      first admin when authentication is enabled
#   5. Start the app (bun run dev:run) on http://localhost:3000
#
# Press Ctrl+C to stop the dev server.
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

APP_URL="${BIDTOOL_APP_URL:-http://localhost:3000}"

write_section() {
  echo
  echo "============================================================"
  echo "  $1"
  echo "============================================================"
  echo
}

require_command() {
  local name="$1"
  local help="$2"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "[ERROR] '$name' was not found on your PATH." >&2
    echo "        $help" >&2
    exit 1
  fi
}

get_env_value() {
  local key="$1"
  if [[ ! -f .env ]]; then
    return 0
  fi

  local line trimmed name value
  while IFS= read -r line || [[ -n "$line" ]]; do
    trimmed="${line#"${line%%[![:space:]]*}"}"
    [[ -z "$trimmed" || "$trimmed" == \#* ]] && continue
    [[ "$trimmed" != *"="* ]] && continue

    name="${trimmed%%=*}"
    name="${name%"${name##*[![:space:]]}"}"
    [[ "${name,,}" != "${key,,}" ]] && continue

    value="${trimmed#*=}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"

    if [[ ${#value} -ge 2 ]]; then
      if [[ "$value" == \"*\" && "$value" == *\" ]]; then
        value="${value:1:${#value}-2}"
      elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
        value="${value:1:${#value}-2}"
      fi
    fi

    printf '%s' "$value"
    return 0
  done < .env
}

ensure_docker_ready() {
  if docker info >/dev/null 2>&1; then
    echo "      Docker is ready."
    return 0
  fi

  echo "      Docker daemon is not running."

  if command -v systemctl >/dev/null 2>&1; then
    echo "      Attempting to start Docker via systemd..."
    if systemctl is-active --quiet docker 2>/dev/null; then
      :
    elif systemctl start docker 2>/dev/null; then
      :
    elif sudo systemctl start docker 2>/dev/null; then
      :
    else
      echo "      Could not start Docker automatically."
      echo "      Run: sudo systemctl start docker"
    fi
  else
    echo "      Please start the Docker service manually."
  fi

  echo "      Waiting for Docker to be ready (this can take a minute)..."
  local tries=0
  while (( tries < 40 )); do
    sleep 3
    if docker info >/dev/null 2>&1; then
      echo "      Docker is ready."
      return 0
    fi
    tries=$((tries + 1))
  done

  echo
  echo "[ERROR] Docker did not start within the expected time." >&2
  echo "        Start Docker (e.g. sudo systemctl start docker), then run ./run.sh again." >&2
  exit 1
}

maybe_open_browser() {
  local url="$1"
  if [[ "${BIDTOOL_OPEN_BROWSER:-}" == "1" ]] || [[ -n "${DISPLAY:-}" ]]; then
    if command -v xdg-open >/dev/null 2>&1; then
      (
        uri="$url"
        host="${uri#*://}"
        host="${host%%/*}"
        port="${host##*:}"
        host="${host%%:*}"
        [[ "$port" == "$host" ]] && port=80
        for _ in $(seq 1 90); do
          if (echo >/dev/tcp/"$host"/"$port") >/dev/null 2>&1; then
            break
          fi
          sleep 2
        done
        sleep 1
        xdg-open "$url" >/dev/null 2>&1 || true
      ) &
      return 0
    fi
  fi

  echo "      App URL: $url"
  echo "      (Set BIDTOOL_OPEN_BROWSER=1 to auto-open a desktop browser.)"
}

write_section "BidTool v3 - starting local development environment"

require_command bun "Install Bun from https://bun.sh and try again."
require_command docker "Install Docker Engine + Compose plugin and try again."
require_command git "Install Git and try again."

echo "[1/5] Pulling latest code from git..."
if ! git pull --ff-only; then
  echo
  echo "[WARNING] 'git pull' did not complete cleanly."
  echo "          This usually means you have local changes or a merge is needed."
  echo "          The app will still start with the code you currently have."
  echo
  read -r -p "Continue starting the app anyway? [y/N] " answer
  if [[ ! "$answer" =~ ^[Yy]([Ee][Ss])?$ ]]; then
    echo "Aborted. Resolve the git issue, then run ./run.sh again."
    exit 1
  fi
fi
echo

if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    cp .env.example .env
    echo "      Created .env from .env.example. Review it and add any"
    echo "      required secrets (e.g. AUTH_BOOTSTRAP_TOKEN) if needed."
  else
    echo "[WARNING] No .env and no .env.example found. The app may fail to"
    echo "          start until a .env file is provided."
  fi
  echo
fi

echo "[2/5] Checking Docker..."
ensure_docker_ready
echo

echo "[3/5] Refreshing dependencies, Docker services (Postgres + SearXNG), and database migrations..."
if ! bun run dev:update; then
  echo
  echo "[ERROR] 'bun run dev:update' failed. See the messages above." >&2
  exit 1
fi
echo

echo "[4/5] Checking authentication setup..."
auth_enabled="$(get_env_value AUTH_ENABLED || true)"
auth_token="$(get_env_value AUTH_BOOTSTRAP_TOKEN || true)"

if [[ "${auth_enabled,,}" == "true" ]]; then
  echo "      Authentication is ENABLED. Ensuring the host tenant exists..."
  if ! bun run auth:backfill; then
    echo
    echo "[WARNING] 'bun run auth:backfill' did not complete cleanly."
    echo "          The app will still start; re-run it later with"
    echo "          'bun run auth:backfill' if customer data looks unscoped."
    echo
  fi
  echo
  echo "      ----------------------------------------------------------"
  echo "      FIRST ADMIN ACCOUNT"
  echo "      If no user exists yet, open this page to create the admin:"
  echo "          ${APP_URL}/setup"
  if [[ -n "$auth_token" ]]; then
    echo "      Setup token (from .env AUTH_BOOTSTRAP_TOKEN):"
    echo "          $auth_token"
  else
    echo "      [!] AUTH_BOOTSTRAP_TOKEN is not set in .env - /setup is"
    echo "          DISABLED until you set it. Generate one and add it."
  fi
  echo "      Once a user exists, /setup turns itself off. Manage further"
  echo "      users and tenants under Settings after signing in at /login."
  echo "      ----------------------------------------------------------"
else
  echo "      Authentication is OFF (AUTH_ENABLED is not \"true\"). Skipping."
  echo "      The app runs as the single-user tool with no login."
fi
echo

echo "[5/5] Starting BidTool."
maybe_open_browser "$APP_URL"
echo
echo "      Keep this terminal open while you use the app."
echo
exec bun run dev:run
