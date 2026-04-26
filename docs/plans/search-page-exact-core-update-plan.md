# Search Page Exact-Core Update Plan

## Summary

Update the search flow to be honest and correct by default: exact pagination and totals will come from BidWinner’s source pages, while the filters we cannot prove as native source filters will remain available only as clearly-labeled local refinements on the fetched page window. In the same pass, complete Smart View round-trip for `minMatchScore`, fix search-page UI regressions, and make saved package persistence keep stable source identity.

ensure proper vietnamese sorting in province normalization helper
ensure search macthes source available data and total counts
fix search page pagination and total count correctness by using exact source-backed pagination instead of local slicing
use slider for budget range input and persist minMatchScore in Smart Views
fix save-selected package identity loss by persisting externalId, sourceUrl, and closingAt


## Scope and Decisions

- Chosen mode: `Exact Core`.
- In scope:
  - Fix backend search pagination/total correctness.
  - Make province filtering truly source-backed.
  - Rework search-page UI so exact source search and local refinement are clearly separated.
  - Persist and re-apply `minMatchScore` in Smart Views.
  - Fix save-selected package identity loss (`externalId`, `sourceUrl`, `closingAt`).
  - Fix current search-page a11y/state/message regressions.
- Out of scope:
  - Full search-page refactor into subcomponents.
  - Review-status workflow/schema expansion (`reviewing`, `waiting_confirmation`, etc.).
  - Repo-wide unrelated workflow/router build cleanup outside files touched for this search work.
  - Replacing the BidWinner HTML route with `/4.0/bid-seeking/opening-bids`; validation on April 26, 2026 did not give a stable JSON contract.

## Implementation

### 1. Backend Search Contract

Files:
- `src/server/services/bidwinner-search.ts`
- `src/server/api/routers/search.ts`

Changes:
- Keep `/4.0/tim-kiem-goi-thau` as the source.
- Extend HTML parsing to extract both:
  - `hsmts` payload for `current_page`, `per_page`, `last_page`, `total`, `data`
  - `ttp` payload for province code/name mapping
- Add a province normalization helper that maps current UI labels to BidWinner `matp` codes by normalized Vietnamese name.
- Build source requests with repeated `matp` params for multi-select provinces.
- Stop using the current two-page fetch-and-slice approach.
- Compute the remote page window required for the requested local `offset/limit` against BidWinner’s fixed `per_page=20`.
- Return exact `total` from BidWinner metadata, not from locally filtered page slices.

### 2. Exact Search vs Local Refinement Rules

Search behavior will be split explicitly:

- Exact source-backed:
  - `province`
  - source order by `publishedAt`
  - pagination
  - page size
- Local refinement only on the fetched source window:
  - `keyword`
  - `category`
  - `budgetMin`
  - `budgetMax`
  - `minMatchScore`

Implementation details:
- `sortBy` will be normalized to `publishedAt` only.
- Existing URLs containing `sortBy=budget|title|inviter|matchScore` remain accepted but are downgraded to `publishedAt` with a UI notice.
- `sortOrder` may remain `asc|desc`, but only for `publishedAt`.
- Local refinements run after source rows are fetched for the current exact page window.
- Response metadata should include whether local refinement is active so the UI can explain scope honestly.

Recommended type change in `LiveSearchResult`:
- Keep `total` as exact source total.
- Add `visibleCount` for rows remaining after local refinement on the current fetched window.
- Add `localRefinement` metadata:
  - `active: boolean`
  - `fields: ("keyword" | "categories" | "budget" | "minMatchScore")[]`

### 3. Search Page UI Update

File:
- `src/app/_components/dashboard/search-page-client.tsx`

Changes:
- Split controls into two groups:
  - `Tìm theo nguồn BidWinner`
  - `Tinh lọc trong trang hiện tại`
- Remove the current free-form global sort UI for unsupported fields.
- Keep province selector in the exact-search group.
- Keep keyword/category/budget/min-match in the local-refinement group with helper copy stating they do not change source total.
- Replace the header count with:
  - exact source total
  - visible rows in the current page after local refinement
- Show a banner whenever local refinement is active:
  - explain that more matches may exist on other source pages
- Reset page to `1` only when exact-search inputs change, not when only local refinements change.
- Normalize URL state so:
  - source-backed params remain primary search params
  - local refinement params still round-trip through the URL
  - unsupported legacy sort params are stripped on replace

### 4. Search Page Bug Fixes

In the same component:
- Fix `useSearchParams()` one-time initialization drift by syncing draft/applied state from URL when query params change via back/forward or Smart View apply.
- Fix MultiSelect accessibility regression:
  - make `FilterField` the only visible label
  - add an `id` prop to `MultiSelectDropdown` and apply it to the trigger
  - remove the duplicated internal text label paragraph
- Split save-selected success and error messages into separate states/styles.
- Keep error messages in rose/red styling and success in emerald styling.
- Preserve current table-first layout; no mobile redesign in this pass.

### 5. Smart View Round-Trip Completion

Files:
- `src/server/db/schema.ts`
- new drizzle migration
- `src/server/api/routers/search.ts`
- `src/app/_components/dashboard/search-page-client.tsx`
- `src/app/_components/dashboard/saved-items-page-client.tsx`
- `src/lib/workflow-config.ts`
- `src/server/api/routers/workflow.ts`

Changes:
- Add `saved_filters.min_match_score integer not null default 0`.
- Extend `saveFilter` input and insert values to persist `minMatchScore`.
- Extend saved-filter display/apply logic so `/search` links include `minMatchScore`.
- Render `minMatchScore` as a Smart View criteria chip.
- Add inline save controls on the search page:
  - Smart View name input
  - notification frequency select (`daily|weekly`)
- Default save name:
  - if blank, generate `Smart View HH:mm:ss` in `vi-VN`
- Extend workflow filter config to carry `minMatchScore` for display/config parity when creating a workflow from a saved filter.
- Do not change workflow execution semantics in this pass.

### 6. Saved Package Persistence Fix

Files:
- `src/server/db/schema.ts`
- new drizzle migration
- `src/server/api/routers/search.ts`

Changes:
- Extend `tender_packages` with:
  - `external_id text not null`
  - `source_url text not null`
  - `closing_at text null`
- Add a unique index on `external_id`.
- Update `saveSelectedPackages` input to require `sourceUrl` and allow `closingAt`.
- Persist those fields.
- Change duplicate detection from `(title, inviter, publishedAt)` to `externalId`.
- Keep review-status columns out of scope for now.

## Public API / Type Changes

- `search.saveFilter` input adds `minMatchScore`.
- `savedFilters` DB row adds `minMatchScore`.
- `WorkflowFilterConfig` adds `minMatchScore`.
- `search.saveSelectedPackages` input adds `sourceUrl` and `closingAt`.
- `tenderPackages` DB row adds `externalId`, `sourceUrl`, `closingAt`.
- `LiveSearchResult` adds exact-vs-local refinement metadata and `visibleCount`.
- `sortBy` remains backward-compatible at the API boundary but only `publishedAt` is honored.

## Test Cases and Acceptance

### Backend / Data
- No filters, page `1/2/5`, page sizes `10/20/50`: item windows are stable and `total` matches BidWinner payload.
- Province filter with one code and multiple codes produces exact totals matching the source HTML route.
- Legacy `sortBy=budget|title|inviter|matchScore` URLs degrade to `publishedAt` without server errors.
- Saving selected packages twice skips duplicates by `externalId`, not by title heuristics.

### UI / UX
- Search header shows exact source total plus visible refined count.
- When keyword/category/budget/min-match is active, the page shows a refinement-scope notice.
- Smart View save/apply round-trip preserves `minMatchScore`.
- Search page back/forward navigation updates controls and results correctly.
- Multi-select labels point to real controls and tab/focus order remains valid.
- Save-selected success shows green; failure shows red.

### Validation
- Run `eslint` on touched search-related files.
- Run `tsc --noEmit` and confirm no remaining errors from touched search-related files.
- If unrelated repo errors remain elsewhere, document them separately and do not expand scope to fix them.

## Assumptions and Defaults

- BidWinner HTML route `/4.0/tim-kiem-goi-thau` remains the stable source of truth.
- Province source filtering uses `matp`; repeated values work and will be the canonical request format.
- Current category labels remain heuristic app-local labels; native BidWinner category taxonomy redesign is deferred.
- Keyword and budget are not treated as exact source filters in this pass because the public HTML contract was not validated as reliable for them.
- Existing dirty changes in search-related files must be merged carefully; no reset/revert of user work.
