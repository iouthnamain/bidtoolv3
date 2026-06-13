# 12 — Screen specifications

Screen-by-screen UX requirements for the Option B frontend port. Each section lists **layout**, **key components**, **states**, and **acceptance criteria**.

---

## Global shell

### Dashboard layout

| Item | Spec |
| --- | --- |
| Breakpoints | `< 1024` mobile drawer; `≥ 1024` sidebar |
| Nav active state | Left border `brand-1` + bold label |
| Skip link | “Bỏ qua đến nội dung chính” (first focusable) |
| Page max width | None for tables; form pages `max-w-3xl` centered optional |

**Acceptance:** Sidebar collapse persists; keyboard can reach all nav items.

---

## Dashboard (`/dashboard`)

| Zone | Content |
| --- | --- |
| KPI row | 4 cards: vật tư, thiếu giá, job scrape đang chạy, thông báo chưa đọc |
| Recent | Last 5 scrape/import jobs with status badge |
| Quick actions | Tìm kiếm, Scrape shop, Thêm vật tư |

**Acceptance:** Loads without full workflow run history (cap data server-side).

---

## Materials catalog (`/materials`)

### Summary strip (top)

| Chip | Data |
| --- | --- |
| Tổng | count |
| Có giá | count + % |
| Thiếu giá | count, link filter |
| Có catalog PDF | **new** count + filter |
| Có nguồn giá | count |

### Table columns (default visible)

| Column | Notes |
| --- | --- |
| Chọn | Checkbox |
| Tên | Link to detail |
| Nhóm / category | |
| Giá | Formatted VND + status dot |
| **Catalog** | **new** `FileText` icon if `catalogPdfUrls.length > 0`; tooltip URLs |
| NCC | manufacturer |
| Cập nhật | relative date |
| Hành động | row menu |

Hidden by default (column picker): Mã, Thông số, Chi tiết, Cập nhật đầy đủ.

### Filters

- Search debounced 300ms
- Price status, source status, manufacturer, category (existing)
- **new:** “Có catalog PDF” / “Thiếu catalog PDF”

### Bulk actions

Sticky `BulkActionBar` when selection > 0: xóa, xuất, (future) khóa trường.

**Acceptance:**

- [ ] Catalog column visible by default
- [ ] Filter catalog works
- [ ] Virtual scroll for 50+ rows without jank
- [ ] Column visibility persists localStorage

---

## Material detail (`/materials/:id`)

### Sections

1. Header: name + edit + delete
2. Core fields grid (2 col desktop)
3. **Khóa trường** panel: toggles per field group (tên, giá, NCC, thông số…)
4. Price sources table
5. Catalog PDF section (existing `catalog-pdf-section.tsx`)
6. Metadata / lịch sử (collapsed)

### Locked field behavior

| State | UI |
| --- | --- |
| Locked | `LockedField`, no inline edit |
| Unlock | Confirm “Mở khóa cho phép scrape/import ghi đè” |
| Import respects lock | Badge on locked groups “Được bảo vệ khi nhập” |

**Acceptance:** User can see at a glance which fields are protected.

---

## Scrape shop (`/materials/scrape`)

Split monolithic UI into **4 steps** (Stepper at top; user can jump back if job completed).

### Step 1 — Cấu hình

| Field | UI |
| --- | --- |
| URL shop | Large input + validate button |
| Chế độ | Segmented: Giới hạn / Scrape hết |
| maxPages / maxProducts | Number inputs with sliders optional |
| Phương pháp | Select + help tooltip per method |
| Bổ sung chi tiết | Checkbox; warning “Chậm hơn ~Nx” |
| Submit | “Bắt đầu scrape” |

Recent jobs sidebar (collapsible): last 10, click to open monitor.

### Step 2 — Tiến độ (active job)

| Element | Spec |
| --- | --- |
| `JobProgressCard` | SSE-driven |
| Pages bar | Label “Trang đã đọc” + `visited / max` + queue length tooltip |
| Products bar | “Sản phẩm thu thập” + count |
| Current URLs | Monospace list, max 3 visible |
| Failed pages | Expandable list with message + “Mở URL” |
| Actions | Hủy job (confirm) |
| Connection | SSE status indicator |

**Fix page count confusion:** Show three numbers:

- **Đã đọc:** pages visited (deduped)
- **Trong hàng đợi:** queue length
- **Giới hạn:** maxPages or “∞”

### Step 3 — Kiểm tra kết quả

| Element | Spec |
| --- | --- |
| Table | Paginated + virtualized |
| Filters | Thiếu giá, thiếu tên, tên nghi vấn (promo/KH), có PDF |
| Row flags | `QualityFlag` for promo names, empty name |
| Toggle | “Hiện sản phẩm thiếu tên” default off |
| Row click | Drawer: all fields, link nguồn, raw diagnostics (dev expandable) |
| Export | CSV tải về (job snapshot) |

**Promo / KH names:** Highlight rows where name matches known badge patterns; suggest manual fix before import.

### Step 4 — Nhập danh mục

| Element | Spec |
| --- | --- |
| Import options | Existing semantics |
| Progress | Separate `JobProgressCard` for import job |
| Results table | created/updated/skipped/failed badges |
| CTA done | “Xem vật tư đã nhập” → materials with filter |

**Acceptance:**

- [ ] No full-table flash on progress (SSE + paginated fetch)
- [ ] User can complete scrape → review → import without scrolling one giant page
- [ ] Failed pages visible and understandable
- [ ] Questionable names visually flagged

---

## Materials import (`/materials/import`)

- File drop zone + format help
- Preview first 10 rows
- Column mapping (if CSV)
- Import → import job monitor (reuse `JobProgressCard`)
- Link to scrape flow if user came from shop

---

## Catalog PDFs (`/catalog-pdfs`)

- List with material link, file size, uploaded date
- Filter: chưa gán vật tư / đã gán
- Cross-link from materials catalog column

---

## Search (`/search`)

Keep power-user density; UX polish:

| Improvement | Detail |
| --- | --- |
| Sticky filter bar | On scroll |
| Result cards | Consistent tender card component |
| Save feedback | Toast + “Xem trong Watchlist” |
| Loading | `placeholderData` keep previous page visible |

**Acceptance:** No regression in filter combinations; mobile filters in drawer.

---

## Tender details (`/package-details/:id`, etc.)

- Two-column desktop: main content + sticky actions
- Cache indicator subtle (“Đã lưu cache”) if from details_cache
- Breadcrumb back to search

---

## Workflows (`/workflows`, `/workflows/:id`)

- List: card grid with last run status
- Detail: timeline of runs (paginated, not all runs at once)
- Empty: CTA tạo quy trình

---

## Notifications (`/notifications`)

- Mark read / mark all
- Group by day
- Unread count only in sidebar (not full body poll)

---

## Saved items (`/saved-items`)

- Tabs: Smart Views | Watchlist (hash routes → TanStack Router search params)
- Section nav sync with scroll

---

## Settings (`/settings`)

- Status strip (version, DB, deployment surface)
- Sections: Cập nhật, Cấu hình scrape mặc định, về ứng dụng
- Desktop-only block hidden on web

---

## Desktop (`/desktop`)

- Update UI (existing desktop-settings-page-client)
- Server URL config for remote mode
- Local service status: api ● worker ● (new)

---

## Help (`/help`)

- Long static content: table of contents sticky left
- Consider MDX split by section in Option B for smaller chunk

---

## Error pages

| Route | UI |
| --- | --- |
| 404 | EmptyState + link dashboard |
| Error boundary | “Đã xảy ra lỗi” + retry + report version |

---

## Wireframe reference (scrape flow)

```
┌──────────────────────────────────────────────────────────────────┐
│ Scrape shop                                                      │
│ [1 Cấu hình] — [2 Tiến độ] — [3 Kiểm tra] — [4 Nhập]             │
├───────────────────────────────┬──────────────────────────────────┤
│                               │ JobProgressCard (SSE)            │
│  URL + options form           │ ─────────────────────────────    │
│                               │ Filters + Product table          │
│  [Bắt đầu scrape]             │ (step 3 content when ready)    │
└───────────────────────────────┴──────────────────────────────────┘
```

Desktop wide: two columns in steps 2–3. Mobile: stacked.

---

## Component mapping (old → new)

| Current file | New structure |
| --- | --- |
| `scrape-client.tsx` | `ScrapePage` + 4 step components + hooks |
| `list-client.tsx` | `MaterialsListPage` + `MaterialsTable` + `MaterialsFilters` |
| `detail-client.tsx` | `MaterialDetailPage` + `LockedFieldGroup` |
| `search-page-client.tsx` | `SearchPage` + `SearchFilters` + `SearchResults` |
| `dashboard-layout.tsx` | `packages/ui` `AppShell` |
