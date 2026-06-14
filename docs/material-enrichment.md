# Material Web Enrichment — Feature Documentation

> **Status:** Implemented (June 2026)  
> **Route:** `/materials/enrich`  
> **Related:** Catalog-only Excel fill at [`/enrich`](./excel-enrich-export-plan.md) · Excel upload + web research at [`/research-enrich`](./excel-product-research.md)

## What this feature does

Select saved materials from the catalog, run a **durable background job** that researches each product on the web, review uncertain matches with evidence, then **commit updates directly to the `materials` table** (fill-empty semantics, field locks respected).

```
/materials — select rows ──▶ startMaterialEnrichmentJob
     │
     ▼
Job scheduler (queued → running) ──▶ per material:
     │   1. snapshot original row
     │   2. build search queries (name, manufacturer, SKU, model, spec)
     │   3. DuckDuckGo HTML search + rank sources
     │   4. save web candidates
     │   5. OpenRouter LLM extract fields from snippets only
     │   6. match to existing catalog option values
     │   7. build fill plan + confidence score
     │   8. optional auto-commit (high confidence)
     ▼
Review UI (/materials/enrich/jobs/:id)
     │   commit / reject / pick candidate / bulk commit
     ▼
Updated materials + catalog PDF links + audit events
```

**Key principles:**

- The **database row is the source of truth** for cells that already have a value — only **blank** fields are filled unless the user explicitly commits with overwrite policy.
- Every automated suggestion carries **evidence** (source URL + snippet).
- Low-confidence extractions land in **review**; the LLM maps fields but the app performs search, validation, PDF attach, and DB writes.
- **Field locks** (`metadata_json.fieldLocks`) block writes the same way shop scrape import does.

---

## How this differs from related features

| | `/enrich` | `/research-enrich` | `/materials/enrich` |
|---|-----------|-------------------|---------------------|
| Input | Uploaded Excel | Uploaded Excel | **Saved `materials` rows** |
| Data source | Internal catalog only | Catalog + SearXNG web | **Web search (DuckDuckGo) + OpenRouter** |
| Output | Enriched `.xlsx` download | Enriched `.xlsx` download | **DB updates** + optional report JSON |
| Persistence | Ephemeral (browser session) | DB jobs + filesystem | DB jobs + events |
| Best for | Fast spreadsheet backfill | Research + audit on Excel | **Catalog maintenance** |

Shop scrape (`/materials/scrape`) bulk-imports from **one shop URL**. Material enrichment researches **each catalog row individually** across the open web.

---

## User workflow

1. Open **Danh mục** (`/materials`), filter or search, select one or more materials.
2. Click **Làm giàu** in the bulk toolbar → navigates to `/materials/enrich?ids=1,2,3`.
3. Configure options (auto-commit high confidence, fields to enrich) and start the job.
4. Monitor progress on `/materials/enrich/jobs/:jobId` (polls every 1.5s while running).
5. Review rows marked **review** — inspect evidence, pick a different web candidate, commit or reject.
6. Use **Bulk commit** for high-confidence items or download the **JSON review report**.

Single-material enrichment can be started from the job page with `?ids=` query param from the detail page in future; bulk from list is the primary entry point today.

---

## Setup

### 1. Database migration

```bash
bun run db:migrate
```

Migration: `drizzle/0018_material_enrichment.sql`

Tables:

| Table | Purpose |
|-------|---------|
| `material_enrichment_jobs` | Job queue, progress counters, options |
| `material_enrichment_items` | Per-material snapshot, result JSON, status |
| `material_web_candidates` | Ranked search hits per item |
| `material_enrichment_events` | Append-only change log |

### 2. OpenRouter API key

Configure via **Settings → AI** (`/settings/ai`) or `OPENROUTER_API_KEY` env var. The enrichment runner calls `resolveOpenRouterApiKey()` and `resolveOpenRouterDefaultModel()` from `app-settings.ts`.

Without a key, items fail with a clear error — no silent fallback.

### 3. Job scheduler

Enrichment jobs run in the same in-process scheduler as shop scrape/import (`job-scheduler.ts`). Requires a long-running Node process (not serverless-only).

Env:

| Variable | Default | Description |
|----------|---------|-------------|
| `ENRICHMENT_MAX_CONCURRENT_JOBS` | `1` | Parallel enrichment jobs |
| `SCRAPE_JOB_TTL_DAYS` | `7` | Job retention after completion |

---

## Enrichable fields

Defined in `src/lib/materials/material-enrichment-types.ts`:

- `category`
- `specText`
- `manufacturer`
- `originCountry`
- `unit`
- `sourceUrl`

Not enriched automatically: `code`, `name`, `defaultUnitPrice`, `currency`, `imageUrl` (protected / out of scope for web fill).

SKU and model are read from `metadata_json.shopScrape` when present to improve search queries.

---

## Confidence bands

Shared thresholds (`ENRICHMENT_THRESHOLDS`):

| Score | Band | Behavior |
|-------|------|----------|
| ≥ 0.85 | `auto` | Fill-empty writes allowed; auto-commit if job option enabled |
| 0.5 – 0.85 | `review` | Fill-empty only; item marked for manual review |
| < 0.5 | `skip` | No field writes; store candidates + evidence only |

Per-field confidence is tracked in `result_json.fields[field].confidence` with evidence array.

---

## Option matching

Extracted values are matched against **existing catalog distributions** (distinct categories, manufacturers, origins, units) captured in `filter_snapshot_json` at job start.

`src/lib/materials/option-matcher.ts` normalizes strings (case, punctuation, spacing) and picks the closest valid option. If no close match exists, the field is left blank or flagged for review — new option values are never invented silently.

---

## Web search & source ranking

`src/server/services/material-web-search.ts`:

- Provider: DuckDuckGo HTML (`html.duckduckgo.com`)
- Ranking boosts: manufacturer domain match, `.pdf` URLs, official product pages
- Penalty: marketplace domains (Shopee, Lazada, Tiki) unless no better results

Catalog PDF URLs found in results are collected and attached via `attachCatalogPdfUrlsToMaterial()` on commit.

---

## LLM extraction

`src/server/services/material-enrichment-extract.ts`:

- Sends ranked snippets to OpenRouter with a strict JSON-only prompt
- LLM may only cite values present in provided snippets
- App validates JSON shape and discards fields without evidence

The LLM **decides what matches**; the app **decides what gets written**.

---

## Commit semantics

`src/server/services/material-enrichment-commit.ts`:

- Reuses `buildFillPlan` from `excel-enrich-fields.ts` (fill-empty logic)
- Respects `fieldLocks` per field
- Writes to `materials` + updates `metadata_json.webEnrichment` provenance
- Logs every change to `material_enrichment_events`
- Attaches catalog PDF URLs with `link_source: manual` (detected PDFs from web)

---

## tRPC API (`materialEnrichment` router)

| Procedure | Description |
|-----------|-------------|
| `startMaterialEnrichmentJob` | `{ materialIds, options? }` → job snapshot |
| `listMaterialEnrichmentJobs` | Paginated job history |
| `getMaterialEnrichmentJob` | Job + progress counters |
| `cancelMaterialEnrichmentJob` | Cancel queued/running job |
| `deleteMaterialEnrichmentJob` | Remove completed job |
| `listMaterialEnrichmentItems` | Items for a job |
| `getMaterialEnrichmentItem` | Full result + candidates + evidence |
| `selectWebCandidate` | User picks alternate search result |
| `commitMaterialEnrichmentItem` | Apply proposed updates to DB |
| `bulkCommitMaterialEnrichment` | Commit many items above min confidence |
| `rejectMaterialEnrichmentItem` | Discard proposed changes |
| `exportMaterialEnrichmentReport` | JSON report for download |

Registered in `src/server/api/root.ts` as `materialEnrichment`.

---

## UI components

| File | Role |
|------|------|
| `src/app/(dashboard)/materials/enrich/page.tsx` | Job list + start form |
| `src/app/(dashboard)/materials/enrich/jobs/[jobId]/page.tsx` | Job detail |
| `src/app/_components/materials/enrich-client.tsx` | Main client (progress, review drawer, bulk actions) |
| `src/app/_components/materials/list-client.tsx` | Bulk **Làm giàu** action |
| `src/app/_components/dashboard/page-nav-presets.ts` | Nav item under Materials |

---

## Per-item result shape

Stored in `material_enrichment_items.result_json`:

```ts
type MaterialEnrichmentResult = {
  fields: Partial<Record<EnrichableField, {
    value: string | null;
    confidence: number;
    evidence: Array<{ field, value, sourceUrl, snippet }>;
    matchedOption?: string | null;
  }>>;
  catalogPdfUrls: string[];
  overallConfidence: number;
  status: "pending" | "processing" | "review" | "auto" | "committed" | "rejected" | "failed" | "skipped";
  selectedCandidateId?: number | null;
  error?: string | null;
};
```

Original row state is immutable in `original_snapshot_json`.

---

## File index

**Schema:** `src/server/db/schema.ts` (material enrichment tables)  
**Migration:** `drizzle/0018_material_enrichment.sql`  
**Types:** `src/lib/materials/material-enrichment-types.ts`, `src/lib/materials/option-matcher.ts`  
**Services:** `material-enrichment-jobs.ts`, `material-enrichment-runner.ts`, `material-enrichment-extract.ts`, `material-enrichment-commit.ts`, `material-web-search.ts`  
**API:** `src/server/api/routers/material-enrichment.ts`  
**Scheduler:** `src/server/services/job-scheduler.ts` (enrichment slots)

---

## Operational notes

- Jobs survive server restart: stale `running` jobs are re-queued on scheduler init.
- Completed jobs expire after `SCRAPE_JOB_TTL_DAYS` (shared TTL with scrape jobs).
- Web search is rate-limited by item concurrency (`ITEM_CONCURRENCY = 2` in runner).
- Do not expect generated catalog PDFs in v1 — found PDFs are linked; generation is planned for a later phase.
