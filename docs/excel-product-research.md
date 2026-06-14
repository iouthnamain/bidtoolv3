# Excel Product Research — Feature Documentation

> **Status:** Phase 1 implemented (June 2026)  
> **Route:** `/research-enrich`  
> **Related:** Catalog-only fill at `/enrich` — see [excel-enrich-export-plan.md](./excel-enrich-export-plan.md). **DB-backed catalog enrichment** at `/materials/enrich` — see [material-enrichment.md](./material-enrichment.md).

## What this feature does

Upload an Excel file with product rows, run a **durable background job** that researches each row (internal catalog match + optional web search), review uncertain matches with evidence, then export an enriched `.xlsx`.

```
Upload .xlsx ──▶ createJob (persist original + seed rows)
     │
     ▼
startJob ──▶ processJobBatch (per row: catalog match + SearXNG)
     │              │
     │              ▼
     │         evidence + fill plan + confidence
     ▼
Review UI (approve / skip rows)
     │
     ▼
exportExcel ──▶ download enriched workbook
```

**Key principles (same as `/enrich`):**

- The uploaded sheet is the source of truth — only **blank** cells are filled on export.
- Every automated suggestion carries **evidence** (catalog match or web hit).
- Low-confidence or web-only matches land in **needs_review** until a user approves.

---

## How this differs from `/enrich`

| | `/enrich` | `/research-enrich` |
|---|-----------|-------------------|
| Data source | Internal `materials` catalog only | Catalog + optional web (SearXNG) |
| Persistence | Ephemeral (base64 in browser session) | DB jobs + filesystem artifacts |
| Processing | Single request (`enrichMatchRows`) | Batched, resumable job |
| Review | 3-step wizard, inline | Job progress + row review queue |
| Best for | Fast catalog backfill | Research + audit trail |

Both features reuse `excel-workbook.ts` parsing, `excel-enrich.ts` fill/export logic, and `excel-enrich-fields.ts` thresholds.

---

## Setup

### 1. Database migration

Apply migration `drizzle/0019_excel_research_jobs.sql` (creates enums + five tables):

```bash
pnpm drizzle-kit migrate
# or your usual migration command (on-prem: BIDTOOL_RUN_MIGRATIONS=true)
```

### 2. Environment variables

Add to `.env` (see `.env.example`):

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `SEARXNG_BASE_URL` | no | — | Base URL of a SearXNG instance for web search. If unset, jobs run **catalog match only**. |
| `EXCEL_RESEARCH_MAX_CONCURRENT_JOBS` | no | `1` | Max simultaneous research jobs |
| `EXCEL_RESEARCH_BATCH_SIZE` | no | `10` | Rows claimed per batch (also in job `config_json`) |
| `EXCEL_RESEARCH_JOB_TTL_DAYS` | no | `7` | Job retention |
| `BIDTOOL_EXCEL_RESEARCH_DIR` | no | `data/excel-research` | Root directory for job files |

### 3. Optional: SearXNG

Point `SEARXNG_BASE_URL` at a self-hosted or internal SearXNG deployment, e.g.:

```env
SEARXNG_BASE_URL="https://search.example.internal"
```

The client calls `GET {base}/search?q=…&format=json`. Without this, web evidence is skipped and a warning is logged per row batch.

---

## User guide

### Step 1 — Upload & run

1. Open **Nghiên cứu Excel** (`/research-enrich`).
2. Upload a `.xlsx` file.
3. Pick the sheet and confirm detected columns (requires a **product name** column).
4. Click **Bắt đầu nghiên cứu** — creates a job and starts processing.

Progress polls every 2s: processed/total rows, needs review, errors.

### Step 2 — Review

- Filter rows by status: pending, matched, needs review, approved, skipped, error.
- Select a row to see **evidence** (catalog + web hits) and the **fill plan** (what would be written).
- **Duyệt** → `approved` (included in export).
- **Từ chối** → `skipped` (excluded from export).

Rows with high catalog confidence (≥ 0.85) are auto-`matched`. Medium confidence and web-only hits are `needs_review`.

### Step 3 — Export

Download the enriched workbook. Only rows in `matched` or `approved` with accepted fill fields are written. Original layout is preserved (`writeEnrichedWorkbook` preserve mode).

---

## Architecture

### UI

| File | Role |
|------|------|
| `src/app/(dashboard)/research-enrich/page.tsx` | Route + metadata |
| `src/app/(dashboard)/research-enrich/layout.tsx` | Suspense shell |
| `src/app/_components/dashboard/research-enrich-layout-client.tsx` | Dashboard shell |
| `src/app/_components/research-enrich/research-enrich-client.tsx` | 3-step wizard |
| `src/app/_components/research-enrich/research-enrich-step-header.tsx` | Step navigation |
| `src/app/_components/research-enrich/excel-research-types.ts` | Shared status helpers |

Navigation: sidebar **Nghiên cứu Excel**, breadcrumbs `/research-enrich`.

### API (`excelResearch` tRPC router)

Registered in `src/server/api/root.ts`.

| Procedure | Type | Description |
|-----------|------|-------------|
| `previewUpload` | mutation | Parse workbook, return sheets + suggested mapping |
| `createJob` | mutation | Save original file, seed rows |
| `startJob` | mutation | Set `running`, start batch loop |
| `pauseJob` / `cancelJob` | mutation | Stop processing |
| `getJob` | query | Full job snapshot |
| `getJobStatus` | query | Lightweight poll payload |
| `listJobs` | query | Recent jobs |
| `listRowResults` | query | Paginated rows `{ items, total }` |
| `getRowResult` | query | Row + evidence records |
| `approveRow` | mutation | Approve fills (`rowNumber`, optional `materialId`, `acceptedFields`) |
| `rejectRow` | mutation | Skip row → status `skipped` |
| `exportExcel` | mutation | Returns `{ fileName, workbookBase64 }` |
| `processBatch` | mutation | Manual/dev batch trigger |

### Services

| File | Role |
|------|------|
| `src/server/services/excel-research-jobs.ts` | Job CRUD, `createJob`, `startJob`, review, export |
| `src/server/services/excel-research/process-batch.ts` | Row claiming (`FOR UPDATE SKIP LOCKED`), batch loop |
| `src/server/services/excel-research/row-research.ts` | Per-row pipeline entry |
| `src/server/services/excel-research/query-builder.ts` | Search query templates |
| `src/server/services/excel-research/web-search.ts` | SearXNG HTTP client |
| `src/server/services/excel-research/source-ranker.ts` | Domain tier ranking |
| `src/server/services/excel-research/db-helpers.ts` | Change log + counter recompute |
| `src/server/services/excel-research-storage.ts` | Filesystem artifacts |
| `src/server/services/excel-research/types.ts` | Zod config + `RowResearchResult` shape |

Job scheduler (`src/server/services/job-scheduler.ts`) includes `fillExcelResearchSlots()` to resume `running` jobs after process restart.

### Per-row pipeline (Phase 1)

1. Load `input_fields_json` from `excel_research_job_rows`.
2. **Catalog match** — `matchRows()` → `findFuzzyCandidates` (pg_trgm + weighted score).
3. **Web search** (if `enableWebSearch` + `SEARXNG_BASE_URL`) — up to 2 queries, rank hits, store evidence.
4. **Pick best** — prefer catalog when score ≥ 0.5; web-only → `needs_review`.
5. **Fill plan** — `buildFillPlan()` (blanks only).
6. **Persist** — `result_json`, `fill_plan_json`, `excel_research_row_evidence`, change log.
7. **Row status** — `matched` (≥ autoThreshold), `needs_review` (review band or web-only), `error` otherwise.

### Confidence thresholds

From `excel-enrich-fields.ts` / job config:

| Threshold | Default | Effect |
|-----------|---------|--------|
| `autoThreshold` | 0.85 | Auto `matched` |
| `reviewThreshold` | 0.50 | `needs_review` band |
| Below review | — | `error` / no match |

Configurable per job via `config_json` on create.

---

## Database schema

Migration: `drizzle/0019_excel_research_jobs.sql`

| Table | Purpose |
|-------|---------|
| `excel_research_jobs` | Job metadata, counters, config, status |
| `excel_research_job_rows` | One row per Excel data row |
| `excel_research_row_evidence` | Catalog + web evidence per row |
| `excel_research_file_artifacts` | Original/enriched xlsx, future PDFs/reports |
| `excel_research_change_log` | Append-only audit (`job_created`, `row_researched`, `row_approved`, `export_written`, …) |

**Job statuses:** `draft` → `running` → `awaiting_review` | `completed` | `failed` | `cancelled` (also `paused`, `exporting`).

**Row statuses:** `pending` → `processing` → `matched` | `needs_review` | `error` → user → `approved` | `skipped`.

**Limits:** `MAX_EXCEL_RESEARCH_ROWS = 2000` per job (`src/server/services/excel-research/types.ts`).

---

## File storage

Default layout under `data/excel-research/{jobId}/`:

```
{jobId}/
  original/   ← immutable upload
  enriched/   ← export output
  pdfs/       ← reserved (Phase 2)
  reports/    ← reserved (Phase 2)
```

Artifact metadata lives in `excel_research_file_artifacts`.

---

## Structured row result (`result_json`)

Each processed row stores a JSON document aligned with the product-research spec:

```ts
{
  row_number: number;
  status: "matched" | "partial_match" | "needs_review" | "failed";
  input_product_data: Record<string, string>;
  matched_product: { name, brand, model, sku, category, material_id, source } | null;
  matched_fields: Partial<Record<FillableField, string>>;
  accepted_fields: FillableField[];
  catalog_pdf_url: string;
  source_urls: string[];
  evidence: Array<{
    field, value, source_url, source_type, confidence, note
  }>;
  confidence_score: number;
  needs_review: boolean;
  review_reason: string;
}
```

---

## Phase 1 scope vs planned

### Shipped

- Durable jobs with batch processing and scheduler resume
- Catalog fuzzy match + optional SearXNG web search
- Evidence persistence and change log
- Review UI with approve/skip
- Preserve-mode Excel export
- Vietnamese UI copy

### Not yet implemented

- PDF discovery, download, text extraction, or generated catalogs
- Excel dropdown / data-validation option matching
- LLM structured extraction (OpenRouter wiring for research rows)
- Export zip bundle (PDFs + review report)
- Editable column mapping in UI (uses server `suggestedMapping`)
- Force-overwrite per field
- Auth / rate limiting (inherits `publicProcedure` like other material routes)

See the original planning notes in agent transcripts and the full product spec from the June 2026 design session for Phase 2+.

---

## Development notes

### Typecheck

```bash
npx tsc --noEmit
```

### Manual batch trigger

```ts
// via tRPC or server caller
await trpc.excelResearch.processBatch({ jobId: "…" });
```

### Related tables (separate feature)

Migration `0018_material_enrichment.sql` adds `material_enrichment_jobs` for enriching **existing catalog materials** via web research — not the Excel upload flow. Do not confuse the two job systems.

### Reused modules

- `src/server/services/excel-workbook.ts` — parse, header detect, column map
- `src/server/services/excel-enrich.ts` — `matchRows`, `writeEnrichedWorkbook`
- `src/lib/materials/excel-enrich-fields.ts` — fill rules, labels, thresholds
- `src/server/services/ai-product-matcher.ts` — trigram + weighted scoring
- `src/server/services/shop-scrape-jobs.ts` — job patterns (polling, snapshots)

---

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Job stuck at `running` | Process died — scheduler should resume; or call `processBatch` |
| No web evidence | `SEARXNG_BASE_URL` unset or SearXNG unreachable |
| All rows `error` | Missing product name column in mapping |
| Export empty | No rows in `matched`/`approved` with `accepted_fields` |
| Migration errors | Run `0019` after `0018`; check for enum name conflicts |

---

## File index (quick reference)

```
src/app/(dashboard)/research-enrich/
src/app/_components/research-enrich/
src/server/api/routers/excel-research.ts
src/server/services/excel-research/
src/server/services/excel-research-jobs.ts
src/server/services/excel-research-storage.ts
drizzle/0019_excel_research_jobs.sql
```
