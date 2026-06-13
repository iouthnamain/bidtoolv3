# 05 — Worker & scraper

## Role

`apps/worker` is the **only** process that:

- Runs the job scheduler loop
- Launches and owns Playwright/Chromium
- Performs long CSV/XLSX imports and async exports
- Writes scrape progress to normalized tables + `job_events`

The API enqueues work; the worker executes it.

---

## Process model

```ts
// apps/worker/src/index.ts
async function main() {
  await assertDatabase()
  const abort = setupGracefulShutdown()

  await Promise.all([
    runScrapeImportScheduler({ abort }),
    runExpiredJobCleanup({ abort }),
    runHealthServer({ port: 3002 }), // optional internal only
  ])
}
```

### Concurrency env (from current `env.js`)

| Variable | Default | Scope |
| --- | --- | --- |
| `SCRAPE_MAX_CONCURRENT_JOBS` | 2 | Per worker process |
| `SCRAPE_MAX_CONCURRENT_PAGES` | 2 | Per scrape job |
| `IMPORT_MAX_CONCURRENT_JOBS` | 1 | Per worker process |

**Production on-prem:** 1 worker container with these limits. Scale by adding worker containers with leader election (later).

---

## Scheduler migration

Port `src/server/services/job-scheduler.ts`:

| Current | Target |
| --- | --- |
| `startJobScheduler()` in `instrumentation.ts` | `apps/worker/src/scheduler.ts` |
| `createScrapeProgressWriter` full JSONB flush | Write `product_count`, `job_events`, child table rows |
| `activeScrapeRuns` AbortController map | In-memory per worker; cancel via DB `status=cancelled` |
| Poll every 1s | Keep 1s for responsiveness; use NOTIFY to wake early (optional) |

### Cancel flow

1. API: `POST /scrape-jobs/:id/cancel` → `status = 'cancelled'`
2. Worker: checks status between pages; aborts Playwright via `AbortSignal`
3. SSE: `error` or `complete` event with `stopReason: 'cancelled'`

---

## Scrape pipeline (two phases)

### Phase A — Discovery (listing pages)

1. HTTP-first fetch listing URL (`fetch` + HTML parser)
2. If yield < threshold → Playwright fallback
3. Extract products → upsert `shop_scrape_job_products`
4. Enqueue pagination URLs (BFS or pre-built sitemap list)
5. Emit `progress` event (counts only)

### Phase B — Enrichment (optional separate job type)

Triggered when:

- User enables `detailEnrichment: missing_fields`, or
- Separate `POST /scrape-jobs/:id/enrich` after review

Uses detail worker pool (3–5 tabs) with deduped `source_url` queue.

**Do not** block Phase A completion on Phase B.

---

## Playwright lifecycle

```ts
// packages/domain/src/services/browser-pool.ts
class BrowserPool {
  async withPage<T>(fn: (page: Page) => Promise<T>): Promise<T>
  async shutdown(): Promise<void>
}
```

- One shared browser per worker process (same as `getSharedBrowser()` today)
- New **browser context per scrape job** (isolation, route blocking)
- Context closed when job ends
- On worker SIGTERM: `closeShopScraperBrowser()` then exit

### Resource blocking (keep current)

Abort `font`, `image`, `media`; same-hostname only — from `shop-material-scraper.ts` route handler.

### Dependencies

```json
// apps/worker/package.json only
{
  "dependencies": {
    "playwright": "1.59.1",
    "@sparticuz/chromium-min": "..."  // if serverless worker ever needed
  }
}
```

`apps/api` must **not** depend on Playwright.

---

## HTTP-first scraper module

New: `packages/domain/src/services/http-shop-scraper.ts`

```
tryHttpListingPage(url) → ShopPageSnapshot | null
shouldFallbackToPlaywright(snapshot, html) → boolean
```

Reuse `collectShopPageSnapshot` logic ported to run on `Document` from linkedom/cheerio in Node.

**Quality gate for fallback:**

- Zero products extracted
- JSON-LD empty and < 3 product anchors
- HTTP status not 200
- Cloudflare challenge detected in HTML

---

## Progress writes

### Before (problem)

Every 2s: UPDATE entire `products` JSONB array (100+ objects).

### After

Every 2s or on page complete:

```sql
UPDATE shop_scrape_jobs SET
  product_count = $2,
  queue_length = $3,
  last_progress_at = now()
WHERE id = $1;

INSERT INTO job_events (job_type, job_id, event_type, payload) VALUES (...);

NOTIFY scrape_job_progress, $jobId;
```

Products written incrementally on merge:

```sql
INSERT INTO shop_scrape_job_products (...) 
ON CONFLICT (job_id, identity_key) DO UPDATE SET ...
```

---

## Import jobs

Port `shop-product-importer.ts` unchanged in domain package.

Progress:

- `processed` / `total` on `shop_import_jobs` row
- SSE on `/api/v1/import-jobs/:id/events`
- No full `items` JSONB in progress updates

---

## Export jobs (new)

```
POST /api/v1/materials/export → export_job_id
Worker streams rows with cursor → writes temp file or S3-compatible storage
GET  /api/v1/export-jobs/:id/download
```

For on-prem: store under `/data/exports` volume.

---

## Health & observability

| Endpoint | Audience |
| --- | --- |
| `GET :3002/health` | Docker healthcheck (worker) |
| Logs structured JSON | `{ jobId, event, durationMs, pages, products }` |

Metrics to log (future Prometheus):

- `scrape_pages_total`
- `scrape_products_total`
- `scrape_duration_seconds`
- `playwright_fallback_total`

---

## Failure modes

| Failure | Behavior |
| --- | --- |
| Chromium crash | Job → `failed`, browser pool reset |
| Worker OOM | Container restart; stale job → `resetStaleRunningJobs` on api startup |
| DB unreachable | Worker exits; orchestrator restarts |
| Partial page failures | Record in `failed_pages`; continue queue |

Port `resetStaleRunningJobs` from job-scheduler to api startup only.

---

## Testing

| Layer | Tool |
| --- | --- |
| HTTP parser | Vitest fixtures from `shop-material-scraper.test.ts` HTML snapshots |
| Scheduler | `runJobSchedulerTickForTests` equivalent in worker |
| Playwright | Keep integration tests; run in CI with `playwright install` |
| E2E | Playwright tests hit `web` + real `api` + test DB |

---

## Electron note

Desktop bundles worker binary or spawns `node apps/worker/dist/index.js` alongside api.

Chromium: ship Playwright browsers in desktop package or use system Chrome via `PLAYWRIGHT_CHROMIUM_EXECUTABLE` (document in desktop install guide).
