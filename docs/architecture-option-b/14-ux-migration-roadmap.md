# 14 — UX migration roadmap

UX/UI work aligned with [08 — Migration roadmap](./08-migration-roadmap.md). UX phases run **in parallel** with engineering phases; design system precedes feature ports.

---

## Timeline overview

```text
UX-0 ──► UX-1 ──► UX-2 ──► UX-3 ──► UX-4
tokens    shell     scrape    catalog   polish + a11y
          + ds      rewrite   + locks
```

| UX phase | Engineering phase | Calendar (approx) |
| --- | --- | --- |
| UX-0 | Phase 0 | Week 1 |
| UX-1 | Phase 3 start | Weeks 6–7 |
| UX-2 | Phase 3 | Weeks 7–9 |
| UX-3 | Phase 4 | Weeks 9–12 |
| UX-4 | Phase 5 | Weeks 12–14 |

---

## UX-0 — Foundations (with Phase 0)

**Goal:** Tokens and component package ready; no user-visible change on Next app.

### Tasks

- [ ] Create `packages/ui` with tokens from `globals.css`
- [ ] Port Button, Badge, EmptyState, Toast, ConfirmDialog, Skeleton
- [ ] Document token semantics in [11 — Design system](./11-design-system.md)
- [ ] Optional: Figma/wireframe scrape 4-step flow
- [ ] Define `PageHeader`, `JobProgressCard` API (props interface only)

### Acceptance

- Storybook or vitest snapshot for Tier 1 components
- Primary button color aligned to `--brand-1` decision

---

## UX-1 — App shell (Phase 3)

**Goal:** Vite app feels like BidTool from day one.

### Tasks

- [ ] Port `AppShell` (dashboard layout) to `packages/ui`
- [ ] `PageHeader` + `PageSectionNav` on all ported routes
- [ ] Skip link + focus order audit on shell
- [ ] Sidebar nav IA update (labels per [10 — UX/UI strategy](./10-ux-ui-strategy.md))
- [ ] Redirect `/import-mapping` → `/materials/import` with toast
- [ ] Dashboard page with KPI cards (simplified data)

### Acceptance

- [ ] Navigation matches Next app destinations
- [ ] Collapse state persists
- [ ] Mobile drawer works
- [ ] `lang="vi"` and page titles set per route

---

## UX-2 — Scrape experience (Phase 3, critical)

**Goal:** Replace 2900-line monolith with stepper flow + SSE progress.

### Tasks

- [ ] Implement `Stepper` (4 steps)
- [ ] Step 1: configure form (existing fields + validation copy)
- [ ] Step 2: `JobProgressCard` wired to SSE
- [ ] Separate page/product progress labels (fix page count UX)
- [ ] Step 3: virtualized `DataTable` + filters (promo name, missing price, catalog)
- [ ] `QualityFlag` for KH/promo badge names
- [ ] Row drawer with scrape diagnostics
- [ ] Step 4: import monitor + results
- [ ] Toggle “Hiện sản phẩm thiếu tên”
- [ ] Failed pages expandable panel
- [ ] Remove 1.5s full-job poll UX (SSE only + fallback banner)

### Acceptance

- [ ] E2E: configure → complete scrape → review → import
- [ ] No layout shift when progress updates
- [ ] Questionable names visible via filter
- [ ] Matches [12 — Screen specifications](./12-screen-specifications.md) scrape section

---

## UX-3 — Catalog & materials (Phase 4)

**Goal:** Address catalog visibility, locked fields, list performance.

### Tasks

- [ ] Materials table: **Catalog** column + filter
- [ ] Summary strip: catalog PDF count
- [ ] Virtualize materials table
- [ ] Material detail: `LockedField` groups + unlock confirm
- [ ] Backend coordination: lock flags in API (if not exists, stub UI with local state until API lands)
- [ ] Bulk action bar polish
- [ ] Search page: sticky filters, save toast improvement
- [ ] Workflows: paginated run history

### Acceptance

- [ ] User can filter materials with catalog PDF in 2 clicks
- [ ] Locked fields obvious on detail page
- [ ] List smooth at 100 rows/page

---

## UX-4 — Polish & production (Phase 5)

**Goal:** Ship-quality UI on desktop and on-prem.

### Tasks

- [ ] axe-core Playwright gate on materials + scrape
- [ ] Keyboard manual test checklist signed off
- [ ] Desktop settings: api/worker status indicators
- [ ] Help page TOC + chunk split if needed
- [ ] Empty/error states on all routes
- [ ] Visual regression baseline screenshots
- [ ] Bundle check: route chunks < 500KB gzip (soft)

### Acceptance

- [ ] Zero critical axe violations on primary flows
- [ ] Electron 1280×800 usable without horizontal shell scroll
- [ ] Update docs screenshots in `docs/updates/` if UI changed materially

---

## Quick wins on current Next app (optional pre-migration)

Can ship before Option B to build trust:

| Change | Effort | Impact |
| --- | --- | --- |
| Catalog column on materials list | Small | High (user request) |
| Scrape progress: separate page vs product labels | Small | Medium |
| `QualityFlag` filter for promo names in scrape review | Medium | High |
| Locked field UI on material detail | Medium | High |
| Reduce scrape poll to 3s + don’t pass full products in list endpoint | Eng + small UX | High |

Track these as optional **UX-0.5** tickets if product needs relief before migration.

---

## Roles & artifacts

| Role | Deliverable |
| --- | --- |
| Product / owner | Prioritize UX-0.5 vs wait for UX-2 |
| Design | Wireframes scrape steps (optional) |
| Frontend | `packages/ui` + feature modules |
| Backend | SSE, `hasCatalogPdf`, lock flags API |
| QA | a11y + E2E scrape path |

---

## Definition of done (UX track)

- [ ] `packages/ui` is sole source for shared components
- [ ] Scrape flow uses 4-step stepper + SSE
- [ ] Materials list shows catalog PDF presence
- [ ] Locked fields UX on detail
- [ ] WCAG AA on primary flows verified
- [ ] No monolithic client files > 800 lines in `apps/web`
- [ ] Vietnamese copy reviewed for new strings

---

## Traceability matrix

| User note (`docs/note.md`) | UX doc | Phase |
| --- | --- | --- |
| bug on name scrape | QualityFlag + review filter | UX-2 |
| missed null products | Toggle show/hide empty names | UX-2 |
| still remain KH | Promo name highlighting | UX-2 |
| bug on number of page scrape | Dual progress bars + labels | UX-2 |
| material list catalog | Catalog column + filter | UX-3 |
| locks important info | LockedField pattern | UX-3 |
