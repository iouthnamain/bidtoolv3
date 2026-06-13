# 13 — Accessibility & responsive

## Standards target

**WCAG 2.1 Level AA** for all primary task flows:

- Materials catalog (list, detail, import)
- Scrape shop (configure, monitor, review, import)
- Search and save
- Settings and desktop update

Help and static docs: Level A minimum.

---

## Accessibility checklist

### Keyboard

| Requirement | Implementation |
| --- | --- |
| Full nav without mouse | Sidebar links, skip link, focus order |
| Dialogs trap focus | `ConfirmDialog`, row drawer |
| Escape closes | Dialogs, drawers, mobile nav |
| Table | Arrow keys optional v2; Tab through actionable cells |
| Scrape cancel | Focusable, confirm with Enter |

### Screen readers

| Requirement | Implementation |
| --- | --- |
| `lang="vi"` on `<html>` | Keep |
| Page title per route | TanStack Router `meta` |
| Live regions | `aria-live="polite"` on job progress counts |
| Progress bars | `role="progressbar"` + `aria-valuenow/max` |
| Status badges | Text label, not color alone |
| Icons | `aria-hidden` on decorative; `aria-label` on icon-only buttons |
| Toasts | `role="status"` |

### Visual

| Requirement | Implementation |
| --- | --- |
| Focus visible | `focus-visible:ring-2` (existing Button pattern) |
| Contrast | 4.5:1 body text; 3:1 large text |
| Color + text | Job status always has Vietnamese label |
| Touch targets | min 44×44px mobile (existing button min-h) |
| `prefers-reduced-motion` | Disable toast slide, progress animation |

### Forms

| Requirement | Implementation |
| --- | --- |
| Labels | Every input has visible `<label>` or `aria-label` |
| Errors | `aria-invalid` + `aria-describedby` to error text |
| Required | `aria-required` or visual asterisk + legend |

---

## Testing

| Tool | When |
| --- | --- |
| axe-core in Playwright | E2E on materials + scrape smoke |
| Manual keyboard pass | Each release candidate |
| VoiceOver (macOS) or NVDA | Scrape flow once per major version |

CI gate (Phase UX-4): fail E2E if critical a11y violations on `/materials` and `/materials/scrape`.

---

## Responsive breakpoints

Use Tailwind defaults:

| Breakpoint | Width | Layout |
| --- | --- | --- |
| `sm` | 640px | Stack → limited 2-col |
| `md` | 768px | Filters wrap |
| `lg` | 1024px | Sidebar visible |
| `xl` | 1280px | Two-column scrape review |
| `2xl` | 1536px | Wider table columns |

### Mobile (`< lg`)

- Sidebar → hamburger drawer
- Tables → horizontal scroll with `overflow-x-auto`; sticky first column (name) optional
- Bulk action bar → full width bottom fixed
- Scrape stepper → vertical compact dots

### Tablet

- Sidebar collapsible default open
- Materials table most columns visible with picker

### Desktop / Electron

- Primary target: **1280×800** minimum
- Comfortable: **1440×900**
- Maximize data density with column picker, not smaller fonts

---

## Electron-specific UX

| Topic | Spec |
| --- | --- |
| Window minimum size | 1024×700 |
| External links | `shell.openExternal` (existing) |
| File downloads | Native save dialog where applicable |
| Service status | Settings shows api/worker health |
| Offline | Banner when API unreachable; queue actions disabled with explanation |

---

## Print

Low priority. Materials export via CSV/XLSX, not print stylesheet v1.

---

## Internationalization

v1: Vietnamese only.

Prepare:

- Copy in constants files per feature (`labels.ts`)
- Avoid concatenated Vietnamese strings with variables in wrong order
- Date/number: `vi-VN` locale (`formatDate`, `formatMoney` existing)

Future EN: extract labels to `packages/i18n` — not in Option B scope.

---

## Performance × accessibility

| Pattern | Benefit |
| --- | --- |
| Virtualized tables | Faster paint; use `aria-rowcount` |
| SSE vs poll | Less CPU; fewer confusing re-renders for screen reader users |
| Skeleton loading | Prefer over spinner-only (announces content loading) |

---

## Known gaps (address in UX migration)

| Gap | Fix phase |
| --- | --- |
| Large scrape table DOM | Virtual scroll UX-2 |
| Icon-only row actions without labels | UX-2 |
| Help page heading hierarchy | UX-3 |
| Search filter complexity on mobile | UX-3 drawer |
