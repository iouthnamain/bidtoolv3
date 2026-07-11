# Material profile browser QA — 2026-07-12

## Scope

- Primary page: `http://localhost:3000/material-profiles/16`
- Stack under test: Next.js dev server, PostgreSQL, tRPC, Chromium
- User-visible language: Vietnamese
- Risk boundary: mutating regression tests used temporary E2E workspaces that are deleted after each test. The recorded source-selection walkthrough temporarily selected rows 3–5 on workspace 16, then restored all three rows to their original unselected state.

## Outcome

The reported row-selection regression is fixed. Choosing a source for a different material no longer jumps the review panel back to the first/deep-linked row after `materialProfile.get` refreshes.

Two related performance issues were also corrected:

1. `getActiveScrapeJob` no longer polls every second while the endpoint returns no active job.
2. Scrape-run polling stops when no run is queued or running.

### Follow-up: unrelated web result shown as 100%

Row 7 (`Tủ điện treo tường 600x400x200mm`) exposed a second score-boundary bug. The review UI used `WebLinkResult.rankScore` as if it were a normalized material-match confidence. That value is a retrieval/ranking score and can legitimately exceed `1`, so the percentage formatter clamped unrelated refrigerator/furniture results to `100%` and `markTopRecommended` labelled the first one as the best suggestion.

The UI now always displays the independent `assessWebLinkCandidate` score. The reported stored candidates assess at only 23–41%, so none receives `Gợi ý tốt nhất`. Server ranking also preserves the provider's base score across the pre-fetch and post-fetch ranking passes instead of adding the same BidTool boosts twice.

The incorrect row-7 source decision was cleared after verification. Existing weak search links remain available for transparent manual review, but they are no longer presented as reliable matches.

## Root cause

`MaterialProfileReviewStep` used one effect for two unrelated jobs:

1. replace local decisions when refreshed server data arrives;
2. apply the initial `?row=` deep link and select a row.

Every decision save invalidates `materialProfile.get`. The refreshed `items` array reran that effect, reapplied the original `?row=`, and moved the UI back to the first linked row even though the alternate decision had saved successfully.

## Fix design

In `src/app/_components/material-profiles/material-profile-review-step.tsx`:

- decision hydration remains keyed to `reviewItems`;
- row selection is now a separate effect keyed only to workspace ID and the stable list of row indices;
- the URL deep link is applied only when entering a different workspace;
- an existing selected row is preserved while it remains present;
- the first row is used only when the current row disappears.

In `match-chooser.tsx` and `review-panel.tsx`, background scrape polling now returns `false` when there is no active work.

## Reproduction used by the regression test

1. Seed a workspace with rows 2 and 3.
2. Open `/material-profiles/<id>?row=2`.
3. Select row 3.
4. Select the second web/PDF source for row 3.
5. Wait for `updateItemReviewDecision` and the subsequent `materialProfile.get` refresh.
6. Confirm row 3 still has `aria-pressed="true"`.

Before the fix, step 6 received `aria-pressed="false"`. After the fix it stays `true`.

## Browser coverage

| Area                     | Result                    | Evidence                                                                                                     |
| ------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Four-step navigation     | Pass                      | Upload, mapping, review, clean export reached through user-facing buttons                                    |
| Upload control           | Pass (UI contract)        | File input accepts `.xlsx`; destructive replacement of workspace 16 was intentionally not performed          |
| Mapping                  | Pass                      | Sheet and header controls load; `updateState` saves successfully in temporary workspace                      |
| Review layout            | Pass                      | Desktop 1280×800 and stacked 760×900 layouts; no horizontal overflow                                         |
| Action controls          | Pass                      | Search, scrape, AI and save variants render with ≥44 px height                                               |
| Alternate source choice  | Pass                      | Selection persists after save, query refresh and reload                                                      |
| Different-row selection  | Pass                      | Deep-linked first row no longer steals selection after refresh                                               |
| PDF source               | Pass                      | Attaches PDF evidence without starting AI or HTML scrape                                                     |
| Scraped product picker   | Pass                      | Reopens an awaiting-review run and applies product B rather than product A                                   |
| Bulk save preview        | Pass                      | Include/exclude row, explicit commit and undo verified                                                       |
| Clean export preview     | Pass                      | Preview endpoint refreshes and export action state renders                                                   |
| Actual browser file save | Not automated             | Native directory/download picker requires an attached interactive preview and would write a user file        |
| Live web/AI jobs         | Not rerun on workspace 16 | Existing saved job results were inspected; external searches can change data and consume configured services |

## Runtime and performance observations

Development-mode measurements for workspace 16:

| Metric                        |                       Observed |
| ----------------------------- | -----------------------------: |
| `materialProfile.get` payload |                  392,955 bytes |
| `materialProfile.get` request |                        0.383 s |
| Navigation TTFB               |                       253.4 ms |
| DOM content loaded            |                       349.5 ms |
| Load event                    |                       572.5 ms |
| Initial transferred resources | 1,102,830 bytes / 42 resources |
| Initial DOM nodes             |                            441 |

These are local dev-server numbers, not production Lighthouse scores. The shared preview did not report FCP. Native recording became available after reopening the collaborative Preview pane with `visible:true`.

The material-profile page previously generated continuous idle traffic from duplicate one-second scrape queries. After the patch, polling is conditional on active job/run data. When starting or retrying a job, the existing mutations explicitly refetch the active-job query, so progress polling still starts normally.

## Accessibility and UX checks

- Role/name locators can operate all tested primary controls.
- Candidate and row selectors expose `aria-pressed`.
- Progress UI has labelled progressbar semantics.
- Dynamic progress/status regions use live-region semantics in the reviewed flow.
- Action targets met the BidTool 44 px mobile target in the browser assertion.
- The responsive test found no document-level horizontal overflow.
- The step progress animation now transitions `width` only and honors reduced motion.

No axe or full screen-reader session was run in this pass. Use the source review plus the existing semantic-locator tests as the regression baseline, not as a WCAG conformance certificate.

## Commands and observed results

```text
bun run dev:run
  PASS — PostgreSQL/SearXNG started, migrations applied, Next.js ready on :3000

bunx vitest run <5 focused material-profile files>
  PASS — 5 files, 23 tests

bunx playwright test tests/e2e/material-profile.spec.ts --project=chromium
  PASS — 7 tests in 57.9 s (initial verification)
  PASS — 7 tests in 39.4 s (final re-test before handoff)
  PASS — 7 tests in 44.4 s (follow-up web-score fix)

bunx vitest run src/lib/materials/search-candidate-match.test.ts src/server/services/material-web-search.test.ts
  PASS — 2 files, 32 tests

bun run typecheck
  PASS

bunx eslint <changed review files and material-profile E2E spec>
  PASS
```

## Agent checklist for future changes

1. Keep server-decision hydration separate from view selection/deep-link initialization.
2. Do not depend a row-selection effect on the full `items`, `reviewItems`, or `reviewRows` object when only row identity matters.
3. When testing this bug, wait for both the save mutation and the subsequent `materialProfile.get` refresh; an assertion immediately after click can produce a false pass.
4. Keep the two regression cases:
   - alternate source survives refresh/reload;
   - alternate row survives refresh when the URL deep-links another row.
5. Poll only while a job/run is active. Mutations that create jobs must explicitly refetch the active-job query.
6. Keep retrieval rank (`rankScore`) separate from normalized material-match confidence. Percentages and recommendation badges must use `assessWebLinkCandidate`/`assessAiCandidate`.
7. Preserve the provider/base rank when results are ranked more than once; ranking boosts must be idempotent.
8. Use semantic role/name locators and web-first assertions; do not add fixed sleeps.
9. Run the focused Vitest files first, then the single material-profile E2E spec, then typecheck/lint.

## Walkthrough recordings

The final videos were captured with the native T3 collaborative Preview recorder at a desktop viewport and visually checked from extracted midpoint frames:

1. [`01-upload-workbook.mp4`](material-profile-walkthroughs/01-upload-workbook.mp4) — open the upload stage, identify the workbook drop zone, and read the readiness checklist.
2. [`02-map-and-check-workbook.mp4`](material-profile-walkthroughs/02-map-and-check-workbook.mp4) — review the required mappings, workbook grid, save action, and check/continue actions.
3. [`03-review-source-relevance.mp4`](material-profile-walkthroughs/03-review-source-relevance.mp4) — review row 7's weak web candidates with honest 23–41% match scores and no false best-suggestion badge.
4. [`04-bulk-actions.mp4`](material-profile-walkthroughs/04-bulk-actions.mp4) — select review rows, expose web search/scrape/AI batch actions, and clear the selection safely.
5. [`05-clean-export-preview.mp4`](material-profile-walkthroughs/05-clean-export-preview.mp4) — refresh export readiness, explain blocked rows, and inspect the exact clean-file preview.

The videos demonstrate controls without launching new live web/AI jobs, writing an export file, or leaving test decisions on workspace 16. The isolated E2E suite covers PDF attachment, scrape-product choice, explicit bulk commit, and undo behavior.
