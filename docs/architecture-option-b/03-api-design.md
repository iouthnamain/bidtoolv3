# 03 — API design

## Overview

Replace tRPC with **versioned REST JSON** on Hono. OpenAPI 3.1 spec is generated from Zod schemas in `packages/contracts` for documentation and optional client codegen.

Base path: `/api/v1`

## Why REST over tRPC here

| Factor | tRPC (current) | REST + OpenAPI (target) |
| --- | --- | --- |
| Electron / static SPA | Works over HTTP | Native `fetch`, no React coupling |
| Large list payloads | Batch stream still serializes full objects | Pagination enforced at contract level |
| Non-TS clients | Awkward | OpenAPI → any client |
| Caching | None today | HTTP cache headers on read-only endpoints |
| SSE progress | Separate anyway | Fits naturally beside REST |

Domain services stay typed; only the transport layer changes.

---

## Server skeleton (Hono)

```ts
// apps/api/src/app.ts
const app = new Hono()

app.use("*", cors({ origin: allowedOrigins }))
app.use("*", requestId())
app.use("/api/v1/*", rateLimit()) // in-memory OK for single-user

app.route("/api/health", healthRoutes)
app.route("/api/version", versionRoutes)
app.route("/api/v1/materials", materialRoutes)
app.route("/api/v1/scrape-jobs", scrapeJobRoutes)
// ...

app.onError(errorHandler) // maps domain errors → JSON problem+json
export default app
```

**Runtime:** Node 22, `@hono/node-server`, default port `3001`.

---

## Router map (from current tRPC)

| Current tRPC router | REST prefix | Notes |
| --- | --- | --- |
| `material.*` | `/api/v1/materials` | Paginated list, CRUD, import triggers |
| `search.*` | `/api/v1/search` | BidWinner proxy + saved results |
| `workflow.*` | `/api/v1/workflows` | Cap list endpoints |
| `notification.*` | `/api/v1/notifications` | Unread count endpoint |
| `watchlist.*` | `/api/v1/watchlist` | |
| `catalogDocument.*` | `/api/v1/catalog-documents` | File download → signed path or stream |
| `version.*` | `/api/version` | Keep path for compatibility with update docs |

### Material list (example)

```
GET /api/v1/materials?q=&page=1&pageSize=50&sort=name&order=asc
```

Response:

```json
{
  "items": [ { "id": "...", "name": "...", "hasCatalogPdf": true } ],
  "page": 1,
  "pageSize": 50,
  "total": 1234
}
```

**Never** return 10k rows in one response (current `MATERIAL_EXPORT_LIMIT` becomes async export job).

### Scrape jobs

```
POST   /api/v1/scrape-jobs              → { id, status: "queued" }
GET    /api/v1/scrape-jobs              → list (no products blob)
GET    /api/v1/scrape-jobs/:id          → status, counts, urls
GET    /api/v1/scrape-jobs/:id/products → ?page=&pageSize=
PATCH  /api/v1/scrape-jobs/:id          → edit while queued
POST   /api/v1/scrape-jobs/:id/cancel
GET    /api/v1/scrape-jobs/:id/events   → SSE stream
POST   /api/v1/scrape-jobs/:id/import   → enqueue import job
```

---

## SSE — job progress

### Endpoint

```
GET /api/v1/scrape-jobs/:id/events
Accept: text/event-stream
```

### Event types

| Event | Payload |
| --- | --- |
| `progress` | `{ status, productCount, pagesVisited, queueLength, currentUrls, elapsedMs }` |
| `product` | `{ op: "upsert", id, name, sourceUrl }` — optional, for live table append |
| `complete` | `{ stopReason, durationMs }` |
| `error` | `{ message }` |

### Server implementation options

| Approach | Pros | Cons |
| --- | --- | --- |
| **A. Poll DB every 1s per SSE connection** | Simple | N connections × poll |
| **B. Postgres `LISTEN/NOTIFY`** | Instant, low CPU | Requires NOTIFY from worker |
| **C. In-memory bus in API** | Fast single instance | Lost on multi-api without sticky sessions |

**Phase 1:** A (good enough for single-user).  
**Phase 3 prod:** B for scale-out.

Worker after each progress flush:

```sql
NOTIFY scrape_job_progress, '{"jobId":"..."}';
```

API SSE handler subscribes on connection open.

### Client (TanStack Query integration)

```ts
useEffect(() => {
  const es = new EventSource(`${API}/api/v1/scrape-jobs/${id}/events`)
  es.addEventListener("progress", (e) => {
    queryClient.setQueryData(scrapeKeys.status(id), JSON.parse(e.data))
  })
  return () => es.close()
}, [id])
```

Fallback: poll `GET /scrape-jobs/:id` every 5s if SSE fails (corporate proxy).

---

## Error format

Use [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457):

```json
{
  "type": "https://bidtool.local/errors/validation",
  "title": "Validation failed",
  "status": 400,
  "detail": "URL shop không hợp lệ.",
  "instance": "/api/v1/scrape-jobs",
  "errors": [{ "path": "url", "message": "..." }]
}
```

Map existing Vietnamese user messages from services unchanged.

---

## Auth (future-ready)

Single-user v1: **no auth middleware** (same as today).

Hook for later:

```ts
app.use("/api/v1/*", async (c, next) => {
  if (env.REQUIRE_AUTH) {
    await verifySession(c)
  }
  return next()
})
```

On-prem LAN deployments may use Caddy basic auth or mTLS at edge; API stays simple.

---

## OpenAPI

- Generate from Zod via `@hono/zod-openapi` or `zod-to-openapi`
- Publish at `GET /api/openapi.json`
- Optional Swagger UI at `/api/docs` (disabled in production unless `BIDTOOL_OPENAPI_UI=true`)

---

## File uploads / downloads

| Endpoint | Pattern |
| --- | --- |
| Catalog PDF upload | `POST /api/v1/catalog-documents` multipart |
| Catalog PDF file | `GET /api/v1/catalog-documents/:id/file` stream |
| Material import | `POST /api/v1/materials/import` → returns `importJobId` |
| Material export | `POST /api/v1/materials/export` → job + download URL when done |

Stream with `Content-Disposition: attachment`; avoid loading full file in memory.

---

## Rate limiting

Port current tRPC in-memory limiter (`src/server/api/trpc.ts`) to Hono middleware:

- Default: 120 req/min per IP
- Search: 30 req/min (BidWinner protection)
- Scrape create: 10 req/min

For multi-instance on-prem, upgrade to Postgres sliding window table (see scalability doc).

---

## Migration from tRPC procedures

For each `material.list` procedure:

1. Define Zod input/output in `packages/contracts`
2. Implement handler calling existing service function
3. Add route in Hono
4. Add web hook wrapping `fetch` + TanStack Query
5. Mark tRPC procedure deprecated
6. Delete tRPC when all callers moved

Keep a **procedure → route mapping spreadsheet** in Phase 2 PR descriptions.

---

## Compatibility shim (optional, Phase 3)

Short-lived adapter:

```
POST /api/trpc/* → translates to REST (dev only)
```

Not recommended for production; use only if frontend migration needs more time.

---

## Performance checklist

- [ ] List endpoints: column-select, paginate, no `SELECT *` on JSONB blobs
- [ ] `ETag` on version manifest reads
- [ ] `Cache-Control: private, max-age=60` on BidWinner search cache hits
- [ ] Compress responses (`hono/compress`)
- [ ] Request body limit (e.g. 10 MB) on imports
- [ ] Timeouts: 30s default, 300s only for explicit long endpoints (remove after jobs)
