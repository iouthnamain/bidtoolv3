# Plan 01 - Generic Excel Product Workspace

Plan 01 implements the import-first foundation for generic product/procurement spreadsheets:

`Import Excel -> Map Columns -> Review Product Rows -> Find Web Candidates -> Choose Correct Product -> Export Enriched Excel`

The feature is no longer school-related. THVT, HK, campus, school-year, and catalog PDF language belong to older notes and should not appear in the Plan 01 app surface.

## Scope

In scope:

- Create a generic Excel workspace from `/excel-workspace`.
- Upload `.xls` or `.xlsx` files using `xlsx`.
- Preview workbook sheets and auto-suggest column mappings.
- Require a mapped product-name column.
- Optional mapped fields: spec/description, unit, quantity, target price, currency, vendor hint, origin hint, notes.
- Import normalized product rows while preserving original row data.
- Let users review and edit parsed rows before search.
- Search web candidates with Tavily general search.
- Show candidate cards with confidence, reasons, source, image, spec, price, origin, vendor, and evidence.
- Require human selection or manual match for each row.
- Export an enriched `.xlsx` that keeps original columns and appends match/evidence fields.

Out of scope:

- Catalog PDF generation.
- Automated check/final approval.
- LLM extraction.
- Google/SerpAPI search providers.
- `/materials` as the primary Plan 01 entry point.

## Routes

- `/excel-workspace` - workspace list and create workspace.
- `/excel-workspace/[id]?step=import|map|review|find|export` - wizard.

## Status Flow

`draft -> imported -> mapped -> reviewed -> matched -> exported`

Export is rejected while any included row has `match_status = unmatched` or `candidates_found`.

## Data Model

`excel_workspaces`:

- `name`
- `source_file_name`
- `source_sheet_name`
- `status`
- `row_count`
- `column_mapping_json`
- `workbook_json`
- `export_file_name`
- `exported_at`
- `created_at`
- `updated_at`

`excel_workspace_items`:

- `workspace_id`
- `original_row_index`
- `original_data_json`
- `product_name`
- `spec_text`
- `unit`
- `quantity`
- `target_price`
- `currency`
- `vendor_hint`
- `origin_hint`
- `notes`
- `search_keywords`
- `selected_candidate_id`
- `enriched_snapshot_json`
- `match_status`

`web_product_candidates` stores Tavily/manual candidates and evidence:

- provider, query, title, URL, domain, snippet/raw evidence, image URL
- extracted spec JSON
- confidence score
- match reasons
- selected flag
- fetched timestamp

## tRPC Contracts

- `createWorkspace({ name })`
- `uploadWorkbook({ workspaceId, fileName, workbookBase64 })`
- `previewWorkbookSheets({ workspaceId })`
- `setColumnMapping({ workspaceId, sheetName, mapping })`
- `importMappedRows({ workspaceId })`
- `updateImportedRow({ rowId, patch })`
- `searchWebCandidates({ rowId })`
- `selectWebCandidate({ rowId, candidateId })`
- `manualMatch({ rowId, spec })`
- `clearSelectedCandidate({ rowId })`
- `exportEnrichedExcel({ workspaceId })`
- `transitionState({ id, to })`

## Tavily Search

V1 uses Tavily only.

Search query format:

`{product name} {spec text} {unit} {budget/vendor/origin hints} gia thong so Viet Nam`

Defaults:

- `topic=general`
- `country=vietnam`
- `search_depth=basic`
- `max_results=8`
- `include_raw_content=text`
- `include_images=true`
- `include_answer=false`

Env:

- `TAVILY_API_KEY`
- `TAVILY_TIMEOUT_MS=15000`
- `TAVILY_MAX_RESULTS=8`

## Export Fields

The enriched workbook preserves original columns and appends:

- `matched_product_name`
- `matched_brand`
- `matched_model`
- `matched_spec`
- `matched_price`
- `matched_currency`
- `matched_origin`
- `matched_vendor`
- `matched_source_url`
- `match_confidence`
- `match_method`
- `evidence`

## Verification

- `npm run typecheck`
- `npm run check`
- `npm run build`
- Manual smoke:
  1. Create a workspace.
  2. Upload a generic Excel with product rows.
  3. Confirm/fix mappings.
  4. Review parsed rows.
  5. Search candidates for several rows.
  6. Choose one Tavily match and one manual match.
  7. Export enriched Excel and verify original columns plus appended match fields.
