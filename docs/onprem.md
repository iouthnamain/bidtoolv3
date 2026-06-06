# BidTool On-Prem Deployment

This package runs one private BidTool instance for one customer. The default
stack is:

- Caddy reverse proxy on the host port you choose
- BidTool Next.js application container
- PostgreSQL database with a named Docker volume
- SearXNG and Valkey for product web search

## Requirements

- Linux server or VM
- Docker Engine with Docker Compose plugin
- Outbound HTTPS access for BidWinner, package downloads, and image pulls
- A DNS name if you want automatic HTTPS through Caddy

## Install

From the project root or extracted on-prem bundle:

```bash
sh scripts/onprem-install.sh
```

The installer creates `deploy/onprem/.env.customer` from the template if it is
missing and generates local secrets for PostgreSQL and SearXNG.

Review these values before exposing the server:

```bash
APP_BASE_URL=http://localhost:13000
BIDTOOL_HTTP_PORT=13000
BIDTOOL_HTTPS_PORT=13443
BIDTOOL_SITE_ADDRESS=:80
```

For a LAN-only install, keep `BIDTOOL_SITE_ADDRESS=:80` and use
`APP_BASE_URL=http://server-ip:13000` or an internal hostname.

For a domain with Caddy-managed HTTPS, point DNS to the server and set:

```bash
BIDTOOL_HTTP_PORT=80
BIDTOOL_HTTPS_PORT=443
BIDTOOL_SITE_ADDRESS=bidtool.customer.example.com
APP_BASE_URL=https://bidtool.customer.example.com
```

Then run:

```bash
sh scripts/onprem-update.sh
```

## Update

Update pulls the configured image, recreates containers, and runs migrations
from the app container startup:

```bash
sh scripts/onprem-update.sh
```

By default, update creates a database backup first. Disable that only for
controlled maintenance windows:

```bash
BIDTOOL_UPDATE_BACKUP=false sh scripts/onprem-update.sh
```

## Backup

Create a PostgreSQL custom-format dump:

```bash
sh scripts/onprem-backup.sh
```

The default location is `./backups/onprem`. Change it in
`deploy/onprem/.env.customer`:

```bash
BIDTOOL_BACKUP_DIR=/secure/backups/bidtool
```

Copy backups off the server. Docker volumes are not a backup strategy.

## Restore

Stop the app, restore the database, then restart the app:

```bash
sh scripts/onprem-restore.sh backups/onprem/bidtool-YYYYMMDD-HHMMSS.dump
```

The restore script supports PostgreSQL custom-format dumps and plain `.sql`
files.

## Desktop Client

The Electron desktop client can connect to the on-prem server instead of
running its bundled local server.

Options:

- Set `BIDTOOL_SERVER_URL=https://bidtool.customer.example.com` next to the
  desktop executable or in the desktop environment.
- Open `/desktop` inside the desktop app and save the customer server URL.

If `BIDTOOL_SERVER_URL` is set by an admin, the in-app setting is read-only.

## Operations

Useful commands:

```bash
docker compose --env-file deploy/onprem/.env.customer -f compose.production.yml ps
docker compose --env-file deploy/onprem/.env.customer -f compose.production.yml logs -f app
docker compose --env-file deploy/onprem/.env.customer -f compose.production.yml logs -f caddy
```

The application health endpoint is:

```text
/api/health
```

## Release Bundle

Create a customer bundle from the current checkout:

```bash
sh scripts/onprem-package-release.sh 0.1.0
```

The archive is written to:

```text
dist-onprem/bidtoolv3-onprem-0.1.0.tar.gz
```
