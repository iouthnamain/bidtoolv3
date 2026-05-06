# BidTool v3 — Claude Instructions

## Authentication / Authorization — NEVER ADD

**This project must never have authentication or authorization.** It is a single-user local tool. All tRPC procedures intentionally use `publicProcedure` and there is no user/session concept anywhere in the schema or runtime.

Do NOT propose, scaffold, or implement:
- next-auth, Clerk, Auth0, Lucia, or any session/JWT system
- `protectedProcedure` or auth middleware in tRPC
- User tables, ownership columns, or row-level filtering by user
- Login/signup pages, OAuth, or password handling
- Per-user rate limiting (global rate limiting is fine)

If a future request would require multi-user isolation, push back and ask the user to confirm — the default is single-user with no auth.

## Database Migrations

Use `bun run db:migrate` (which runs `scripts/db-migrate.ts`). Do NOT use `drizzle-kit migrate` directly — its TUI swallows errors silently.

To add a migration: edit `src/server/db/schema.ts`, run `bun run db:generate`, review the generated SQL in `drizzle/`, then `bun run db:migrate`.

## Tech Stack

- Next.js 15 (App Router) + React 19
- tRPC v11 + TanStack Query
- Drizzle ORM + PostgreSQL (local Docker)
- Tailwind CSS v4
- Bun for package management and scripts
- SearXNG (local Docker) for product candidate web search
- BidWinner (bidwinner.info) as upstream tender data source

## Conventions

- Path alias: `~/*` → `./src/*`
- Server-only code goes under `src/server/`. Client utilities under `src/lib/` or `src/app/_components/`.
- Search criteria validation lives in `src/lib/search-criteria.ts` — reuse it; do not redefine schemas.
- All user-facing copy is Vietnamese (`vi-VN`).
