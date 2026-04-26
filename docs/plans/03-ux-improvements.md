# Plan 03 - UX/UI Improvements (Quick Wins + Top 5)

Audit phát hiện 37 issue trên 8 dimension (consistency, hierarchy, interaction states, a11y, responsive, IA, localization, code smells). Plan này giải quyết quick wins và top 5 high-impact issues trong ~1 tuần.

## Scope đã chốt

| Vấn đề | Quyết định |
|--------|-----------|
| Mobile responsive | Defer — giữ horizontal scroll, thêm banner thông báo cho viewport < 1024px |
| UI library | Extract `_components/ui/`: Button + Badge + FilterField + EmptyState |
| search-page-client tear-down | Defer — 1,440 LOC, riêng 1 sprint refactor |

## Phase 1 — UI Component Library

Tạo `src/app/_components/ui/`:

- **button.tsx** — `<Button variant="primary|secondary|ghost|danger" size="sm|md" isLoading?>` với focus-visible ring và transition mặc định.
- **badge.tsx** — `<Badge tone="neutral|success|warning|critical|info" count?>`.
- **filter-field.tsx** — `<FilterField label helper? error? htmlFor?>` — wrapper cho input/select với label consistent.
- **empty-state.tsx** — `<EmptyState icon? title description? cta?>` — dashed border, centered layout.
- **index.ts** — re-export.

## Phase 2 — Quick Wins

1. **Dịch tiếng Việt** — insights/page.tsx, kpi-card.tsx, workflow-card.tsx: "Up/Down" → "Tăng/Giảm", "Active/Paused" → "Hoạt động/Tạm dừng", "Run now" → "Chạy ngay".
2. **Bỏ `text-[10px]`** — replace toàn bộ → `text-xs` (12px).
3. **Pagination feedback** — `disabled:opacity-50` → `disabled:opacity-60`, thêm hover state.
4. **Table row transition** — `transition-colors duration-150`.
5. **Gradient button cleanup** — bỏ gradient trên action buttons, dùng flat `bg-sky-700`.

## Phase 3 — Top 5 High-Impact

### 3.1 Button migration
Replace mọi inline button className bằng `<Button variant=… size=…>` trong: search-page-client, saved-items-page-client, workflows-page-client, workflow-card, package-details-page-client, dashboard/page.

### 3.2 FilterField wrappers trong search
Thêm `<FilterField label>` cho mọi filter input/select trong search-page-client: keyword, tỉnh/thành, lĩnh vực, điểm match, ngân sách từ/đến, sắp xếp, thứ tự, số dòng/trang.

### 3.3 Focus ring everywhere
`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2` trên mọi input, select, và MultiSelectDropdown trigger.

### 3.4 Dashboard home revitalize
- Quick shortcuts row (3 card link): Tạo bộ lọc mới → `/search`, Bộ lọc đã lưu → `/saved-items`, Tạo workflow → `/workflows`.
- Alerts trống: dùng `<EmptyState icon=bell title="Chưa có cảnh báo nào" cta={Link Tạo bộ lọc}>`.

### 3.5 Mobile banner
`src/app/_components/dashboard/mobile-banner.tsx` — hiển thị `block md:hidden`, dismissable, lưu vào `localStorage("bidtool:mobile-banner-dismissed")`. Mount trong DashboardLayout.

## Phase 4 — Verify

- `bun run check` (lint + typecheck) xanh.
- Grep tiếng Anh sót trong `_components/dashboard/`.
- Grep `bg-gradient-to-r` trong action buttons — 0 matches.
- Tab xuyên search page — mọi element có focus ring.
- Mobile ≤ 768px: banner xuất hiện 1 lần, dismiss vĩnh viễn.
- Dashboard home: 3 shortcut card và EmptyState alert.

## Files mới

- `src/app/_components/ui/button.tsx`
- `src/app/_components/ui/badge.tsx`
- `src/app/_components/ui/filter-field.tsx`
- `src/app/_components/ui/empty-state.tsx`
- `src/app/_components/ui/index.ts`
- `src/app/_components/dashboard/mobile-banner.tsx`

## Files thay đổi

- `src/app/(dashboard)/insights/page.tsx`
- `src/app/(dashboard)/dashboard/page.tsx`
- `src/app/_components/dashboard/kpi-card.tsx`
- `src/app/_components/dashboard/workflow-card.tsx`
- `src/app/_components/dashboard/search-page-client.tsx`
- `src/app/_components/dashboard/saved-items-page-client.tsx`
- `src/app/_components/dashboard/workflows-page-client.tsx`
- `src/app/_components/dashboard/package-details-page-client.tsx`
- `src/app/_components/dashboard/alert-card.tsx`
- `src/app/_components/dashboard/dashboard-shell.tsx`
- `src/app/_components/dashboard/dashboard-layout.tsx`

## Out of scope (defer)

- Mobile responsive table redesign.
- Tear-down search-page-client (1,440 LOC) → sub-components.
- shadcn/ui / Radix UI.
- Component tests / Storybook.
- Color contrast audit sâu hơn focus ring.
- 27 issue audit còn lại (backlog sprint sau).
