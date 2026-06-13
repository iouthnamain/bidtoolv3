# 11 — Design system

## Overview

BidTool already has an informal design system: Tailwind 4, CSS variables in `src/styles/globals.css`, and components in `src/app/_components/ui/`. Option B consolidates this into **`packages/ui`** shared by `apps/web`.

**Decision:** Evolve custom components first; adopt **shadcn/ui** selectively where it saves time (Dialog, Dropdown, Command palette later). Do not wholesale replace working Button/Badge/Toast in Phase 3.

---

## Design tokens

### Source of truth

Move `src/styles/globals.css` → `packages/ui/src/styles/tokens.css` imported by `apps/web`.

### Color (existing — document semantics)

| Token | Value | Usage |
| --- | --- | --- |
| `--surface-1` | `#ffffff` | Cards, panels |
| `--surface-2` | `#f8fafc` | Page background areas |
| `--surface-3` | `#eef2f7` | Subtle fills |
| `--ink-1` | `#0f172a` | Headings |
| `--ink-2` | `#334155` | Body |
| `--ink-3` | `#64748b` | Labels, section titles |
| `--brand-1` | `#0f766e` | Primary brand (teal) — prefer for success/brand actions |
| `--brand-2` | `#0369a1` | Links, info accent |
| `--critical` | `#be123c` | Errors, destructive |
| `--warning` | `#b45309` | Warnings, questionable scrape rows |
| `--good` | `#047857` | Success states |
| `--ring` | `#0284c7` | Focus ring |

### Align Button with tokens

Today `Button` primary uses `sky-700`; tokens use teal brand. **Phase UX-1:** unify primary button to `brand-1` (teal) for consistency with CSS variables.

### Typography

| Role | Class / spec |
| --- | --- |
| Font | Be Vietnam Pro, `vi-VN` |
| Weights shipped | 400, 600, 700 only (drop 500) |
| Page title | `text-xl font-semibold text-slate-900` |
| Section title | `.section-title` (11px uppercase) |
| Body | `text-sm text-slate-700` |
| Table header | `text-xs font-semibold uppercase tracking-wide text-slate-500` |
| Numbers | `tabular-nums` |

### Spacing & radius

| Element | Spec |
| --- | --- |
| Panel | `.panel` — radius 8px, light border + shadow |
| Button md | min-h 44px touch / 36px desktop (keep current) |
| Input | min-h 44px mobile, consistent horizontal padding |
| Page padding | `px-4 py-6` mobile; `px-6 py-8` lg |

### Motion

| Pattern | Duration |
| --- | --- |
| Button/color hover | 150ms |
| Toast enter | existing `toast-enter` |
| Progress bar width | 300ms ease |
| Dialog backdrop | 150ms |
| Respect `prefers-reduced-motion` | disable non-essential animation |

---

## Component library (`packages/ui`)

### Tier 1 — Port as-is (Phase UX-1)

| Component | File | Notes |
| --- | --- | --- |
| `Button` | `button.tsx` | Add `icon-only` size variant |
| `Badge` | `badge.tsx` | Add `tone="brand"` |
| `EmptyState` | `empty-state.tsx` | |
| `ConfirmDialog` | `confirm-dialog.tsx` | focus trap audit |
| `Toast` / `ToastProvider` | `toast.tsx` | |
| `Skeleton` | `skeleton.tsx` | |
| `FilterField` | `filter-field.tsx` | |
| `SearchableSelect` | `searchable-select.tsx` | virtualize if >200 options |

### Tier 2 — New for Option B (Phase UX-2)

| Component | Purpose |
| --- | --- |
| `PageHeader` | Title, description, breadcrumbs, actions slot |
| `PageSectionNav` | Port from dashboard; sticky optional |
| `Panel` | Wrapper over `.panel` class |
| `JobProgressCard` | Status, dual progress bars (pages + products), elapsed time |
| `JobStatusBadge` | Maps queued/running/completed/failed/cancelled |
| `DataTable` | TanStack Table + virtual scroll + loading/empty |
| `RowDrawer` | Side panel for material/scrape row detail |
| `LockedField` | Read-only display with lock icon + tooltip |
| `CatalogPdfIndicator` | Icon + count badge |
| `QualityFlag` | Scrape name/price confidence warnings |
| `Stepper` | Scrape flow steps (configure → monitor → review → import) |
| `BulkActionBar` | Port existing; sticky bottom on mobile |

### Tier 3 — Consider shadcn (Phase UX-3+)

| shadcn primitive | When |
| --- | --- |
| `Dialog` | If confirm-dialog maintenance hurts |
| `DropdownMenu` | Column picker, row actions |
| `Command` | Global search palette (optional) |
| `Tooltip` | Locked fields, scrape method help |
| `Sheet` | Mobile nav drawer |

Install into `packages/ui` with shared `components.json` if adopted.

---

## Patterns

### Status colors (jobs & imports)

| Status | Badge tone | Left border accent |
| --- | --- | --- |
| queued | neutral | slate |
| running | info | sky |
| completed | success | emerald |
| failed | critical | rose |
| cancelled | warning | amber |

### Progress display

```
┌─ JobProgressCard ─────────────────────────────────────┐
│ ● Đang scrape          shop.example.com    02:14     │
│ Trang:  ████████░░░░  8 / 25                         │
│ Sản phẩm: ██████████  142 / 500 (giới hạn)         │
│ ▼ 2 trang lỗi                                        │
└──────────────────────────────────────────────────────┘
```

- Pages and products are **separate** bars (fixes page-count confusion).
- Show `stopReason` in plain Vietnamese on complete.

### Tables

- Sticky header on scroll
- Row hover: `bg-slate-50`
- Selected row: `bg-sky-50 ring-1 ring-sky-200`
- Questionable scrape row: `bg-amber-50/50` + `QualityFlag`
- Column resize: defer (not v1)

### Forms

- Labels above inputs (`text-xs font-medium text-slate-700`)
- Help text below (`text-xs text-slate-500`)
- Advanced options in `<details>` or collapsible `Panel` titled “Tùy chọn nâng cao”
- Inline validation on blur; scrape URL validated before submit

### Empty / loading / error

| State | Component |
| --- | --- |
| Loading list | `Skeleton` rows × 5 |
| Loading job | `JobProgressCard` with indeterminate bar |
| Empty catalog | `EmptyState` + CTA “Thêm vật tư” / “Scrape shop” |
| Error | Toast + inline `Panel` tone critical with retry |
| SSE disconnect | Banner “Mất kết nối tiến độ — đang thử lại…” |

### Locked fields

```tsx
<LockedField label="Tên vật tư" reason="Khóa sau import để tránh ghi đè">
  {material.name}
</LockedField>
```

- `metadata_json.locks` or dedicated lock flags (backend doc TBD)
- Bulk edit: skip locked fields; show summary “3 trường bị khóa, không đổi”

---

## Icons

Continue **lucide-react** with named imports.

| Domain | Icons |
| --- | --- |
| Catalog | `Boxes`, `Package` |
| Catalog PDF | `FileText` |
| Scrape | `LinkIcon`, `Globe` |
| Import | `Upload`, `FileSpreadsheet` |
| Lock | `Lock`, `LockOpen` |
| Quality warning | `TriangleAlert` |

---

## Layout: dashboard shell

Port `dashboard-layout.tsx` with improvements:

| Area | Behavior |
| --- | --- |
| Sidebar | Collapsible; persist in localStorage (existing key) |
| Mobile | Drawer overlay; `MobileBanner` keep for unsupported features |
| Main | `min-w-0` for table overflow |
| Update banner | `AdminUpdateBanner` non-blocking top |
| Notification badge | Sidebar icon only; poll 60s |

**Electron:** same shell; title bar drag region if frameless later.

---

## Content guidelines (Vietnamese)

| Pattern | Example |
| --- | --- |
| Action verbs | “Scrape shop”, “Nhập danh mục”, “Hủy job” |
| Confirm destructive | “Bạn có chắc muốn xóa 12 vật tư đã chọn?” |
| Progress | “Đang đọc trang 8 của 25…” |
| Error | State problem + action: “Không kết nối được shop. Kiểm tra URL và thử lại.” |
| Technical terms | Keep JSON-LD, DOM in parentheses with plain explanation |

---

## Storybook (optional)

```
packages/ui/
  .storybook/
  src/**/*.stories.tsx
```

Stories for: Button, Badge, JobProgressCard, DataTable, LockedField, EmptyState.

Run in CI: build storybook static + optional chromatic.

---

## File structure

```
packages/ui/
├── package.json
├── src/
│   ├── index.ts              # public exports
│   ├── styles/
│   │   ├── tokens.css
│   │   └── globals.css       # panel, chip, section-title
│   ├── components/
│   │   ├── button.tsx
│   │   ├── job-progress-card.tsx
│   │   └── ...
│   └── hooks/
│       └── use-media-query.ts
└── tsconfig.json
```

`apps/web` imports `@bidtool/ui/styles.css` once in `main.tsx`.

---

## Brand assets

Keep `src/app/_components/brand/logo.tsx` → `packages/ui/src/brand/logo.tsx`.

Favicon/desktop icons unchanged.
