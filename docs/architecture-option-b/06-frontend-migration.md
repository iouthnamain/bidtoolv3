# 06 — Frontend migration

## Overview

Replace Next.js App Router with **Vite + React SPA + TanStack Router**. UI code migrates from `src/app/_components` into feature folders; routing maps 1:1 from current dashboard pages.

---

## Stack

| Piece | Library |
| --- | --- |
| Bundler | Vite 6 |
| Routing | TanStack Router (file-based routes) |
| Data fetching | TanStack Query 5 |
| Tables | TanStack Table + **Virtual** (`@tanstack/react-virtual`) |
| Styling | Tailwind CSS 4 (unchanged) |
| Icons | lucide-react (unchanged import style) |
| Forms | Native + Zod (from contracts) |

---

## Route map

| Current Next route | TanStack route | Feature module |
| --- | --- | --- |
| `/dashboard` | `/dashboard` | `features/dashboard` |
| `/search` | `/search` | `features/search` |
| `/package-details/$id` | `/package-details/$id` | `features/tenders` |
| `/plan-details/$id` | `/plan-details/$id` | `features/tenders` |
| `/project-details/$id` | `/project-details/$id` | `features/tenders` |
| `/materials` | `/materials` | `features/materials` |
| `/materials/$id` | `/materials/$id` | `features/materials` |
| `/materials/import` | `/materials/import` | `features/materials` |
| `/materials/scrape` | `/materials/scrape` | `features/scrape` |
| `/catalog-pdfs` | `/catalog-pdfs` | `features/catalog` |
| `/workflows` | `/workflows` | `features/workflows` |
| `/workflows/$id` | `/workflows/$id` | `features/workflows` |
| `/notifications` | `/notifications` | `features/notifications` |
| `/saved-items` | `/saved-items` | `features/saved-items` |
| `/settings` | `/settings` | `features/settings` |
| `/desktop` | `/desktop` | `features/desktop` |
| `/help` | `/help` | `features/help` (static MDX or large static component) |
| `/` | `/` | redirect → `/dashboard` |

---

## App shell

Port `dashboard-layout.tsx` → `apps/web/src/routes/__root.tsx` + `layouts/DashboardLayout.tsx`.

### Global polls (tune)

| Poll | Current | Target |
| --- | --- | --- |
| Notifications unread | 30s | 60s; refetch on focus |
| Scrape job | 1.5s | **SSE**; poll fallback 5s |
| Version/update | 5 min | 5 min (unchanged) |

### Sidebar / nav

Keep `page-section-nav.tsx` logic; no RSC — all client. Prefetch route chunks on hover via TanStack Router `preload`.

---

## Code splitting strategy

### Lazy routes (required)

```ts
// apps/web/src/routes/materials/scrape.tsx
const ScrapePage = lazy(() => import("../../features/scrape/ScrapePage"))
```

| Chunk | Source (current lines) | Priority |
| --- | --- | --- |
| `scrape` | scrape-client ~2908 | P0 |
| `materials-list` | list-client ~2388 | P0 |
| `search` | search-page-client ~1941 | P0 |
| `material-detail` | detail-client ~1636 | P1 |
| `help` | help page ~1084 | P2 (lazy) |

### Feature folder structure

```
features/scrape/
├── ScrapePage.tsx          # thin route wrapper
├── ScrapeJobForm.tsx
├── ScrapeJobProgress.tsx   # SSE consumer
├── ScrapeProductTable.tsx  # virtualized
├── hooks/
│   ├── useScrapeJob.ts
│   └── useScrapeEvents.ts
└── api.ts                  # fetch wrappers
```

Break monolithic files **during port**, not after.

---

## API client layer

Replace tRPC:

```ts
// apps/web/src/lib/api/client.ts
const base = import.meta.env.VITE_API_BASE_URL

export async function api<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  })
  if (!res.ok) throw await parseProblem(res)
  return res.json() as Promise<T>
}
```

TanStack Query keys:

```ts
export const materialKeys = {
  all: ["materials"] as const,
  list: (params: MaterialListParams) => [...materialKeys.all, "list", params] as const,
  detail: (id: string) => [...materialKeys.all, id] as const,
}
```

Optional: generate client from OpenAPI (`openapi-typescript`).

---

## Scrape UI rewrite (performance-critical)

### Current issues

- Polls full job with all products
- Re-renders entire 2900-line tree

### Target

1. `useScrapeJobStatus(id)` — lightweight poll or SSE for counts
2. `useScrapeProducts(id, page)` — paginated table query
3. `ScrapeProductTable` — virtual rows; append on SSE `product` event optional
4. Local storage: keep `SHOP_SCRAPE_FOCUSED_JOB_STORAGE_KEY` behavior

---

## Materials list

- Server pagination only (`page`, `pageSize`, `q`, `sort`)
- Virtual scroll for current page (50–100 rows)
- Column for `hasCatalogPdf` (from note.md product gap)
- Export triggers async job; download link when ready

---

## Search page

- Keep `placeholderData` pattern for pagination
- Debounce filter changes 300ms
- Move `PROVINCE_OPTIONS` to `packages/contracts` or static JSON import (not in main chunk if huge)

---

## SEO & metadata

Not critical for authenticated dashboard. For landing/help:

- Static `index.html` title/description
- `help` route can ship pre-rendered HTML snippet in Vite plugin if needed

Drop `opengraph-image.tsx` unless public marketing site returns.

---

## Styling migration

1. Copy `globals.css` to `apps/web/src/index.css`
2. Keep Tailwind v4 postcss config
3. Port `app/_components/ui/*` → `packages/ui` or `apps/web/src/components/ui`

---

## Electron integration

| Mode | Web URL |
| --- | --- |
| Desktop bundled | `http://127.0.0.1:${WEB_PORT}` (Caddy or static server) |
| Desktop remote | User-configured server URL (existing IPC) |

`VITE_API_BASE_URL` set at build time for bundled; runtime config via `window.__BIDTOOL_API__` injection for flexibility.

---

## Testing

| Type | Location |
| --- | --- |
| Unit | Vitest for hooks/utils |
| Component | Vitest + Testing Library |
| E2E | Playwright against `web:5173` + `api:3001` |

Update `tests/e2e/materials.spec.ts` base URL config.

---

## Porting order

1. Shell + dashboard KPI (read-only)
2. Materials list + detail
3. Scrape flow (SSE)
4. Search + tender details
5. Workflows, notifications, saved items
6. Settings, desktop, catalog PDFs
7. Help (last — low risk)

Each step: feature parity checklist vs Next app before merge.

---

## Deletions after cutover

- `src/trpc/*`
- `src/app/api/trpc/[trpc]/route.ts`
- Next `page.tsx` / `layout.tsx` files
- `next.config.js`, `scripts/build-next.ts` (replace with turbo build)
- `@trpc/*` dependencies
- `superjson` (unless needed for dates in client-only storage)

Keep `superjson`-free ISO date strings in API contract for simplicity.
