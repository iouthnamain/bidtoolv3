# BidTool v3

BidTool v3 is a Next.js dashboard for tender discovery workflows, Excel-based material review, and product candidate matching. The app uses the T3-style stack with Next.js App Router, tRPC, Drizzle, PostgreSQL, Tailwind CSS, and optional self-hosted SearXNG search.

## Requirements

- Node.js `20+` and Bun
- Docker Engine with the Docker Compose plugin

The app can boot locally with PostgreSQL only. SearXNG is optional and is only needed for the Excel product web search flow.

## Quick Start

For a first boot on a new machine:

```bash
bun install
cp .env.example .env
docker compose up -d postgres
bun run db:migrate
bun run dev
```

Then open `http://localhost:3000`.

If you want demo data, set `ENABLE_DEMO_SEED="true"` in `.env` and run:

```bash
bun run db:seed
```

## One-Command Bootstrap

There is also a shortcut for first-time local setup:

```bash
bun run dev:one-time
```

It installs dependencies, copies `.env.example` if `.env` does not exist, starts Docker services, runs migrations, attempts the optional seed, and launches Next.js. If PostgreSQL is still starting when the migration runs, wait a few seconds and rerun `bun run db:migrate`.

## Manual Setup

1. Install dependencies:

```bash
bun install
```

2. Create your local env file:

```bash
cp .env.example .env
```

3. Start PostgreSQL:

```bash
docker compose up -d postgres
```

4. Apply database migrations:

```bash
bun run db:migrate
```

5. Optionally seed demo data:

```bash
# first set ENABLE_DEMO_SEED="true" in .env
bun run db:seed
```

6. Start the app:

```bash
bun run dev
```

## Updating After `git pull`

If you pull newer code later, run the migration again before using the app:

```bash
bun run db:migrate
```

This is especially important before opening `/saved-items`, Smart Views, or workflows that depend on the latest schema.

## Local SearXNG Search

Use this only when you want the Excel product search flow to call a local SearXNG instance.

1. Start the search profile:

```bash
docker compose --profile search up -d searxng
```

2. Update `.env`:

```env
SEARXNG_BASE_URL="http://localhost:8080"
PRODUCT_WEB_SEARCH_PROVIDER="searxng"
```

3. Restart `bun run dev` if it is already running.

4. Check the local JSON API:

```bash
curl 'http://localhost:8080/search?q=may%20khoan%20gia%20Viet%20Nam&format=json'
```

## Troubleshooting

- If startup fails with env validation, recreate `.env` from the latest `.env.example` and re-apply your local changes.
- If you see a Smart View schema warning after pulling new code, run `bun run db:migrate` and reload the page.
- If `bun run db:seed` prints that demo seed was skipped, set `ENABLE_DEMO_SEED="true"` in `.env` first.
- If `bun run db:migrate` cannot connect, PostgreSQL is usually still starting; wait a few seconds and run it again.

## Scripts

- `bun run dev` - start Next.js in development mode.
- `bun run dev:one-time` - install deps, bootstrap `.env`, Docker, migrations, optional seed, and dev server.
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
