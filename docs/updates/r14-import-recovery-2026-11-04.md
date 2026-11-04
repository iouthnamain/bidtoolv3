# R14 import recovery evidence

Branch: `fix/idempotent-import-recovery`
Host: `lab-1`
Base: `origin/main` at `6e86e669a639bbb6084bdb5da02e1a09892e0668`

The import path now records one durable `shop_import_items` row per
`(import_job_id, product_key)`. Material creation or update, catalog PDF
linking, and the terminal ledger result share one database transaction. A
retry skips terminal ledger rows, retries failed rows, and derives counters and
items from the ledger before completion. The product key is scoped to the
import job, so a separate intentional import can create its own material.

Startup recovery requeues only interrupted jobs with ledger evidence. A legacy
running job with no ledger row is failed with a Vietnamese recovery message;
it is not replayed automatically because its prior writes cannot be identified
safely. Cancellation aborts the runner before the next product and leaves
committed ledger outcomes available to the next recovery attempt.

## Checks

- `bun run typecheck` — passed.
- `bun run db:generate` — passed; reviewed `drizzle/0042_sudden_prima.sql`.
- `bunx vitest run src/server/services/shop-product-importer.test.ts src/server/services/shop-import-jobs.test.ts src/server/services/catalog-pdf-storage.test.ts` — passed (19 tests).
- `bun run check` — passed.
- Local PostgreSQL migration/runtime evidence was unavailable on `lab-1`
  because `DATABASE_URL` and `BIDTOOL_TEST_DATABASE_URL` are unset and Docker
  is not installed. The GitHub Actions isolated PostgreSQL integration for
  commit `c3fd694` passed on PR #33, including the R14 integration file.
