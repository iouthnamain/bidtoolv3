# BidTool v3

BidTool v3 is a Next.js dashboard for tender discovery workflows, Excel-based material review, and product candidate matching. The app uses the T3-style stack with Next.js App Router, tRPC, Drizzle, PostgreSQL, Tailwind CSS, and self-hosted SearXNG search for Excel product sourcing.

## Requirements

- Node.js `20+` and Bun
- Docker Engine with the Docker Compose plugin

The local workflow starts PostgreSQL and SearXNG through Docker Compose. PostgreSQL powers the app database; SearXNG powers the Excel product web search flow.

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

It installs dependencies, creates `.env` from `.env.example` only if missing, starts the local PostgreSQL and SearXNG containers, waits for readiness, and applies migrations. It does not seed demo data and it does not overwrite an existing `.env`.

### `bun run dev:update`

Use this after you already ran `git pull`.

```bash
git pull
bun run dev:update
```

It refreshes dependencies, preserves your local `.env`, ensures PostgreSQL and SearXNG are running, and applies any new migrations. It does not run `git pull` for you.

### `bun run dev:run`

Use this for normal daily startup.

```bash
bun run dev:run
```

It ensures `.env` exists, starts PostgreSQL and SearXNG if needed, waits for readiness, applies migrations, and then starts the Next.js dev server. After it boots, open `http://localhost:3000`.

## Windows Quick Launch

If you want a double-click launcher from File Explorer on Windows:

- `launch-maintenance.bat` starts the app and opens `http://localhost:3000/maintenance` when ready. If dependencies are missing, it falls back to the one-time install + run flow automatically.
- `update-maintenance.bat` is the same idea for after `git pull`: it runs `bun run dev:update`, then starts the app, then opens `/maintenance`.

Keep the PowerShell window that opens in the background running while you use the app. These launchers still require Bun on `PATH` and Docker Desktop running.

### Optional Demo Data

Install, update, and run never seed automatically. If you want demo data:

1. Set `ENABLE_DEMO_SEED="true"` in `.env`.
2. Run `bun run db:seed`.

### Legacy Shortcut

`bun run dev:one-time` still works as a backward-compatible install-plus-run shortcut, but `dev:install`, `dev:update`, and `dev:run` are now the primary workflow.

Older aliases `bun run setup`, `bun run start:dev`, and `bun run update` also point to the new workflow for compatibility.

## Local SearXNG Search

The main dev workflow now starts SearXNG automatically:

```bash
bun run dev:run
```

New `.env` files use `SEARXNG_BASE_URL="http://localhost:8080"` from `.env.example`. If your `.env` was created before this default existed, add it manually.

Check the local JSON API:

```bash
curl 'http://localhost:8080/search?q=may%20khoan%20gia%20Viet%20Nam&format=json'
```

## Troubleshooting

- If Docker commands fail, make sure Docker Desktop or the Docker daemon is running before `dev:install`, `dev:update`, or `dev:run`.
- If `/maintenance` shows Postgres or SearXNG not running, click `Khởi động Docker` or rerun `bun run dev:run`.
- If PostgreSQL is still starting, rerun `bun run dev:run` or `bun run db:migrate` after a few seconds.
- If you see a Smart View schema warning after pulling new code, run `bun run dev:update` or `bun run db:migrate`, then reload the page.
- If startup fails with env validation, refresh `.env` from the latest `.env.example` and re-apply your local changes.
- If `bun run db:seed` says demo seed was skipped, set `ENABLE_DEMO_SEED="true"` in `.env` first.

## Scripts

- `bun run dev:install` - first-time machine setup: deps, `.env`, PostgreSQL, SearXNG, and migrations.
- `bun run dev:update` - post-pull sync: deps, PostgreSQL, SearXNG, and migrations.
- `bun run dev:run` - daily startup with env, PostgreSQL, SearXNG, and migration checks before Next.js.
- `bun run dev:one-time` - backward-compatible alias for install plus run.
- `bun run dev:kill` - stop Docker Compose services and BidTool local dev processes when ports are stuck; it uses stop-only Docker commands and does not delete containers or volumes.
- `bun run dev` - start Next.js only, without local stack checks.
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
- [Excel Workspace](docs/07-excel-workspace.md)
- [SearXNG Self-hosted Search](docs/08-searxng-self-hosted-search.md)
- [Workflow Library](docs/workflows/README.md)
