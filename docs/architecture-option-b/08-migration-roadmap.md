# 08 — Migration roadmap

## Strategy: strangler fig

Run Next.js and Option B **in parallel** until feature parity, then cut over. No big-bang rewrite in one PR.

```text
Phase 0 ──► Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4 ──► Phase 5 ──► Phase 6
scaffold    data/api    worker      web shell   features    desktop     decommission
```

Estimated calendar (1–2 developers, part-time feature work):

| Phase | Duration | Cumulative |
| --- | --- | --- |
| 0 | 1 week | 1 week |
| 1 | 2 weeks | 3 weeks |
| 2 | 2 weeks | 5 weeks |
| 3 | 1 week | 6 weeks |
| 4 | 4–6 weeks | 10–12 weeks |
| 5 | 2 weeks | 12–14 weeks |
| 6 | 1 week | 13–15 weeks |

Adjust if feature development continues on Next during migration.

---

## Phase 0 — Scaffold & decisions

**Goal:** Empty monorepo builds in CI; decisions recorded.

### Tasks

- [ ] Add Turborepo + Bun workspaces (`apps/*`, `packages/*`)
- [ ] Create `packages/contracts` with 1 sample schema
- [ ] Create `packages/domain` with `schema.ts` + db client copy
- [ ] `apps/api`: Hono + `GET /api/health`
- [ ] `apps/web`: Vite + TanStack Router + health fetch
- [ ] `apps/worker`: DB ping + log heartbeat
- [ ] CI: `turbo typecheck test build` on PR
- [ ] Resolve open decisions D1–D5 in `01-target-architecture.md`

### Acceptance

- `bun run dev` starts three processes locally
- Docker compose dev optional document in `docs/updates/local-dev.md` addendum
- No user-facing change

---

## Phase 1 — Data layer & API foundation

**Goal:** Schema improvements + REST for read-only materials list.

### Tasks

- [ ] Migration: `shop_scrape_job_products`, indexes on `materials`
- [ ] Migration: `search_cache`, `job_events`
- [ ] Dual-write scrape products (JSONB + child table) in **current** Next worker still
- [ ] Port `GET /api/v1/materials` (paginated) to Hono
- [ ] Port `GET /api/v1/materials/:id`
- [ ] Port `GET /api/health`, `GET /api/version`
- [ ] OpenAPI spec published
- [ ] Vitest API integration tests with test DB

### Acceptance

- Materials list from Vite dev page matches Next list for same query
- Scrape jobs still run via Next instrumentation (unchanged UX)

---

## Phase 2 — Worker extraction

**Goal:** Playwright and scheduler leave Next process.

### Tasks

- [ ] Move `job-scheduler.ts` → `apps/worker`
- [ ] Remove `instrumentation.ts` scheduler start (or gate with `BIDTOOL_USE_LEGACY_SCHEDULER`)
- [ ] Implement DB queue claim pattern
- [ ] Progress: counts + `job_events` only (stop full JSONB flush)
- [ ] Postgres NOTIFY for SSE prep
- [ ] HTTP-first listing scraper (domain package)
- [ ] `compose.dev.yml` with worker service for local testing
- [ ] Update `compose.production.yml` prototype (api + worker split, Next still serves UI temporarily)

### Acceptance

- Scrape job completes with Next UI still working (API routes proxied or tRPC unchanged)
- Worker restart does not kill web server
- Product rows visible via SQL child table

---

## Phase 3 — Web shell & scrape SSE

**Goal:** Vite dashboard shell + scrape flow end-to-end on new stack.

### Tasks

- [ ] Dashboard layout + navigation
- [ ] `POST/GET /api/v1/scrape-jobs` + SSE
- [ ] Scrape feature module (split from scrape-client)
- [ ] Virtualized product table (paginated API)
- [ ] Materials list page on Vite
- [ ] Feature flag: `?stack=modern` or separate port `5173`

### Acceptance

- Full scrape:create → progress → review → import on Vite-only path
- SSE works behind Caddy dev proxy
- Next scrape page still works (fallback)

---

## Phase 4 — Feature parity

**Goal:** All dashboard routes on Vite.

### Order

1. [ ] Search + tender detail pages
2. [ ] Material detail, import, catalog PDFs
3. [ ] Workflows + notifications + saved items
4. [ ] Settings + desktop + help
5. [ ] Batch upsert saved search (search router N+1 fix)

### Per-feature checklist

- [ ] Route works
- [ ] API endpoints ported
- [ ] E2E test green
- [ ] No tRPC imports in feature
- [ ] Bundle chunk < 500 KB gzipped (soft target)

### Acceptance

- E2E suite passes against Vite + api + worker only
- Next app not started in CI e2e job

---

## Phase 5 — Desktop & on-prem production

**Goal:** Ship multi-image production stack.

### Tasks

- [ ] Electron spawns api + worker + static web
- [ ] Three Docker images in CI
- [ ] Update `onprem-package-release.sh`, pins, customer `.env.example`
- [ ] Update `docs/updates/operating-guide.md`
- [ ] Migration script for JSONB → child table backfill
- [ ] Desktop QA Win/Linux
- [ ] Load test: 2 concurrent scrape jobs + browsing

### Acceptance

- Fresh on-prem install uses web+api+worker
- Desktop update channel ships new bundle
- Rollback documented with three image pins

---

## Phase 6 — Decommission Next.js

**Goal:** Remove legacy stack.

### Tasks

- [ ] Delete `src/app`, `src/trpc`, `next.config.js`
- [ ] Remove Next dependencies from root `package.json`
- [ ] Rename repo description / README
- [ ] Tag **v1.0.0** (or agreed version)
- [ ] Archive migration docs section as "completed"

### Acceptance

- `bun run build` only turbo apps
- Docker image `bidtoolv3` single-app deprecated on GHCR

---

## Risk register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Long parallel maintenance | Dev slowdown | Time-box Phase 4; freeze new Next features after Phase 3 |
| Electron package size | User download | Worker-only Chromium; consider system Chrome |
| SSE blocked by proxy | Stuck progress UI | Poll fallback |
| Migration data loss | Job history | Dual-write + backfill script |
| Scrape regression | Bad imports | Keep HTML fixture tests; live-shop review test suite |
| Team unfamiliar with TanStack Router | Delay | Start shell early Phase 3 |

---

## Feature freeze policy

| Milestone | Policy |
| --- | --- |
| Phase 0 start | Normal development |
| Phase 3 complete | **New features** only on Vite path; Next gets bugfixes |
| Phase 6 | Next removed |

---

## Definition of done (Option B complete)

- [ ] Zero Next.js dependencies in production artifacts
- [ ] Three-process compose is default on-prem
- [ ] Electron uses static web + api + worker
- [ ] Scrape progress uses SSE + paginated products
- [ ] `shop_scrape_job_products` is sole product store for active jobs
- [ ] Materials search uses trigram index
- [ ] CI builds and tests all apps
- [ ] `docs/updates/` reflects new images and env vars
- [ ] Rollback tested for one release cycle

---

## UX parallel track

UI/UX work runs alongside engineering phases. See **[14 — UX migration roadmap](./14-ux-migration-roadmap.md)** for:

- `packages/ui` design system (UX-0 with Phase 0)
- App shell (UX-1 with Phase 3)
- Scrape 4-step flow + SSE (UX-2 with Phase 3)
- Materials catalog + locked fields (UX-3 with Phase 4)
- a11y gates (UX-4 with Phase 5)

Optional **UX-0.5** quick wins on the current Next app are listed in doc 14.

## Tracking

Create GitHub milestone **Option B Migration** with issues per checkbox above.

Create a second milestone **Option B UX** from doc 14 checklists.

Suggested labels: `arch-b`, `phase-0` … `phase-6`, `api`, `web`, `worker`, `infra`.
