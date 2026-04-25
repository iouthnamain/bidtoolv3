# Excel Workspace - Generic Product Sourcing

This spec supersedes the older school/THVT workspace notes. The Excel Workspace is now a generic procurement/product-sourcing tool for uploaded spreadsheets.

## Goal

Turn an arbitrary product spreadsheet into an enriched Excel file with matched web product evidence:

`Import Excel -> Map Columns -> Review Product Rows -> Find Web Candidates -> Choose Correct Product -> Export Enriched Excel`

The original workbook is not mutated. Export creates a new `.xlsx` with original columns plus appended matched product/source/evidence fields.

## Users

- Procurement staff reviewing vendor/product spreadsheets.
- Operations users who need evidence-backed product matching.
- Analysts preparing enriched product lists for downstream review.

## Routes

- `/excel-workspace`
  - Create a generic workspace.
  - See uploaded file, selected sheet, row count, and status.

- `/excel-workspace/[id]?step=import|map|review|find|export`
  - `import`: upload `.xls` or `.xlsx`.
  - `map`: choose sheet and map product/spec/unit/quantity/price columns.
  - `review`: fix parsed rows before web search.
  - `find`: search Tavily candidates and choose or manually enter matches.
  - `export`: download enriched Excel when all rows are matched.

## Data Model

Workspace fields:

- `name`
- `source_file_name`
- `source_sheet_name`
- `status`
- `row_count`
- `column_mapping_json`
- `workbook_json`
- `export_file_name`
- `exported_at`
- timestamps

Imported row fields:

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

Candidate fields:

- `workspace_item_id`
- provider (`tavily` or `manual`)
- query, title, URL, domain
- snippet/raw evidence
- image URL
- extracted spec JSON
- confidence score
- match reasons
- selected flag

## Matching

V1 uses Tavily general search with Vietnam-focused queries. Search combines product name, spec text, unit, optional price/vendor/origin hints, and Vietnamese product-search terms.

The scoring is deterministic and heuristic:

- product name and keyword overlap
- unit/spec overlap
- Vietnam/supplier relevance
- detected price
- origin match when provided
- Tavily result score

The system never auto-selects. The user must choose a candidate or create a manual match.

## Export

Export is blocked until every included row is `matched` or `manual`.

The new workbook appends:

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

## Future Plans

Catalog PDF, automated check, and final approval are later plans. They should build on the generic matched/exported workspace data rather than reintroducing school-specific concepts.
