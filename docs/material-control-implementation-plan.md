# Theo dõi vật tư — small implementation chunks

## Current implementation status

Completed and verified:

- Chunks 0–2: domain context, additive schema/migration, quantity formulas, and focused tests.
- Chunk 3: project, location, plan, and requirement commands with immutable snapshots and archive-on-delete behavior.
- Chunk 4: batched dashboard, plan detail, stock, shortage, and late queries.
- Chunk 5 (initial slice): append-only movement, transfer, reversal, purchase, reservation, and shipment lifecycle commands.
- Chunk 6 (initial slice): dashboard, project workspace, plan, requirements, stock, shortage, location, and document pages.
- Chunks 7–8 (initial slice): project document storage plus durable backup and desktop fixtures.

Remaining work is operational polish: purchase receipt reconciliation, reservation-aware shipment selection, richer forms and filters, import/export adapters, and end-to-end browser coverage. Each addition should preserve the same bounded service and append-only ledger boundaries.

This plan keeps each change narrow enough for one focused worker, one review, and one affected test set. Workers must use dedicated worktrees for substantial changes, own only the files listed in their chunk, and leave unrelated work untouched.

## Chunk 0 — domain baseline and acceptance fixtures

**Owner:** planner/documenter (read-only, then coordinator writes)

**Scope:** `CONTEXT.md`, `docs/adr/0001–0003`, `docs/material-control-architecture.md`, `docs/material-control-implementation-plan.md`

**Deliverable:** agreed vocabulary, formulas, invariants, page options, and open questions.

**Verification:** Markdown links and headings resolve; no implementation starts until the model is accepted.

## Chunk 1 — additive schema and migration

**Owner:** worker-db

**Scope:** `src/server/db/schema.ts`, generated `drizzle/` migration, schema-focused tests only.

**Build:** enums and tables for projects, sources, locations, plans, requirements, commitments, allocations, reservations, shipments, shipment lines, movements, and project documents. Add positive-quantity checks and the indexes from the architecture. Do not modify `materials` semantics or make `excelWorkspaceItems.qtyInStock` authoritative.

**Verification:** `bun run db:generate`; inspect generated SQL; run the focused schema/integration checks; apply with `bun run db:migrate` only in an approved database environment.

## Chunk 2 — pure quantity formulas and domain types

**Owner:** worker-api

**Scope:** `src/server/services/material-control/quantity-formulas.ts`, `types.ts`, focused Vitest tests.

**Build:** typed snapshots, movement inputs, reservation states, and deterministic calculations for ordered, missing-to-buy, shipped, received, in-transit, installed, remaining-to-install, site on-hand, and shared available. Reject unit mismatch, non-positive quantity, invalid movement direction, and impossible negative results.

**Verification:** boundary tests for partial receipt, over-receipt, return, waste, transfer pairing, released reservations, late requirements, and catalog link changes.

## Chunk 3 — project, location, and requirement commands

**Owner:** worker-api

**Scope:** `src/server/services/material-control/project-service.ts`, `requirement-service.ts`, `src/server/api/routers/material-control.ts` (project/requirement procedures only), router tests.

**Build:** project CRUD, optional tender source links, location tree, plan CRUD, requirement CRUD, snapshot capture, and plan summaries. Keep command transactions in services; keep router inputs in Zod.

**Verification:** transaction tests for provisional requirements, later catalog linking, hierarchical locations, duplicate project codes, and date validation.

## Chunk 4 — read-only dashboard, stock, and shortage queries

**Owner:** worker-api

**Scope:** `inventory-queries.ts`, router query procedures, query fixtures.

**Build:** aggregate `dashboardSummary`, plan list/detail, stock by location/material, reservation-aware availability, and shortage/late views. Return UI view models rather than raw schema rows.

**Verification:** one query returns all dashboard cards without N+1 behavior; fixture totals match formula tests.

## Chunk 5 — movement command service

**Owner:** worker-api

**Scope:** `movement-service.ts`, `procurement-service.ts`, router movement procedures, focused integration tests.

**Build:** purchase commitments, allocations, reservations, receipts, shipments, site receipts, installation, returns, waste, transfers, adjustments, and reversals. All movement commands delegate to the same transactional service.

**Verification:** concurrent reservation and receipt tests; terminal shipment guards; reversal idempotency; no negative stock except explicit adjustments; paired transfer rows commit atomically.

## Chunk 6 — primary project workspace UI

**Owner:** worker-ui

**Scope:** `src/app/(dashboard)/material-control/**`, new layout/client components, `page-nav-presets.ts`, `role-surfaces.ts`.

**Build:** Option A routes: dashboard, projects, project detail with requirements/purchases/shipments/installation/documents tabs, stock, locations, shortages. Reuse dashboard shell and URL state patterns. Start with read-only dashboard and requirement list, then add forms as API commands land.

**Verification:** focused Playwright smoke flow: create project → add requirement → view summary; check empty/loading/error states, keyboard navigation, mobile layout, and Vietnamese labels.

## Chunk 7 — project documents and storage

**Owner:** worker-storage

**Scope:** `src/server/services/material-control/document-service.ts`, storage tests, document router procedures, project documents UI.

**Build:** safe project-scoped upload/download/list/delete, UUID paths, sanitized names, checksums, MIME/size validation, and category metadata. Keep event-specific joins out until event IDs are stable.

**Verification:** traversal rejection, atomic replacement, checksum, missing-file behavior, deleted-document behavior, and file/database consistency.

## Chunk 8 — durable backup and desktop integration

**Owner:** worker-storage

**Scope:** `src/server/services/data-root.ts`, `scripts/onprem-lib.sh`, durable-storage tests/docs, `tests/data-root.test.ts`, `tests/desktop-data-root.test.ts`.

**Build:** inventory and verify the `material-control` tree in on-prem backup/restore; add desktop migration fixture; preserve the fail-closed rule for unmanaged roots.

**Verification:** focused backup/restore tests and a supported on-prem/Electron rehearsal. Do not claim runtime verification without running it.

## Chunk 9 — imports, exports, and operational polish

**Owner:** worker-api + worker-ui in separate scopes

**Build:** import selected Excel BOQ rows into requirements, export shortage and delivery reports, add process-first saved views, and add audit/reconciliation screens.

**Verification:** fixture workbook round-trip, duplicate import behavior, report totals against the ledger, and end-to-end smoke coverage.

## Dependency graph

```text
0 → 1 → 2 → 3 → 4 → 5
                    ↘
                     6
3 → 7 → 8
5 → 9
```

Chunks 3 and 7 can proceed in parallel after the schema is accepted, provided their writable scopes stay separate. Chunks 4 and 6 can overlap only when the query view models are stable. No worker should edit the shared root for a substantial change.

## First build order

Start with chunks 1 and 2. The first reviewable product slice is chunk 4: a read-only dashboard that proves the schema and formulas against realistic fixtures. Add mutations only after those totals are trusted.
