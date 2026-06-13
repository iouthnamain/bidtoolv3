# 09 — Scalability & operations

## Scope

BidTool v3 today is **single-user, on-prem / desktop**. Option B must excel there first, then allow **credible production scale** without another rewrite.

This doc covers:

1. Single-machine production hardening
2. Small fleet on-prem (5–50 installs)
3. Optional multi-user / LAN shared instance
4. Observability and ops runbooks

---

## Deployment tiers

| Tier | Users | Topology | Queue | Auth |
| --- | --- | --- | --- | --- |
| **T0** Desktop | 1 | Electron: web + api + worker + embedded Postgres or Docker | DB | None |
| **T1** On-prem single | 1–3 | Compose: caddy + web + api + worker + postgres | DB | Optional Caddy basic auth |
| **T2** On-prem shared | 5–20 | Same + larger worker RAM; api replica=2 | DB + NOTIFY | Session auth (future) |
| **T3** Hosted (optional) | 20+ | K8s or managed VMs; object storage for exports | DB or Redis | Required |

Option B targets **T0–T2** in v1. T3 is extension path only.

---

## Horizontal scaling

### What scales easily

| Component | Scale method |
| --- | --- |
| `web` | Static files; CDN or multiple nginx replicas |
| `api` | Stateless replicas behind Caddy; shared Postgres |
| `postgres` | Vertical scale; read replica for reporting (later) |

### What scales carefully

| Component | Constraint |
| --- | --- |
| `worker` | Playwright is CPU/RAM heavy; prefer **fewer fat workers** |
| Chromium | One browser pool per worker process |
| Job queue | `FOR UPDATE SKIP LOCKED` supports multiple workers |

### Multi-worker rules

1. **Scrape jobs:** `SCRAPE_MAX_CONCURRENT_JOBS` per worker instance; total = sum across workers.
2. **Import jobs:** Prefer single active import per catalog to avoid lock contention (or row-level locks on materials).
3. **Leader cleanup:** One worker runs `cleanupExpiredJobs` via lease table.

```sql
-- worker_leases: only lease holder runs hourly cleanup
```

### Sticky sessions

Not required for REST. SSE: use **same api instance** via Caddy `hash` on `jobId` path, or centralize SSE through one notifier service (T3).

---

## When to add Redis

Stay on Postgres queue until:

- \>3 api replicas with complex rate limiting, or
- \>5 worker replicas, or
- Sub-second job dispatch SLA required

Then add Redis for:

- BullMQ job queue
- Rate limit counters
- SSE pub/sub across api instances

**Do not** add Redis for T0/T1.

---

## Database operations

### Connection limits

```
postgres max_connections >= (api_replicas × 10) + (worker_replicas × 5) + 20 headroom
```

### Maintenance

| Task | Frequency | Tool |
| --- | --- | --- |
| Backup | Daily | `onprem-backup.sh` |
| `VACUUM ANALYZE` | Weekly | pg cron or ops script |
| Job TTL cleanup | Hourly | worker |
| `job_events` prune | Daily | worker |
| Index bloat check | Monthly | `pg_stat_user_indexes` |

### Read replica (T2+)

- api read-only routes (`materials.list`, completed scrape products) → replica
- writes → primary
- Drizzle: two clients `db` / `dbRead`

---

## Caching strategy

| Data | Layer | TTL |
| --- | --- | --- |
| BidWinner search | `search_cache` table | 60–120s |
| Tender detail | existing `*_details_cache` |现有策略 |
| Version manifest | HTTP `Cache-Control` | 600s |
| Materials list | React Query | 30s stale |
| Static web assets | nginx `immutable` | 1y (hashed filenames) |

### CDN

On-prem T1: not needed.  
T2 LAN: optional nginx cache for `web` static only.

---

## Auth evolution (multi-user)

Single-user: skip.

LAN shared instance (T2):

1. **Phase A:** Caddy `basicauth` for entire site
2. **Phase B:** App sessions (Lucia / Auth.js) in `api` only
3. **Phase C:** Row-level `owner_id` on materials/jobs if true multi-tenant

Schema预留: `user_id UUID NULL` on job tables (null = legacy single-user).

---

## Observability

### Logging (v1)

Structured JSON to stdout:

```json
{
  "level": "info",
  "service": "worker",
  "msg": "scrape_page_complete",
  "jobId": "...",
  "pageUrl": "...",
  "productCount": 42,
  "durationMs": 1200
}
```

### Metrics (v2)

Prometheus endpoints on api/worker:

- `http_requests_total`
- `scrape_jobs_active`
- `scrape_pages_total`
- `db_query_duration_seconds`

### Tracing (v3)

OpenTelemetry for api → postgres → worker job spans.

### Alerting (on-prem)

Healthcheck failures → restart policy in compose (`restart: unless-stopped`). Optional webhook on repeated worker crash.

---

## SLO targets (T1 on-prem)

| Metric | Target |
| --- | --- |
| API p95 (excl. search) | < 300 ms |
| Materials list 50 rows | < 200 ms |
| BidWinner search (cache miss) | < 5 s (external bound) |
| Scrape listing page (HTTP-first) | < 2 s |
| Scrape listing page (Playwright) | < 8 s |
| UI time-to-interactive (web) | < 2 s on LAN |
| Job progress latency | < 3 s (SSE) |

---

## Security & compliance

| Topic | Approach |
| --- | --- |
| SSRF (scrape) | Keep `assertSafeScrapeUrl` |
| Secrets | `.env` on-prem; never in web bundle |
| TLS | Caddy auto or customer cert |
| DB encryption | Volume-level at rest (customer ops) |
| Audit | `job_events` + optional `audit_log` table (T2) |

---

## Disaster recovery

| Scenario | RTO | Procedure |
| --- | --- | --- |
| Worker crash | < 1 min | Compose restart; stale job reset on api boot |
| API crash | < 1 min | Compose restart |
| DB corruption | Hours | `onprem-restore.sh` from backup |
| Bad release | < 30 min | Pin previous image triplet; `onprem-update` |

Test restore quarterly.

---

## Performance regression gates (CI)

Add after Phase 4:

```bash
# Bundle size
apps/web/dist/assets/*.js gzip < 500KB per initial route chunk

# API bench (vitest bench or k6)
GET /materials?page=1 p95 < 250ms @ 1000 seed rows
```

---

## Future extensions (not v1)

| Extension | Trigger |
| --- | --- |
| Tauri desktop shell | Electron size complaints |
| Separate search service | BidWinner rate limits |
| Object storage (S3/MinIO) | Large export files |
| K8s Helm chart | T3 hosted offering |
| Read-only analytics DB | Reporting dashboards |

---

## Ops runbook index (to write at Phase 5)

| Runbook | Path (planned) |
| --- | --- |
| On-prem install (multi-image) | `docs/updates/operating-guide.md` |
| Worker OOM / Chromium crash | `docs/architecture-option-b/runbooks/worker-oom.md` |
| SSE not updating | `docs/architecture-option-b/runbooks/sse-debug.md` |
| DB migration failed | `docs/updates/rollback.md` |
| Desktop bundled services | `docs/updates/local-dev.md` |

Create runbooks when Phase 5 starts; link from here.

---

## Summary

Option B scales **vertically on one machine** (the common case) and **horizontally at the api/web layer** when needed. Worker scale is deliberate and Chromium-aware. Postgres remains the coordination point until proven insufficient — avoiding ops burden of Redis for single-user installs.
