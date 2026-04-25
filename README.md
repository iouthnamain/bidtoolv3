# BidTool v3

BidTool v3 is a Next.js dashboard for tender discovery workflows, Excel-based material review, and product candidate matching. The app uses the T3-style stack with Next.js App Router, tRPC, Drizzle, PostgreSQL, Tailwind CSS, and optional self-hosted SearXNG search.

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Copy local environment values:

```bash
cp -n .env.example .env
```

3. Start PostgreSQL:

```bash
docker compose -p bidtoolv3 up -d postgres
```

4. Run migrations and optional seed:

```bash
npm run db:migrate
npm run db:seed
```

5. Start the app:

```bash
npm run dev
```

## Local SearXNG Search

Start the search profile when using `PRODUCT_WEB_SEARCH_PROVIDER=auto` with a local `SEARXNG_BASE_URL`:

```bash
docker compose -p bidtoolv3 --profile search up -d searxng
```

Then set:

```env
SEARXNG_BASE_URL="http://localhost:8080"
```

The local JSON API can be checked with:

```bash
curl 'http://localhost:8080/search?q=may%20khoan%20gia%20Viet%20Nam&format=json'
```

## Scripts

- `npm run dev` - start Next.js in development mode.
- `npm run build` - create a production build.
- `npm run check` - run ESLint and TypeScript.
- `npm run format:check` - verify Prettier formatting.
- `npm run format:write` - format project files.
- `npm run db:migrate` - apply Drizzle migrations.
- `npm run db:seed` - seed demo data only when `ENABLE_DEMO_SEED=true`.

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
