# 02 — Monorepo layout

## Overview

Move from a single Next.js app to a **Bun + Turborepo** monorepo. Existing `src/` code is migrated incrementally into packages; Next.js is removed after parity.

## Target directory tree

```
bidtoolv3/
├── apps/
│   ├── web/                    # Vite + React SPA
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── routes/         # TanStack Router file routes
│   │   │   ├── features/       # materials/, search/, scrape/, ...
│   │   │   ├── components/     # shared UI (from app/_components/ui)
│   │   │   └── lib/            # api-client, storage-keys
│   │   └── package.json
│   ├── api/                    # Hono HTTP server
│   │   ├── src/
│   │   │   ├── index.ts        # listen()
│   │   │   ├── app.ts          # Hono app + middleware
│   │   │   ├── routes/         # v1 routers per domain
│   │   │   ├── sse/            # job event streams
│   │   │   └── context.ts      # db, env per request
│   │   └── package.json
│   └── worker/                 # Job processor
│       ├── src/
│       │   ├── index.ts
│       │   ├── scheduler.ts    # from job-scheduler.ts
│       │   └── handlers/       # scrape, import, export
│       └── package.json
├── packages/
│   ├── contracts/              # Zod schemas + TS types (API DTOs)
│   │   └── src/
│   │       ├── materials.ts
│   │       ├── scrape-jobs.ts
│   │       └── index.ts
│   ├── domain/                 # Business logic (no HTTP framework)
│   │   └── src/
│   │       ├── services/       # migrated from src/server/services/
│   │       ├── lib/            # migrated from src/lib/
│   │       └── db/
│   │           ├── schema.ts   # moved from src/server/db/
│   │           └── index.ts
│   ├── ui/                     # Optional: shared design system
│   └── config/                 # eslint, tsconfig bases
├── drizzle/                    # unchanged migration folder
├── electron/                   # spawns api + worker; loads web URL
├── deploy/
├── docs/
├── turbo.json
├── package.json                # workspaces root
└── compose.production.yml      # web + api + worker + postgres + caddy
```

## Package dependency graph

```
apps/web        → contracts, ui (optional)
apps/api        → contracts, domain
apps/worker     → contracts, domain
packages/domain → contracts (types only where needed)
```

**Rule:** `domain` must not import from `apps/*`. No circular deps.

## Mapping from current `src/`

| Current path | Target |
| --- | --- |
| `src/app/_components/ui/*` | `packages/ui` or `apps/web/src/components/ui` |
| `src/app/_components/materials/*` | `apps/web/src/features/materials` |
| `src/app/_components/dashboard/*` | `apps/web/src/features/dashboard` |
| `src/server/services/*` | `packages/domain/src/services` |
| `src/server/db/*` | `packages/domain/src/db` |
| `src/server/api/routers/*` | `apps/api/src/routes` (thin adapters) |
| `src/lib/*` | `packages/domain/src/lib` or `apps/web/src/lib` (if UI-only) |
| `src/trpc/*` | **Removed** after REST client in place |
| `src/app/api/*` | `apps/api/src/routes` |
| `instrumentation.ts` | **Removed** — worker owns scheduler |

## TypeScript path aliases

Root `tsconfig.json` paths:

```json
{
  "compilerOptions": {
    "paths": {
      "@bidtool/contracts": ["./packages/contracts/src"],
      "@bidtool/domain": ["./packages/domain/src"],
      "@bidtool/ui": ["./packages/ui/src"]
    }
  }
}
```

Apps extend base config; `domain` has `composite: true` for project references.

## Turborepo tasks

`turbo.json` pipeline:

| Task | Depends on | Outputs |
| --- | --- | --- |
| `build` | `^build` | `dist/`, `build/` |
| `typecheck` | `^typecheck` | — |
| `test` | `^build` | — |
| `dev` | — | persistent |

```json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", "build/**"]
    },
    "dev": { "cache": false, "persistent": true },
    "typecheck": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["^build"] }
  }
}
```

## Environment variables

Split by process:

| Variable | web | api | worker |
| --- | --- | --- | --- |
| `VITE_API_BASE_URL` | ✓ | — | — |
| `DATABASE_URL` | — | ✓ | ✓ |
| `PORT` | — | ✓ (3001) | — |
| `BIDWINNER_*` | — | ✓ | — |
| `SCRAPE_MAX_*` | — | — | ✓ |
| `BIDTOOL_RUN_MIGRATIONS` | — | ✓ | — |

Use `@t3-oss/env-nextjs` → split into `packages/domain/src/env.ts` with Zod; each app imports subset.

## Local development

```bash
# Terminal 1 — infra
docker compose up postgres

# Terminal 2 — all apps
bun run dev   # turbo runs api + worker + web

# URLs
# web:  http://localhost:5173
# api:  http://localhost:3001
# VITE_API_BASE_URL=http://localhost:3001
```

Caddy dev optional: proxy `localhost:13000` → web + `/api` → api.

## Coexistence during migration (strangler)

Until cutover, keep `src/` Next app runnable:

```
bidtoolv3/
├── src/              # legacy Next (frozen after Phase 2)
├── apps/             # new stack (grows per phase)
└── packages/
```

Feature flags:

- `BIDTOOL_STACK=next|modern` in Electron for beta channel
- On-prem compose can run both behind path prefix during pilot (`/v2`)

Remove `src/` and Next dependencies in Phase 6.

## Files to add in Phase 0

- [ ] Root `package.json` workspaces
- [ ] `turbo.json`
- [ ] `packages/contracts` scaffold
- [ ] `packages/domain` with copied `schema.ts` only
- [ ] `apps/api` hello world + health
- [ ] `apps/web` hello world + health fetch
- [ ] `apps/worker` heartbeat log + DB ping

No user-facing feature port until scaffold passes CI.
