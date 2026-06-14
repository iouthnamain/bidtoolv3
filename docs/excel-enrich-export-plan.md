# Excel Enrich & Export — System Plan

> **See also:** [Excel Product Research](./excel-product-research.md) — durable job-based research at `/research-enrich` (catalog + web search). [Material Web Enrichment](./material-enrichment.md) — enrich **saved catalog rows** at `/materials/enrich`. This document covers the faster catalog-only path at `/enrich`.

> **Goal**: Upload a standardized Excel that uses the same fields as the Material (product) page but is often missing many of them. The page matches each row against the saved Material catalog, fills the blank fields from the matched product, lets me review/adjust, and exports a completed Excel I can download.

This is a review document. No code has been written yet. Once approved, implementation follows the **File-by-file plan** at the bottom.

---

## 1. What this feature does (in one breath)

```
Upload .xlsx ──▶ Parse + auto-map columns ──▶ Match each row to a saved Material
     │                                                    │
     │                                          (pg_trgm name similarity +
     │                                           weighted spec/mfr/origin score)
     ▼                                                    ▼
 Review screen: per row → product candidate CARDS (image, price, why-it-matched),
                pick the right one or search manually; see exactly what gets filled
     │
     ▼
 Fill ONLY blank fields from the chosen product (never overwrite what's in the sheet)
     │
     ▼
 Export .xlsx (original layout preserved + filled cells) ──▶ download
```

Key principle: **the uploaded sheet is the source of truth for cells that already have a value.** We only fill blanks. A "force overwrite" toggle is offered per-field but defaults off.

---

## 2. Why we can build this fast (existing pieces we reuse)

The codebase already has every hard part. We are wiring them together, not inventing them.

| Need | Already exists | File |
|------|---------------|------|
| Parse `.xlsx` (base64 → matrix, header detection, merged cells) | `parseWorkbookBase64`, `detectHeaderIndex`, `buildSheetFromMatrix` | `src/server/services/excel-workbook.ts` |
| Column → field auto-mapping (VN aliases) | `suggestColumnMapping`, `aliases`, `columnKeys` | `src/server/services/excel-workbook.ts` |
| Vietnamese-safe normalization | `normalizeToken`, `parseOptionalNumber` | `src/server/services/excel-workbook.ts` |
| Fuzzy product matching (trigram + weighted score) | `findFuzzyCandidates`, `computeScoreBreakdown`, `computeWeightedScore` | `src/server/services/ai-product-matcher.ts` |
| Material catalog data + search | `materials` table, `material` router | `src/server/db/schema.ts`, `src/server/api/routers/material.ts` |
| Upload (`file → base64`) UI pattern | `fileToBase64` + `previewMaterialsXlsx` flow | `src/app/_components/materials/import-client.tsx` |
| Review/accept UX pattern | `match-review-client.tsx` | `src/app/_components/materials/` |
| UI building blocks | Button, Badge, EmptyState, Toast, ConfirmDialog, Skeleton | `src/app/_components/ui/` |
| Excel **writing** | `exceljs` is already a dependency (v4.4.0) | `package.json` |

**Net new work** is small: one new tRPC procedure group, a candidate-hydration + export builder, and one client page with a card-based review screen. No new dependencies, no DB migration.

---

## 3. The field model (what gets matched and filled)

The "product" is the `materials` table. The fillable fields, mapped to the Excel column keys already defined in `excel-workbook.ts`:

| Material field (`materials`) | Excel column key (`ColumnKey`) | Type | Fillable? |
|------------------------------|-------------------------------|------|-----------|
| `name` | `materialName` | text | match key (not filled) |
| `unit` | `unit` | text | ✅ |
| `specText` | `specText` | text | ✅ |
| `category` | *(no key yet — add `category`)* | text | ✅ |
| `manufacturer` | `vendorHint` | text | ✅ |
| `originCountry` | `originHint` | text | ✅ |
| `defaultUnitPrice` | `unitPrice` | number | ✅ |
| `currency` | *(implicit, default VND)* | text | ✅ |
| `sourceUrl` | `sourceUrl` | text | ✅ |
| `code` | *(no key yet — add `code`)* | text | ✅ |
| catalog PDF urls | `catalogPdfUrls` | text(joined) | ✅ |

> **Decision point #1** — `excel-workbook.ts` `columnKeys` currently has no `category` or `code` alias set. The product page shows both ("Mã vật tư" / "Nhóm"). I will **add `code` and `category` to `columnKeys` + `aliases`** so they round-trip. This is a small, backward-compatible addition (existing import flow gains two optional columns). Flag if you'd rather leave the import path untouched and only handle these two in the new export builder.

A "field" the user sees in the review UI is therefore a known set:
`code, name, unit, category, specText, manufacturer, originCountry, defaultUnitPrice, currency, sourceUrl, catalogPdfUrls`.

---

## 4. Matching strategy

Reuse `findFuzzyCandidates(db, product, minSimilarity, limit)` from `ai-product-matcher.ts` — it already does:
- `pg_trgm` `similarity(m.name, …)` retrieval over `materials` (fast, indexed-ish, handles VN),
- weighted re-score across name / unit / manufacturer / origin / spec / dimension.

Each uploaded row becomes a `ScrapedShopProduct`-shaped object (the matcher's input type) using whatever columns the sheet provided:

```
{ name, unit, specText, manufacturer, originCountry, price, currency, sourceUrl, ... }
```

Per row we classify by the top candidate's `score`:

| Score | Status | Default action |
|-------|--------|----------------|
| ≥ 0.85 | `auto` (high confidence) | auto-select top match, fill blanks |
| 0.5 – 0.85 | `review` | pre-select top match, **needs my confirmation** |
| < 0.5 (or none) | `unmatched` | no auto-pick; offer candidate cards + manual search |

Thresholds live in one constants block so they're easy to tune.

**Rich candidate payload (new).** `findFuzzyCandidates` today returns only `{ materialId, name, unit, score, breakdown }` — not enough to render a real product card. For this feature each candidate is hydrated with the display fields the card needs: `imageUrl, code, category, manufacturer, originCountry, defaultUnitPrice, currency, specText` (short snippet), plus the `breakdown` so the card can show *why* it matched (e.g. "tên 0.92 · NSX khớp · xuất xứ khớp"). This is one extra `materials` select keyed by the candidate IDs — cheap, done once per match batch.

> **Decision point #2** — Matching is stateless/ephemeral by design (no DB writes). I do **not** plan to persist these into `excel_workspace_items` or `materialMatchDecisions`; this is a one-shot "enrich my sheet and give it back" tool. If you want runs saved/resumable, that's a larger feature — say so and I'll add a workspace table. Default = ephemeral.

---

## 5. Fill rules (the core logic)

For each matched row, for each fillable field:

```
sheetHasValue = cell is non-empty after cleanCell()
materialHasValue = matched material field is non-null/non-empty

fill when:  !sheetHasValue && materialHasValue            → status "filled"
keep  when:  sheetHasValue                                 → status "kept" (sheet wins)
skip  when:  !materialHasValue                             → status "missing-both"
overwrite:   only if user toggled force-overwrite for that field → status "overwritten"
```

Numbers (`unitPrice`) are compared via `parseOptionalNumber` so "25.000" vs 25000 is treated correctly. Every fill is recorded as a diff cell `{ field, before, after, action }` so the review UI can show exactly what changed and I can untick any individual fill before export.

---

## 6. Export strategy

Two options — I recommend **A**.

**Option A — preserve the uploaded workbook, write into it (recommended).**
Re-load the original base64 with `exceljs`, find the data rows by `originalRowIndex` (already tracked by the parser), and write filled values into the existing cells. Original formatting, column order, extra columns, and untouched sheets are preserved. Append nothing destructive. Missing-field columns that didn't exist in the upload (e.g. user never had a `category` column) are appended to the right with a header.

**Option B — generate a fresh standardized workbook.**
Emit a clean sheet with the canonical column order. Simpler, but loses the user's original layout. Offer as a secondary "Download clean template" button.

Output is returned as base64 from the server; the client triggers a download via `Blob` + `URL.createObjectURL` (mirrors `fileToBase64` in reverse). Filename: `{original-name}-enriched.xlsx`.

> **Decision point #3** — Default to Option A. Confirm if you also want the Option B clean export as a second button (low cost, I'll include it unless you say no).

---

## 7. API design (tRPC, added to `materialRouter`)

All under the existing `material.*` router so it shares context/db. Three procedures, all stateless:

```ts
// 1. Parse + auto-map (reuses previewMaterialsXlsx internals)
material.enrichPreviewXlsx({ fileName, workbookBase64, sheetName?, headerRowIndex? })
  → { sheet: ParsedWorkbookSheet, suggestedMapping, warnings }

// 2. Match all rows against the catalog (returns RICH candidate cards)
material.enrichMatchRows({
    rows: Array<{ originalRowIndex, fields: Record<FieldKey, string> }>,
    minScore?, limit?
  })
  → { results: Array<{
        originalRowIndex,
        status: "auto" | "review" | "unmatched",
        topCandidate?: EnrichCandidate,
        candidates: EnrichCandidate[],      // top N, hydrated for card rendering
        fillPlan: Array<{ field, before, after, action }>
     }> }

// EnrichCandidate — everything a product card needs to render + justify the match
type EnrichCandidate = {
  materialId, name, code, unit, category,
  manufacturer, originCountry,
  defaultUnitPrice, currency,
  imageUrl, specSnippet,
  score,                                   // 0..1 overall
  breakdown,                               // per-signal scores → "why it matched" chips
}

// 3. Manual search for the "find a different product" path in a row's card chooser
material.enrichSearchMaterials({ query, limit? })
  → { candidates: EnrichCandidate[] }      // reuses searchMaterials + same hydration

// 4. Build the enriched workbook
material.enrichExportXlsx({
    fileName, workbookBase64, sheetName, mapping,
    decisions: Array<{ originalRowIndex, materialId|null, fields: FieldKey[] /* accepted fills */ }>,
    mode: "preserve" | "clean"
  })
  → { fileName, workbookBase64 }            // client downloads this
```

Why split match (2) from export (4): the review UI needs match results to render the cards before the user commits, and the user edits `decisions` (toggle fills, swap the chosen candidate, search manually) before export. Step 4 is pure: given decisions, produce bytes.

Server-side new code lives in a small service:
`src/server/services/excel-enrich.ts` — `matchRows()`, `hydrateCandidates()`, `buildFillPlan()`, `writeEnrichedWorkbook()`. Matching delegates to `ai-product-matcher`; parsing delegates to `excel-workbook`; hydration is one `materials` select by id.

> **Decision point #4** — Matching N rows = N `findFuzzyCandidates` calls (each a `pg_trgm` query). For a few hundred rows this is fine sequentially; for thousands I'll batch with a concurrency cap (e.g. 10) and/or a single bulk SQL pass. Default: cap at 10 concurrent, hard-limit 2000 rows per run (matches `MAX_IMPORT_ROWS` spirit). Tell me if you expect bigger sheets.

---

## 8. UI / page design

New route (matches existing dashboard structure): `src/app/(dashboard)/materials/enrich/page.tsx`
Client component: `src/app/_components/materials/enrich-client.tsx`

A guided wizard with a persistent **step header** (1 Tải lên · 2 Đối chiếu cột · 3 Xét duyệt & chọn sản phẩm · 4 Xuất file) so I always know where I am and can jump back. Progress and counts are visible at every step.

### Step 1 — Upload
- Large drag-and-drop zone (reuses `fileToBase64`); also click-to-browse. Shows file name, size, sheet count once parsed.
- Inline parsing skeleton (`Skeleton`) while `enrichPreviewXlsx` runs; clear error panel if the file isn't a valid `.xlsx`.
- Multi-sheet picker when the workbook has more than one sheet.

### Step 2 — Confirm column mapping
- Auto-detected header row + auto-mapping shown as editable rows (reuses mapping UI from `import-client.tsx`).
- Per-column dropdown to remap; live preview of first 20 rows so I can see the mapping is right before matching.
- Required `name` column guard with a friendly message if missing.
- "Đối chiếu sản phẩm" button kicks off `enrichMatchRows`.

### Step 3 — Review & choose products (the enhanced core)

This is the heart of the request. Layout = a **master list (left) + detail panel (right)** on desktop, stacked on mobile.

**Left — row list (virtualized).**
- One compact line per Excel row: product name from the sheet, a status pill, and a confidence ring/`Badge`.
- Status pills: 🟢 `auto` (đã ghép), 🟡 `review` (cần xác nhận), ⚪ `unmatched` (chưa ghép), ✅ `confirmed` (đã chọn), 🚫 `skipped`.
- Sticky filter/search bar: filter by status, search by name, "jump to next unconfirmed". A counter shows `confirmed / needs-review / unmatched`.

**Right — the match chooser for the selected row.**
- **Top: the Excel row** — its current fields, with blanks clearly marked "(trống)" so I see what's missing.
- **Below: candidate product cards** — a responsive grid of `EnrichCandidate` cards. Each card shows:
  - Product image (`imageUrl`, graceful placeholder when null),
  - Name + `code`, manufacturer · origin, unit, formatted price (`defaultUnitPrice` + `currency`),
  - A **confidence meter** and **"why it matched" chips** from `breakdown` (e.g. "tên 92%", "NSX khớp", "xuất xứ khớp", "thông số khớp"),
  - A **fill-preview line**: "Sẽ điền: đơn giá, NSX, xuất xứ (3 trường trống)" so I know the impact of choosing this card,
  - Primary action **"Chọn sản phẩm này"**; the auto/top pick is visually highlighted with a "Gợi ý tốt nhất" ribbon and pre-selected.
- **"Tìm sản phẩm khác"** — an inline search box (debounced → `enrichSearchMaterials`) that swaps the grid to manual search results as the same cards, for when none of the suggestions fit.
- **"Bỏ qua dòng này"** — mark `skipped` (exported unchanged).
- Keyboard support: ↑/↓ move rows, `1–9` pick the Nth card, `Enter` confirm, `s` skip, `f` next unconfirmed — fast review of long sheets.

**After a card is chosen** → an inline **fill plan** for that row: each fillable field as a `before → after` row with a checkbox (filled ones checked by default; "kept"/"missing" muted). I can untick any individual fill. Force-overwrite is a per-field toggle, off by default.

**Bulk actions** (sticky `BulkActionBar`):
- "Xác nhận tất cả gợi ý ≥ 85%" (confirm all `auto`),
- "Bỏ qua tất cả chưa ghép",
- batch filters by status.

**KPIs** across the top: tổng dòng · đã ghép · trường sẽ điền · chưa ghép — updating live as I confirm.

### Step 4 — Export
- Summary recap: X dòng đã ghép, Y trường sẽ điền, Z dòng bỏ qua/không ghép.
- "Xuất file đã điền (.xlsx)" (Option A preserve) → `enrichExportXlsx` → `Blob` download.
- Secondary "Tải mẫu chuẩn" (Option B clean) if enabled.
- `ConfirmDialog` if unmatched rows remain ("12 dòng chưa ghép sẽ được xuất nguyên trạng — tiếp tục?"). `Toast` on success with the filename.

### Cross-cutting UX polish
- **Persisted draft**: keep upload + decisions in component state (and optionally `sessionStorage`) so an accidental refresh mid-review doesn't lose work.
- **Optimistic, snappy interactions**: choosing a card updates the row instantly; matching shows per-row skeletons rather than one big spinner.
- **Empty/error states** via `EmptyState`; every async path has loading + error UI.
- **Accessibility**: cards are real buttons, focus-visible rings, ARIA labels on confidence meters, full keyboard flow.
- **Responsive**: master/detail collapses to a single column with a back affordance on mobile.
- All components from `src/app/_components/ui/`; Tailwind v4; Vietnamese-first labels.

---

## 9. Edge cases & how they're handled

- **No name column / unmappable sheet** → block at step 2 with a clear message (reuses `REQUIRED_PRODUCT_KEY` check in `rowsFromMapping`).
- **Multiple sheets** → sheet picker (already returned by `parseWorkbookBase64`).
- **No candidates above threshold** → row shown as `unmatched`; the detail panel still offers manual `enrichSearchMaterials` so I can always find a product by hand.
- **Candidate has no image** → card placeholder, no layout shift.
- **Duplicate matches** (two rows → same material) → allowed; each row filled independently.
- **Number formatting** (VN "25.000,50") → `parseOptionalNumber` on read; write back as number so Excel formats it.
- **Merged cells** → parser already blanks non-master merged cells; export writes only into master cells.
- **`> 2000` rows** → warn + truncate (consistent with `MAX_IMPORT_ROWS`); row list is virtualized so large sheets stay smooth.
- **Sheet has columns the catalog doesn't fill** → left untouched (sheet wins / no material value).
- **Force-overwrite off by default** → we never silently destroy user data.

---

## 10. Testing plan

- **Unit** (Vitest, matches `ai-product-matcher.test.ts` / `shop-material-scraper.test.ts` style):
  - `buildFillPlan()` — fills blanks, keeps existing, respects force-overwrite, number parsing.
  - `hydrateCandidates()` — candidate id → card payload (image, price, breakdown chips) is correct.
  - `writeEnrichedWorkbook()` — round-trip a small base64 fixture, assert filled cells + preserved untouched cells.
  - column-key additions (`code`, `category`) map from VN aliases.
- **Integration**: `enrichMatchRows` against seeded materials returns expected statuses at threshold boundaries and rich candidates; `enrichSearchMaterials` returns card-shaped results.
- **Manual**: upload a real partially-filled sheet, pick products from the cards, verify download opens in Excel with original layout intact.

Run with the project's existing test runner (Bun + Vitest). I'll verify build (`next build` / typecheck) before declaring done.

---

## 11. File-by-file implementation plan

| # | File | Change |
|---|------|--------|
| 1 | `src/server/services/excel-workbook.ts` | Add `code`, `category` to `columnKeys` + `aliases`; expose them in `rowsFromMapping`. (Decision #1) |
| 2 | `src/server/services/excel-enrich.ts` | **New.** `FieldKey` set, `EnrichCandidate` type, `rowToScrapedProduct()`, `matchRows()` (wraps `findFuzzyCandidates`, classifies by threshold), `hydrateCandidates()` (id → card payload), `buildFillPlan()`, `writeEnrichedWorkbook()` (exceljs, preserve + clean modes). |
| 3 | `src/server/services/excel-enrich.test.ts` | **New.** Unit tests for fill plan, candidate hydration, workbook writer, and mapping additions. |
| 4 | `src/server/api/routers/material.ts` | Add `enrichPreviewXlsx`, `enrichMatchRows`, `enrichSearchMaterials`, `enrichExportXlsx` to `materialRouter`. Reuse existing zod input pieces + `searchMaterials`. |
| 5 | `src/app/(dashboard)/materials/enrich/page.tsx` | **New.** Server page shell that renders the client. |
| 6 | `src/app/_components/materials/enrich-client.tsx` | **New.** 4-step wizard with step header (upload → map → review/choose → export). Reuses upload + mapping UI from `import-client.tsx`. |
| 7 | `src/app/_components/materials/enrich/` | **New.** Sub-components: `ProductCandidateCard.tsx` (image, price, confidence meter, why-it-matched chips, fill preview), `RowList.tsx` (virtualized master list + filters), `MatchChooserPanel.tsx` (detail panel: Excel row + card grid + manual search + fill plan), `StepHeader.tsx`. |
| 8 | Materials nav (wherever `/materials/import`, `/materials/scrape` links live) | Add an "Đối chiếu & điền Excel" (Enrich) link. |

No DB migration. No new npm dependencies (virtualization via the lightweight approach already used in the project's tables, or a tiny windowing helper if none exists — confirmed during build).

---

## 12. Open decisions for you (summary)

1. **Add `code` + `category` to the importer's column keys?** (needed for full round-trip) — default **yes**.
2. **Ephemeral runs vs. saved/resumable workspace?** — default **ephemeral** (no DB writes).
3. **Include the "clean template" export (Option B) alongside preserve-mode (Option A)?** — default **yes, both**.
4. **Expected sheet size?** — default cap **2000 rows**, 10 concurrent matches.

Tell me your answers (or "all defaults"), and I'll implement in the file order above, building + testing as I go.
