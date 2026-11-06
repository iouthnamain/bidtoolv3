# Theo dõi vật tư — architecture

## Problem

BidTool already has a reusable material catalog and Excel/BOQ workspaces, but neither one answers the operational questions for a project: what is required, what has been ordered, what is physically available, what is in transit, what has arrived at the site, what has been installed, and what is still missing. The new capability must support separate project workspaces while sharing warehouse stock, planned and actual dates, hierarchical locations, full purchase-to-installation events, and project evidence. It must also preserve the existing single-user Next.js, tRPC, Drizzle/PostgreSQL, in-process scheduler, and durable local data-root architecture.

## Decisions already agreed

- Shared stock can be reserved by multiple project workspaces.
- Each project has a database workspace and a project-scoped file tree.
- Planned dates and actual event dates are separate.
- The lifecycle includes purchase, receipt, shipment, site receipt, installation, return, waste, transfer, adjustment, and reversal.
- Locations are hierarchical.
- Requirements may be linked to the catalog or remain provisional.
- The first release focuses on operational tracking, not invoices, payments, or approvals.
- Quantities are positive decimals with one consistent unit per material line; unit conversion is deferred.

## Usage (operator's view)

An operator creates a project workspace, optionally links it to a tender package, plan, or investment project, and creates a material plan. Each requirement records the requested material snapshot, quantity, unit, required date, and target location. The operator can then:

1. record a purchase commitment without changing physical stock;
2. receive material into a warehouse or site;
3. reserve shared warehouse stock for a project;
4. ship reserved or received material to a site;
5. record site receipt;
6. record installation, return, waste, transfer, or correction;
7. attach delivery notes, photos, purchase documents, and installation evidence;
8. review shortages and late requirements from the dashboard.

The UI should show distinct quantities for every requirement:

| Metric               | Meaning                                                                          |
| -------------------- | -------------------------------------------------------------------------------- |
| Required             | Planned quantity on the requirement                                              |
| Ordered              | Quantity in purchase commitments allocated to the requirement                    |
| Missing to buy       | `max(0, required - ordered)`                                                     |
| Shipped              | Quantity recorded as shipped to the site                                         |
| Received             | Quantity received at the destination                                             |
| In transit           | `shipped - received`                                                             |
| Installed            | Quantity consumed by installation movements                                      |
| Remaining to install | `max(0, required - installed)`                                                   |
| Site on hand         | Site receipts + returns + inbound adjustments − shipments − installation − waste |
| Shared available     | Location on-hand − active reservations                                           |

No single ambiguous `remaining` or `missing` field is exposed.

## Shape

### Bounded context and module boundaries

Add a top-level `materialControlRouter` in `src/server/api/routers/material-control.ts`, register it in `src/server/api/root.ts`, and keep domain services under `src/server/services/material-control/`:

```text
src/server/api/routers/material-control.ts
src/server/services/material-control/
  project-service.ts
  requirement-service.ts
  procurement-service.ts
  movement-service.ts
  inventory-queries.ts
  quantity-formulas.ts
  document-service.ts
  types.ts
```

The router validates inputs and maps permissions. Services own transactions, row locks, state transitions, snapshot rules, and quantity formulas. The UI receives view models and command results, never raw ledger rows or storage paths.

### Core entities

The first additive migration should introduce these tables and enums:

| Entity                                       | Responsibility                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `material_control_projects`                  | Separate project workspace, status, dates, notes, and optional source links               |
| `material_control_project_sources`           | Links a workspace to tender packages, plans, investment projects, or manual references    |
| `material_control_locations`                 | Hierarchical warehouses, sites, zones, transit, installed, and waste locations            |
| `material_control_plans`                     | Named material plan within a project                                                      |
| `material_control_requirements`              | Required quantity plus immutable material snapshot and target location/date               |
| `material_control_purchase_commitments`      | Ordered/committed purchase header                                                         |
| `material_control_purchase_commitment_lines` | Committed quantities, snapshots, supplier references, and optional requirement allocation |
| `material_control_requirement_allocations`   | Explicit allocation of shared commitments or stock reservations to requirements           |
| `material_control_reservations`              | Active/released/fulfilled claims on shared stock                                          |
| `material_control_shipments`                 | Shipment header, source/destination, dates, and lifecycle status                          |
| `material_control_shipment_lines`            | Quantities shipped and received with snapshots and requirement links                      |
| `material_control_stock_movements`           | Append-only physical movement ledger                                                      |
| `material_control_documents`                 | Project-scoped evidence file metadata                                                     |

The project and plan records are intentionally separate. A project is the workspace boundary; a plan is the operational set of requirements. A later phase may allow importing an existing `excelWorkspace` into a plan, but the Excel workspace remains an input/source rather than the stock ledger.

### Snapshot and catalog rules

`materialId` is nullable on requirements, commitment lines, shipment lines, and movements. Every such row must still store `materialName`, `specText`, and `unit`. Linking a provisional row to the catalog later is allowed, but changing the catalog item must not rewrite the stored snapshot. A catalog soft-delete therefore never erases project history.

### Movement invariants

- Quantity is a positive decimal (`numeric(14,3)`); zero and negative command quantities are rejected.
- Every movement has a material snapshot and unit; command validation rejects unit mismatches.
- Receipts require a destination location.
- Shipment, installation, waste, and outbound adjustments require a source location.
- Transfers create paired outbound and inbound rows in one transaction.
- Installation is a movement from a site or zone to an installed virtual location.
- A movement is never edited or deleted after creation. Corrections create a reversal or adjustment linked through `reversalOfId`.
- Writes use a transaction and row locks around the affected material/location/reservation rows.
- The service rejects negative on-hand results unless the command is an explicit, permission-checked adjustment.
- Shipment terminal states and reversal links are guarded against duplicate completion.

### API surface

Queries:

```ts
materialControl.dashboardSummary({ projectId?, dateRange? })
materialControl.listProjects({ status?, keyword?, page?, pageSize? })
materialControl.getProject({ projectId })
materialControl.listRequirements({ planId, status?, keyword?, page?, pageSize? })
materialControl.getRequirementProgress({ requirementId })
materialControl.getStock({ locationId?, materialId?, availability?, page?, pageSize? })
materialControl.listShortages({ projectId?, before?, includeLate? })
materialControl.listDocuments({ projectId, category? })
```

Commands:

```ts
materialControl.createProject(input);
materialControl.updateProject(input);
materialControl.createPlan(input);
materialControl.addRequirement(input);
materialControl.updateRequirement(input);
materialControl.createLocation(input);
materialControl.createPurchaseCommitment(input);
materialControl.recordReceipt(input);
materialControl.createReservation(input);
materialControl.recordShipment(input);
materialControl.recordSiteReceipt(input);
materialControl.recordInstallation(input);
materialControl.recordReturn(input);
materialControl.recordWaste(input);
materialControl.recordTransfer(input);
materialControl.recordAdjustment(input);
materialControl.reverseMovement(input);
materialControl.uploadDocument(input);
materialControl.deleteDocument(input);
```

`recordReceipt`, `recordSiteReceipt`, `recordInstallation`, and the other movement commands all delegate to one movement service. This prevents each screen from implementing different stock rules.

### Page architecture options

#### Option A — project workspace plus global operations (recommended)

```text
/material-control
/material-control/projects
/material-control/projects/new
/material-control/projects/[id]
/material-control/projects/[id]/requirements
/material-control/projects/[id]/purchases
/material-control/projects/[id]/shipments
/material-control/projects/[id]/installation
/material-control/projects/[id]/documents
/material-control/stock
/material-control/locations
/material-control/shortages
```

The project detail shell owns the tabs. Global stock, locations, and shortages give operators cross-project views. This preserves context for project work while still supporting warehouse operations.

#### Option B — process-first operations

```text
/material-control/purchases
/material-control/shipments
/material-control/installation
/material-control/stock
/material-control/shortages
```

This is efficient for a warehouse operator processing a queue across projects, but it makes project context secondary and complicates deep links to a single requirement. It is better as a later saved view or dashboard mode than as the primary route structure.

#### Option C — event-ledger-first

```text
/material-control/movements
/material-control/reservations
/material-control/reconciliation
```

This exposes the underlying accounting model and is useful for audit and reconciliation. It is a poor primary workflow because users think in terms of project needs, purchases, shipments, and installation rather than ledger rows.

**Recommendation:** build Option A, then add process-first saved filters and an audit/reconciliation view only after the core workflow is proven.

### Navigation and UI reuse

Reuse `DashboardShell`, `PageSectionNav`, URL-synchronized filters, and the dynamic detail layout pattern used by materials. Add a “Theo dõi vật tư” section to the dashboard navigation and keep `/materials` as the catalog master-data surface. Vietnamese labels should be:

- Theo dõi vật tư
- Dự án
- Nhu cầu
- Mua hàng
- Vận chuyển
- Lắp đặt
- Tồn kho
- Địa điểm
- Thiếu & chậm
- Tài liệu

Use one aggregate dashboard query rather than client-side N+1 calls.

### Project file system

Keep project files inside the durable data root:

```text
data/material-control/projects/{projectUuid}/
  attachments/{attachmentUuid}/{safeFileName}
  exports/{exportUuid}/{safeFileName}
```

The database row stores project ID, logical category (`general`, `requirement`, `purchase`, `shipment`, `installation`, `export`), display/original filename, relative path, MIME type, byte size, SHA-256 checksum, and timestamps. Use UUIDs for all path segments; never use project names or user-entered slugs. Sanitize basenames, reject traversal, and write atomically. Do not store attachments as base64 JSON and do not calculate stock from files.

The new storage service should extend `resolveStorageDirectory` with `material-control`. The existing on-prem backup inventory, reference checks, and Electron data-root fixtures must include this tree before the feature is considered operationally complete.

## Tradeoffs accepted

- We accept more tables than a single `inventory` table in exchange for explicit lifecycle history and reliable derived quantities.
- We accept nullable catalog links and duplicated snapshots in exchange for provisional requirements and stable project history.
- We accept an append-only correction workflow in exchange for auditability and protection against silent stock changes.
- We accept no unit conversion in the first release in exchange for predictable quantity arithmetic.
- We accept project-scoped evidence first and event-specific attachment joins later in exchange for a smaller initial migration.
- We accept an in-process service boundary because the current product is single-user and local; distributed workers are outside this feature's scope.

## Alternatives considered

- Extending `materialRouter` lost because it is already responsible for catalog CRUD, import, enrichment, scrape jobs, and workbook operations; the new movement policy would become shallow pass-through code mixed with unrelated concerns.
- Reusing `excelWorkspaceItems.qtyInStock` lost because those rows are an enrichment/export workspace, not a shared stock ledger, and they lack location and movement history.
- A single mutable stock balance lost because it cannot explain in-transit quantities, project reservations, installation, or corrections.
- A real object-storage service lost because the current product already has a durable local data-root contract and does not need a new infrastructure dependency.

## Open questions and risks

- Should a single project have multiple active material plans at the same time, or should one plan be designated primary?
- Should a purchase commitment be allowed without a supplier, or is a supplier required before the commitment is confirmed?
- Should site receipt be required before installation, or may an operator record direct delivery-and-installation for exceptional cases?
- Which roles may record adjustments and reversals once the existing permission surface is mapped?
- What Excel columns should the import adapter map into requirements in the later phase?
- How will a project be archived when it still has active reservations or stock at its site?

## Next implementation step

Build the additive schema and pure quantity-formula module first, with focused tests for snapshots, reservations, movement pairing, and every derived metric; then expose read-only project and stock queries before adding mutations.

## Sources

- [Existing material and Excel schema](../src/server/db/schema.ts)
- [Current workflow architecture](./workflows.md)
- [Material catalog deep dive](./temp/materials.md)
- [Dashboard navigation patterns](../src/app/_components/dashboard/page-nav-presets.ts)
- [Durable storage contract](./updates/durable-storage.md)
- [Data-root resolver](../src/server/services/data-root.ts)
