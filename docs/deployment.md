# Deployment Guide

BidTool v3 ships to three independent deployment surfaces from a single
codebase. Every surface is built and published by the `Release` GitHub Actions
workflow when you push a `v*` tag.

| Surface | Audience | Runtime | Database |
| --- | --- | --- | --- |
| **Vercel web** | Internal hosted instance | Vercel (Next.js standalone) | Hosted PostgreSQL |
| **On-prem Docker** | B2B single-tenant customers | Docker Compose (Caddy + app + Postgres) | Bundled PostgreSQL container |
| **Electron desktop** | Individual users / on-prem clients | Local Electron window or remote server | Local Docker Postgres or remote |

All surfaces run the same Next.js app (`output: "standalone"`). The
`BIDTOOL_DEPLOYMENT_SURFACE` env var (`web` | `onprem` | `desktop-bundled`)
tells the running app which surface it is.

---

## Prerequisites

- Node.js `20+` (`.nvmrc` pins `20`) and Bun `1.3.11`
- Docker Engine with the Compose plugin (for on-prem and local Postgres)
- For Vercel deploys: the Vercel CLI (`npm i -g vercel`) and access to the
  `bidtoolv3` project (`team_TRwQy8STQFgfjC3d9HP1eC92`)

---

## Environment Variables

Server env is validated by `src/env.js` (`@t3-oss/env-nextjs`). During Docker
builds validation is skipped with `SKIP_ENV_VALIDATION="1"`.

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | yes | — | `development` \| `test` \| `production` |
| `DATABASE_URL` | yes (prod) | — | Postgres connection string. Write flows fail if empty. |
| `APP_BASE_URL` | recommended | — | Public URL users open in the browser/client |
| `BIDWINNER_BASE_URL` | no | `https://bidwinner.info` | Upstream BidWinner site |
| `BIDWINNER_TIMEOUT_MS` | no | `15000` | Upstream request timeout |
| `ENABLE_DEMO_SEED` | no | `false` | Keep `false` in production |
| `SCRAPE_MAX_CONCURRENT_JOBS` | no | `2` | Scrape queue concurrency |
| `SCRAPE_MAX_CONCURRENT_PAGES` | no | `2` | Pages per scrape job |
| `IMPORT_MAX_CONCURRENT_JOBS` | no | `2` | Import queue concurrency |
| `SCRAPE_JOB_TTL_DAYS` | no | `7` | Scrape job retention |
| `EXCEL_RESEARCH_MAX_CONCURRENT_JOBS` | no | `1` | Excel research job concurrency — see [excel-product-research.md](./excel-product-research.md) |
| `EXCEL_RESEARCH_BATCH_SIZE` | no | `10` | Rows per research batch |
| `EXCEL_RESEARCH_JOB_TTL_DAYS` | no | `7` | Excel research job retention |
| `SEARXNG_BASE_URL` | no | — | SearXNG base URL for `/enrich` web research (step 3) |
| `BIDTOOL_EXCEL_RESEARCH_DIR` | no | `data/excel-research` | On-disk storage for research job files |
| `AI_MATCH_AUTO_THRESHOLD` | no | `0.85` | Auto-match confidence cutoff |
| `AI_MATCH_CANDIDATE_THRESHOLD` | no | `0.4` | Candidate suggestion cutoff |
| `BIDTOOL_DEPLOYMENT_SURFACE` | no | — | `web` \| `onprem` \| `desktop-bundled` |
| `BIDTOOL_APP_VERSION` | no | `0.1.0` | Stamped at build/release time |
| `BIDTOOL_RUN_MIGRATIONS` | no | `true` | On-prem: run migrations on container start |
| `BIDTOOL_MIGRATION_ATTEMPTS` | no | `30` | Migration retry count while Postgres boots |
| `BIDTOOL_MIGRATION_RETRY_MS` | no | `2000` | Delay between migration retries |
| `BIDTOOL_SERVER_URL` | no | — | Desktop: point client at a remote on-prem server |

> The app does not have authentication by design — it is a single-user / single-tenant
> tool. On-prem isolation is per-customer (one stack per customer), and network
> exposure is controlled by Caddy and host ports, not in-app auth. Do not expose
> an on-prem instance to the public internet without a trusted network boundary
> or external access control in front of Caddy.

---

## 1. Vercel Web Production

Production web deploys are **promoted by the release workflow on `v*` tags**, not
automatically from `main`. The app is served at `https://bidtoolv3.vercel.app`.

### Automated (recommended)

```bash
bun run release status   # show current and next version
bun run release patch    # tag + push -> triggers the Release workflow
```

The `deploy-vercel` job runs:

```bash
vercel pull --yes --environment=production --token="$VERCEL_TOKEN"
vercel build --prod --token="$VERCEL_TOKEN"
vercel deploy --prebuilt --prod --token="$VERCEL_TOKEN" --json
```

Required GitHub Actions secrets: `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`,
`VERCEL_TOKEN`.

### Manual deploy

```bash
vercel pull --yes --environment=production
vercel build --prod
vercel deploy --prebuilt --prod
```

### Production environment

Set these in the Vercel project (Settings → Environment Variables, Production):

- `DATABASE_URL` — non-empty Postgres URL. Pages may still render if missing, but
  tRPC write functions (material create/import/delete) will fail.
- `APP_BASE_URL` — `https://bidtoolv3.vercel.app`
- `ENABLE_DEMO_SEED` — `false`

### Production migrations

After pushing schema changes, apply migrations **before** testing write flows.
Use the runtime migration script — it reads only process env and ignores local
`.env`:

```bash
node scripts/db-migrate-runtime.mjs
```

When running through the Vercel CLI, run from a directory **without** a local
`.env` so `vercel env run` does not merge local values into the child process:

```bash
repo_dir="$(pwd)"
tmp_dir="$(mktemp -d)"
cp -R .vercel "$tmp_dir/.vercel"
(
  cd "$tmp_dir"
  vercel env run --environment production -- node "$repo_dir/scripts/db-migrate-runtime.mjs"
)
rm -rf "$tmp_dir"
```

Verify the production `DATABASE_URL` is present without printing the secret:

```bash
tmp_dir="$(mktemp -d)"
cp -R .vercel "$tmp_dir/.vercel"
(
  cd "$tmp_dir"
  vercel env run --environment production -- node -e "console.log(process.env.DATABASE_URL ? 'DATABASE_URL set' : 'DATABASE_URL missing')"
)
rm -rf "$tmp_dir"
```

---

## 2. On-Prem Docker (single-tenant)

Each B2B customer runs one isolated stack defined in `compose.production.yml`:

- **caddy** — reverse proxy (gzip/zstd, optional TLS), exposes host ports
- **app** — BidTool Next.js container (`ghcr.io/iouthnamain/bidtoolv3:<tag>`)
- **postgres** — `postgres:16-alpine` with a persistent named volume

On startup the app container runs `docker/entrypoint.sh`, which applies
migrations (`db-migrate-runtime.mjs`) when `BIDTOOL_RUN_MIGRATIONS=true`, then
starts `node server.js`. Health is checked at `/api/health`.

### First install

```bash
bun run onprem:install
```

This (`scripts/onprem-install.sh`):

1. Verifies Docker + Compose are available and the daemon is running.
2. Creates `deploy/onprem/.env.customer` from `.env.customer.example` if missing,
   generating a random `POSTGRES_PASSWORD`.
3. Pulls images (falls back to building locally from the `Dockerfile` if the
   pull fails).
4. Starts the stack with `docker compose up -d --remove-orphans`.

Before exposing the server, review in `deploy/onprem/.env.customer`:

- `APP_BASE_URL` — public URL users type (e.g. `http://host:13000`)
- `BIDTOOL_SITE_ADDRESS` — Caddy site address inside the container
  (`:80` for LAN HTTP behind the host port; a domain like
  `bidtool.customer.example.com` when DNS points here and ports 80/443 map)
- `BIDTOOL_HTTP_PORT` / `BIDTOOL_HTTPS_PORT` — host ports (default `13000` / `13443`)
- `POSTGRES_PASSWORD` — keep the generated secret

### Update an existing customer

```bash
bun run onprem:update                  # latest pinned image
BIDTOOL_IMAGE_TAG=0.2.0 bun run onprem:update   # pin a specific version
```

This backs up the database first (unless `BIDTOOL_UPDATE_BACKUP=false`), pulls
updated images, and recreates the stack. Migrations run automatically on app
start.

### Backup and restore

```bash
bun run onprem:backup    # -> backups/onprem/bidtool-YYYYMMDD-HHMMSS.dump (pg_dump -Fc)
bun run onprem:restore -- backups/onprem/bidtool-YYYYMMDD-HHMMSS.dump
```

Restore accepts custom-format `.dump` files (via `pg_restore --clean
--if-exists`) and plain `.sql` files. It stops the app, restores, then restarts
the app and Caddy. Backup location is configurable via `BIDTOOL_BACKUP_DIR`.

### Distributable bundle

```bash
bun run onprem:bundle   # -> dist-onprem/bidtoolv3-onprem-<version>.tar.gz
```

The tarball contains `compose.production.yml`, the Caddy config, the
`.env.customer.example` (with `BIDTOOL_APP_IMAGE` pinned to the version tag),
the `onprem-*` scripts, the README, and `releases/`. Ship this to a customer
host that has Docker; they run `scripts/onprem-install.sh` to bring up the
stack.

### Building the image locally

The release workflow publishes the image to GHCR. To build it by hand:

```bash
docker build \
  --build-arg BIDTOOL_APP_VERSION=0.1.0 \
  --build-arg BIDTOOL_DEPLOYMENT_SURFACE=onprem \
  -t ghcr.io/iouthnamain/bidtoolv3:local .
```

The Dockerfile is multi-stage: Bun installs deps and builds the Next.js
standalone output, then a `node:22-alpine` runner serves it under `tini` with a
`/api/health` healthcheck.

---

## 3. Electron Desktop

The desktop app is an extra entrypoint that either runs the bundled local server
or connects to a remote on-prem server.

### Develop

```bash
bun run desktop:dev    # starts the local stack + opens Electron
```

### Build artifacts

```bash
bun run desktop:pack    # unpacked app for a quick smoke test
bun run desktop:build   # installer/package (NSIS on Windows, AppImage on Linux)
```

`electron-builder.config.cjs` publishes to the `iouthnamain/bidtoolv3` GitHub
repo. Packaged builds use semver + build metadata, check GitHub Releases in the
background, and surface an update pill plus Settings → About controls.

### Pointing the desktop client at an on-prem server

Set `BIDTOOL_SERVER_URL` next to the executable, or open
`/settings#desktop-client` in the app and save the server URL. When an admin
sets `BIDTOOL_SERVER_URL`, the in-app field becomes read-only. With no URL
configured, the desktop app runs the bundled Next.js app locally (Postgres still
comes from the Docker workflow).

---

## Release Workflow Overview

`.github/workflows/release.yml` triggers on `v*` tags (or manual dispatch with a
`release_tag`). Stages:

1. **Quality gates** — `bun run check` + `bun run test`
2. **Resolve version** from the tag (must match `vX.Y.Z[-+meta]`)
3. **Promote Vercel production** (`vercel build --prod` + `deploy --prebuilt`)
4. **Publish on-prem Docker image** to GHCR
5. **Build the on-prem bundle** tarball
6. **Build Windows + Linux desktop** artifacts
7. **Publish a GitHub Release** with `manifest.json`
8. **Commit artifact pins** to `releases/pins.json`

To cut a release:

```bash
bun run release status
bun run release patch        # or release:minor / release:major
```

Or manually:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Rollbacks are handled by `.github/workflows/rollback.yml`. Full update-system
docs live in [`docs/updates/README.md`](updates/README.md).

---

## Troubleshooting

- **Docker commands fail** — ensure the Docker daemon is running before any
  `onprem:*` or `dev:*` command.
- **App container unhealthy** — check `/api/health`; if Postgres is still
  booting, the app retries migrations up to `BIDTOOL_MIGRATION_ATTEMPTS` times.
- **Vercel writes fail with a raw DB error** — confirm production `DATABASE_URL`
  is non-empty and production migrations have been applied.
- **Migration picks up local env on Vercel** — run `db-migrate-runtime.mjs` from
  a directory without a local `.env` (see the temp-dir pattern above).
- **Port conflicts on-prem** — change `BIDTOOL_HTTP_PORT` / `BIDTOOL_HTTPS_PORT`
  in `deploy/onprem/.env.customer`.
