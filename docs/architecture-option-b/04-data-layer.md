# 04 — Data layer

## Principles

1. **Postgres remains system of record** — no SQLite pivot.
2. **Normalize hot JSONB** — job progress and scrape products move to child tables.
3. **Index for real queries** — materials search, active jobs, soft-delete filter.
4. **Migrations are forward-only** — Drizzle kit; same `drizzle/` folder.
5. **API and worker share schema** via `packages/domain/src/db`.

---

## Schema changes (new tables)

### `shop_scrape_job_products`

Replaces repeated writes to `shop_scrape_jobs.products` JSONB.

```sql
CREATE TABLE shop_scrape_job_products (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL REFERENCES shop_scrape_jobs(id) ON DELETE CASCADE,
  identity_key  TEXT NOT NULL,  -- stable dedupe key from productIdentity()
  name          TEXT NOT NULL,
  unit          TEXT,
  category      TEXT,
  spec_text     TEXT NOT NULL DEFAULT '',
  manufacturer  TEXT,
  origin_country TEXT,
  price         NUMERIC,
  price_text    TEXT,
  currency      TEXT NOT NULL DEFAULT 'VND',
  source_url    TEXT NOT NULL,
  image_url     TEXT,
  sku           TEXT,
  model         TEXT,
  availability  TEXT,
  shop_category TEXT,
  catalog_pdf_urls JSONB NOT NULL DEFAULT '[]',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, identity_key)
);

CREATE INDEX shop_scrape_job_products_job_id_idx
  ON shop_scrape_job_products (job_id);

CREATE INDEX shop_scrape_job_products_job_id_name_idx
  ON shop_scrape_job_products (job_id, name);
```

**Worker:** upsert per product during scrape.  
**API:** `GET /scrape-jobs/:id/products?page=` reads this table.

### `shop_scrape_job_progress` (optional slimming)

If job row still too wide, move volatile fields:

```sql
CREATE TABLE shop_scrape_job_progress (
  job_id          UUID PRIMARY KEY REFERENCES shop_scrape_jobs(id) ON DELETE CASCADE,
  current_urls    JSONB NOT NULL DEFAULT '[]',
  pages_visited   JSONB NOT NULL DEFAULT '[]',
  failed_pages    JSONB NOT NULL DEFAULT '[]',
  queue_length    INTEGER NOT NULL DEFAULT 0,
  product_count   INTEGER NOT NULL DEFAULT 0,
  last_progress_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Or keep counts on main job row and only normalize `products`.

### `job_events` (audit + NOTIFY source)

```sql
CREATE TABLE job_events (
  id         BIGSERIAL PRIMARY KEY,
  job_type   TEXT NOT NULL,  -- 'scrape' | 'import' | 'export'
  job_id     UUID NOT NULL,
  event_type TEXT NOT NULL,  -- 'progress' | 'complete' | 'error'
  payload    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX job_events_job_idx ON job_events (job_type, job_id, created_at DESC);
```

Worker inserts event; API SSE can read tail or listen to NOTIFY.

### `search_cache`

```sql
CREATE TABLE search_cache (
  cache_key   TEXT PRIMARY KEY,
  payload     JSONB NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX search_cache_expires_idx ON search_cache (expires_at);
```

`cache_key` = hash of normalized query + filters. TTL 60–120s.

---

## Indexes on existing tables

### Materials (high priority)

```sql
-- Active rows only (partial index)
CREATE INDEX materials_active_name_idx
  ON materials (name)
  WHERE deleted_at IS NULL;

-- Trigram search (requires extension)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX materials_name_trgm_idx
  ON materials USING gin (name gin_trgm_ops);

-- Optional: combined search vector later
-- ALTER TABLE materials ADD COLUMN search_vector tsvector ...
```

Replace 7-column `ilike` OR chain in material router with:

```sql
WHERE deleted_at IS NULL
  AND name % $1  -- trigram similarity
ORDER BY similarity(name, $1) DESC
```

### Shop scrape jobs

```sql
CREATE INDEX shop_scrape_jobs_status_progress_idx
  ON shop_scrape_jobs (status, last_progress_at DESC);

CREATE INDEX shop_scrape_jobs_status_created_idx
  ON shop_scrape_jobs (status, created_at DESC);
```

### Workflow runs (dashboard KPI)

```sql
CREATE INDEX workflow_runs_created_idx
  ON workflow_runs (created_at DESC);
```

Cap dashboard query: last 90 days or 500 rows.

---

## Job queue pattern (no Redis)

Use Postgres as queue — adequate for single-user and small on-prem fleets.

### Claim scrape job

```sql
UPDATE shop_scrape_jobs
SET status = 'running', started_at = now(), updated_at = now()
WHERE id = (
  SELECT id FROM shop_scrape_jobs
  WHERE status = 'queued'
  ORDER BY created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING *;
```

Worker loop:

1. Claim job
2. Process with abort signal on `status = 'cancelled'`
3. Set `completed` / `failed`
4. Respect `SCRAPE_MAX_CONCURRENT_JOBS` via worker replica count or in-process semaphores

### Leader election (multi-worker future)

```sql
CREATE TABLE worker_leases (
  worker_id   TEXT PRIMARY KEY,
  lease_until TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Only holder runs scheduler; others standby. Documented in scalability doc.

---

## Deprecation: `shop_scrape_jobs.products` JSONB

| Phase | Behavior |
| --- | --- |
| 1 | Dual-write: JSONB + child table |
| 2 | API reads child table only; JSONB lazy backfill for old jobs |
| 3 | Stop writing JSONB |
| 4 | Migration drops column or keeps for archive export |

Same pattern for `shop_import_jobs.items` if import progress is heavy.

---

## Connection pooling

| Process | `max` connections | Notes |
| --- | --- | --- |
| api | 10 | Current default |
| worker | 5 | Long transactions rare |
| **Total** | ≤ 15 default | Raise Postgres `max_connections` in compose if needed |

Use `postgres.js` same as today; one pool per process.

---

## Migrations workflow

Unchanged:

```bash
bun run db:generate   # drizzle-kit
bun run db:migrate    # on api startup in prod
```

Worker **does not** run migrations — only api entrypoint (`docker/entrypoint.sh` pattern).

---

## Backup & retention

Align with `scripts/onprem-backup.sh`:

- Backup includes new tables automatically
- Job TTL (`SCRAPE_JOB_TTL_DAYS`) deletes old jobs **and** cascaded `shop_scrape_job_products`
- `job_events` retention: 30 days (scheduled cleanup in worker)

---

## Data migration script (one-time)

For in-flight deployments at cutover:

```
scripts/migrate-scrape-products-jsonb.ts
  - For each job with products JSONB length > 0
  - INSERT INTO shop_scrape_job_products ON CONFLICT DO NOTHING
  - Verify counts match product_count
```

Run before Phase 4 cutover; idempotent.

---

## Excel workspace tables

No schema change required for Option B. API loads `workbook_json` only on:

```
GET /api/v1/excel-workspaces/:id
```

Do not join workbook blobs in list endpoints.
