# Workflow 02 - Excel Workspace Product Sourcing

## Goal

Turn an uploaded procurement/product spreadsheet into an enriched Excel file with reviewed web product evidence.

Target flow:

`excel workspace -> import Excel -> map columns -> review product rows -> find web candidates -> choose correct product -> export enriched Excel -> final review`

## Users

- Procurement staff reviewing supplier/product spreadsheets.
- Operations users collecting source evidence for product matching.
- Analysts preparing enriched product lists for approval.

## Entry Points

- `/excel-workspace` - create or reopen a workspace.
- `/excel-workspace/[id]?step=import|map|review|find|export` - step-based wizard.

## Inputs

- `.xls` or `.xlsx` workbook.
- Selected sheet name.
- Column mapping:
  - product name
  - spec/description
  - unit
  - quantity
  - target price
  - currency
  - vendor hint
  - origin hint
  - notes
- Web search provider:
  - SearXNG when `SEARXNG_BASE_URL` is configured.
  - Manual match when web search cannot produce usable evidence.

## Status Flow

`draft -> imported -> mapped -> reviewed -> matched -> exported`

Meaning:

- `draft`: workspace exists, no workbook imported yet.
- `imported`: workbook stored and sheet metadata available.
- `mapped`: user selected sheet and mapped required columns.
- `reviewed`: parsed rows were confirmed or edited by user.
- `matched`: every included row has selected web candidate or manual match.
- `exported`: enriched workbook was generated.

## Main Steps

1. User creates a workspace from `/excel-workspace`.
2. User uploads `.xls` or `.xlsx`.
3. System reads sheet names and previews headers.
4. User selects sheet and confirms column mapping.
5. System imports normalized rows while preserving original row data.
6. User reviews parsed rows and edits missing/incorrect values.
7. User searches web candidates for each row.
8. System builds a Vietnam-focused product query and returns candidate cards.
9. User selects the best candidate or creates a manual match.
10. System stores selected candidate, extracted spec snapshot and evidence.
11. Export unlocks only when all included rows are `matched` or `manual`.
12. System exports a new `.xlsx` with original columns plus appended match fields.

## Output

The enriched workbook keeps original columns and appends:

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

## Data To Persist

- Workspace metadata and status.
- Original workbook JSON and selected sheet.
- Column mapping JSON.
- Imported row original data JSON.
- Search query and candidate results.
- Selected candidate/manual match snapshot.
- Export file name and timestamp.

## Acceptance Criteria

- Original workbook is never mutated.
- Product-name mapping is required before import.
- User can edit imported rows before search.
- Search results show title, URL, domain, snippet/evidence, confidence and match reasons.
- No row is auto-selected by the system.
- Export is blocked while any included row is unmatched.
- Exported workbook contains all original columns plus appended enrichment fields.

## Edge Cases

- Workbook has many sheets: force explicit sheet selection.
- Header row is ambiguous: show preview and require user confirmation.
- Search provider times out: show retry and manual match options.
- Multiple candidates look similar: allow user to compare evidence, not only confidence score.
- A row should be excluded: mark it out-of-scope so it does not block export.
