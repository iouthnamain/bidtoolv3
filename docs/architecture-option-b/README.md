# Option B — Vite SPA + Dedicated API

Architecture and migration plan for moving BidTool v3 from **Next.js monolith** to a **three-process production layout** suitable for on-prem, Electron desktop, and future scale-out.

## Why this document exists

Performance review identified bottlenecks that are architectural, not framework-minor:

- Monolithic client bundles (2–3k line `"use client"` pages, no route splitting)
- JSONB job blobs used as live progress channels (heavy Postgres + tRPC I/O)
- Playwright scraper co-located with the HTTP server
- Dashboard-wide `force-dynamic` disabling useful caching
- Unbounded / unindexed DB access patterns

**Option B** keeps the parts that work (Postgres, Drizzle, domain services, Electron distribution) and replaces the shell with a leaner, production-shaped layout.

## Target stack (locked decisions)ker → Job scheduler + Playwright (HTTP-first)
sha

| Layer | Technology | Notes |
| --- | --- | --- |
| UI | Vite 6 + React 19 + TanStack Router | SPA; route-level code splitting |
| Client data | TanStack Query 5 | Replaces tRPC React integration |
| API | Hono 4 on Node 22 | REST + OpenAPI; optional typed client codegen |
| Shared types | Zod schemas in `packages/contracts` | Single source for API + UI validation |
| Database | PostgreSQL 16 + Drizzle ORM | Keep existing schema; evolve job tables |
| Jobs | Dedicated `worker` process | DB-backed queue; no Redis required initially |
| Scraper | HTTP-first + Playwright fallback | Lives only in `worker` |
| Progress | SSE (`/api/events`) | Replace aggressive JSONB polling |
| Desktop | Electron → local API + static UI | Drop embedded Next standalone server |
| On-prem | Caddy → `web` + `api` + `worker` + Postgres | Multi-container compose |
| Build | Turborepo + Bun workspaces | Shared packages, independent deploy artifacts |

## What we are not changing

- Domain logic in `src/server/services/*` (move, don’t rewrite)
- Drizzle migrations and Postgres as system of record
- BidWinner integration semantics
- Release/update system (`docs/updates/`)
- Single-user default (auth optional later; see scalability doc)

## Document map

| Doc | Contents |
| --- | --- |
| [01 — Target architecture](./01-target-architecture.md) | Processes, boundaries, diagrams, principles |
| [02 — Monorepo layout](./02-monorepo-layout.md) | Package structure, imports, build graph |
| [03 — API design](./03-api-design.md) | REST routes, SSE, errors, OpenAPI |
| [04 — Data layer](./04-data-layer.md) | Schema evolution, indexes, job queue tables |
| [05 — Worker & scraper](./05-worker-and-scraper.md) | Job scheduler, Playwright pool, scrape phases |
| [06 — Frontend migration](./06-frontend-migration.md) | Vite app, routing map, component porting |
| [07 — Deployment](./07-deployment.md) | Docker, Electron, Caddy, CI/CD changes |
| [08 — Migration roadmap](./08-migration-roadmap.md) | Phased rollout, acceptance criteria, risks |
| [09 — Scalability & operations](./09-scalability-and-operations.md) | Prod hardening, observability, future multi-tenant |
| [10 — UX/UI strategy](./10-ux-ui-strategy.md) | IA, journeys, goals, tone |
| [11 — Design system](./11-design-system.md) | Tokens, `packages/ui`, components |
| [12 — Screen specifications](./12-screen-specifications.md) | Per-route layout and acceptance criteria |
| [13 — Accessibility & responsive](./13-accessibility-and-responsive.md) | WCAG, breakpoints, Electron |
| [14 — UX migration roadmap](./14-ux-migration-roadmap.md) | UX phases aligned with engineering |

## Read order

1. **Decision makers / leads:** README → 01 → 08 → 09
2. **Backend:** 01 → 02 → 03 → 04 → 05 → 07
3. **Frontend:** 01 → 02 → 06 → 03 (SSE section)
4. **DevOps / release:** 07 → 09 → `docs/updates/`
5. **UX / design:** 10 → 11 → 12 → 14 (with 13 before Phase 5)

## Status

| Item | State |
| --- | --- |
| Architecture decision | **Proposed** (Option B) |
| Implementation | **Not started** — current app remains Next.js |
| Breaking release | Target **v1.0** or separate `bidtoolv4` branch (TBD in roadmap) |

## Related

- Personal scratch notes: `docs/note.md` (not part of this plan)
- Current update system: `docs/updates/README.md`
- Current production compose: `compose.production.yml` (single `app` service today)
