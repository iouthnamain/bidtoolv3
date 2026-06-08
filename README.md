# BidTool v3

BidTool v3 is a Next.js dashboard for tender discovery workflows, material catalog import, and BidWinner operations. The app uses the T3-style stack with Next.js App Router, tRPC, Drizzle, PostgreSQL, and Tailwind CSS.

## Requirements

- Node.js `20+` and Bun
- Docker Engine with the Docker Compose plugin

The local workflow starts PostgreSQL through Docker Compose. PostgreSQL powers the app database.

## Local Workflow

Use these three commands on every machine:

```bash
bun run dev:install
bun run dev:update
bun run dev:run
```

### `bun run dev:install`

Use this once on a new machine or fresh clone.

```bash
bun run dev:install
```

It installs dependencies, creates `.env` from `.env.example` only if missing, starts the local PostgreSQL container, waits for readiness, and applies migrations. It does not seed demo data and it does not overwrite an existing `.env`.

### `bun run dev:update`

Use this after you already ran `git pull`.

```bash
git pull
bun run dev:update
```

It refreshes dependencies, preserves your local `.env`, ensures PostgreSQL is running, and applies any new migrations. It does not run `git pull` for you.

### `bun run dev:run`

Use this for normal daily startup.

```bash
bun run dev:run
```

It ensures `.env` exists, starts PostgreSQL if needed, waits for readiness, applies migrations, and then starts the Next.js dev server. After it boots, open `http://localhost:3000`.

## Windows Quick Launch

If you want a double-click launcher from File Explorer on Windows:

- `launch-maintenance.bat` starts the app and opens `http://localhost:3000/maintenance` when ready. If dependencies are missing, it runs install first, then starts the app.
- `update-maintenance.bat` is the same idea for after `git pull`: it runs `bun run dev:update`, then starts the app, then opens `/maintenance`.

Keep the PowerShell window that opens in the background running while you use the app. These launchers still require Bun on `PATH` and Docker Desktop running.

### Optional Demo Data

Install, update, and run never seed automatically. If you want demo data:

1. Set `ENABLE_DEMO_SEED="true"` in `.env`.
2. Run `bun run db:seed`.

### Compatibility Aliases

Older aliases `bun run setup`, `bun run start:dev`, and `bun run update` point to the primary local workflow for compatibility.

## On-Prem Single-Tenant Package

For B2B customers, BidTool can run as one isolated customer deployment with the
production Docker stack:

- Caddy reverse proxy
- BidTool Next.js app container
- PostgreSQL

Create or update the customer stack:

```bash
bun run onprem:install
bun run onprem:update
```

Back up and restore the customer database:

```bash
bun run onprem:backup
bun run onprem:restore -- backups/onprem/bidtool-YYYYMMDD-HHMMSS.dump
```

Create a distributable customer bundle:

```bash
bun run onprem:bundle
```

Customer configuration lives in `deploy/onprem/.env.customer`, created from
`deploy/onprem/.env.customer.example` on first install. See
[On-Prem Deployment](docs/onprem.md) for ports, HTTPS, update, backup, restore,
and operations details.

## Desktop App

Electron is an additional desktop entrypoint. It can either run the bundled local
server or connect to a customer on-prem server.

Use this during development:

```bash
bun run desktop:dev
```

Build an unpacked desktop app for a quick local smoke test:

```bash
bun run desktop:pack
```

Build an installer/package:

```bash
bun run desktop:build
```

For on-prem customers, set `BIDTOOL_SERVER_URL` next to the desktop executable
or open `/desktop` inside the desktop app and save the customer server URL. When
`BIDTOOL_SERVER_URL` is set by an admin, the in-app setting is read-only.

When no server URL is configured, the desktop app runs the same Next.js
application in a local Electron window. PostgreSQL still runs through the
existing Docker workflow.

### GitHub Releases

Desktop releases, on-prem bundles, and the on-prem Docker image are built by
GitHub Actions.

To publish a release from the command line:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The `Release` workflow builds Windows and Linux desktop artifacts, publishes the
on-prem Docker image to GitHub Container Registry, creates the on-prem bundle,
and uploads release assets to GitHub Releases. You can also run the workflow
manually and provide a release tag.

The Windows installer is currently unsigned, so Windows SmartScreen can show a warning until a code-signing certificate is added.

Packaged desktop builds use the release tag as the Electron app version, check GitHub Releases in the background, and show an in-app desktop update notice when a newer version is available. The notice downloads the installer update first, then switches the button to restart and install.

## Local PostgreSQL

New `.env` files use a non-default Postgres host port to avoid common local conflicts:

- `POSTGRES_HOST_PORT="55432"`
- `DATABASE_URL="postgresql://bidtool:bidtool@localhost:55432/bidtoolv3"`

If your `.env` was created before these defaults existed, update those values manually.

## Troubleshooting

- If Docker commands fail, make sure Docker Desktop or the Docker daemon is running before `dev:install`, `dev:update`, or `dev:run`.
- If `/maintenance` shows Postgres not running, click `Khởi động Docker` or rerun `bun run dev:run`.
- If PostgreSQL is still starting, rerun `bun run dev:run` or `bun run db:migrate` after a few seconds.
- If you see a Smart View schema warning after pulling new code, run `bun run dev:update` or `bun run db:migrate`, then reload the page.
- If startup fails with env validation, refresh `.env` from the latest `.env.example` and re-apply your local changes.
- If `bun run db:seed` says demo seed was skipped, set `ENABLE_DEMO_SEED="true"` in `.env` first.

## Scripts

- `bun run dev:install` - first-time machine setup: deps, `.env`, PostgreSQL, and migrations.
- `bun run dev:update` - post-pull sync: deps, PostgreSQL, and migrations.
- `bun run dev:run` - daily startup with env, PostgreSQL, and migration checks before Next.js.
- `bun run dev:kill` - stop Docker Compose services and BidTool local dev processes when ports are stuck; it uses stop-only Docker commands and does not delete containers or volumes.
- `bun run dev` - start Next.js only, without local stack checks.
- `bun run desktop:dev` - start the local stack and open the app in Electron for development.
- `bun run desktop:pack` - build Next standalone output and create an unpacked Electron app.
- `bun run desktop:build` - build Next standalone output and package the Electron app.
- `bun run onprem:install` - create customer env if needed and start the production on-prem stack.
- `bun run onprem:update` - back up, pull images, recreate containers, and run migrations.
- `bun run onprem:backup` - create a PostgreSQL custom-format backup.
- `bun run onprem:restore -- <backup>` - restore a backup and restart the app.
- `bun run onprem:bundle` - create a distributable on-prem archive.
- `bun run build` - create a production build.
- `bun run start` - run the production server after `bun run build`.
- `bun run preview` - build and start production locally in one command.
- `bun run check` - run ESLint and TypeScript.
- `bun run format:check` - verify Prettier formatting.
- `bun run format:write` - format project files.
- `bun run db:migrate` - apply Drizzle migrations.
- `bun run db:seed` - seed demo data only when `ENABLE_DEMO_SEED=true`.
- `bun run db:studio` - open Drizzle Studio.

## Documentation

Project docs live in `docs/`:

- [Docs overview](docs/README.md)
- [Product Brief](docs/01-product-brief.md)
- [UX/UI Dashboard Workflows](docs/02-uxui-dashboard-workflows.md)
- [Technical Architecture](docs/03-technical-architecture.md)
- [MVP Roadmap](docs/04-mvp-roadmap.md)
- [Data Source Strategy](docs/05-data-source-strategy.md)
- [On-Prem Deployment](docs/onprem.md)
- [Workflow Library](docs/workflows/README.md)
