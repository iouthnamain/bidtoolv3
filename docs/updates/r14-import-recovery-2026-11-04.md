# R14 import recovery evidence

Branch: `fix/idempotent-import-recovery`
Host: `lab-1`
Base: `origin/main` at `6e86e669a639bbb6084bdb5da02e1a09892e0668`

## Durable outcomes

The importer registers pending product identities before its first material
transaction. Each product's material write, catalog PDF records and links, and
successful ledger outcome commit together. The unique
`(import_job_id, product_key)` index prevents concurrent attempts from creating
another material for the same job. Separate intentional jobs retain independent
identities.

Failure bookkeeping locks the parent job, updates only `processing` or `failed`
ledger rows, and refuses cancelled jobs. It cannot downgrade `created`,
`updated`, or `skipped` after a delayed failure or a lost COMMIT
acknowledgement. Progress callbacks run outside that failure handler.
The importer loads one durable ledger snapshot, then updates its counters and
item view from each product's actual winning row. Progress callbacks do not
reread the whole ledger or copy every item per product. The scheduler reconciles
from PostgreSQL at its existing two-second flush, recovery, cancellation, and
final boundaries; the importer also reads a final snapshot. Repeated source
identities are deduplicated before processing.

Product transactions lock the import job before its ledger row and material.
Cancellation, progress reconciliation, and startup recovery use that same parent
lock. Recovery and cancellation preserve durable counts and item IDs, including
outcomes committed before the last progress flush. Terminal scheduler status
and its reconciled totals commit under that same lock. Completion requires
every registered product to have a durable outcome.

A legacy interrupted job without ledger evidence fails visibly with a Vietnamese
message. Recovery preserves its partial counters and items and never requeues it.

## Catalog document race follow-up

Concurrent import jobs may discover the same catalog PDF URL at the same time.
`getOrCreateCatalogDocumentByUrl` now treats its initial lookup as a fast path,
uses PostgreSQL `ON CONFLICT DO NOTHING` for the insert, and rereads the winning
document when another transaction commits first. The duplicate-key error no
longer rolls back a valid material and ledger transaction.

The R14 integration suite adds a two-backend PostgreSQL case with two different
jobs and materials sharing one PDF URL. It requires both imports to finish with
`created` ledger outcomes, two materials, two links, and exactly one document.

For this follow-up, `bun run check`, the focused importer/scheduler unit suite,
Prettier on the changed test and evidence files, and `git diff --check` pass on
lab-1. The PostgreSQL integration case is included for hosted validation; lab-1
still has no disposable PostgreSQL or Docker, so `BIDTOOL_TEST_DATABASE_URL` is
the exact local startup blocker.

## Accepted baseline

The coordinator accepted the exact-head hosted PostgreSQL run for
`e52d44a7d8f6d39f7d1c38981d37c1aa1f295810` as valid evidence:
[run 41780785771, job 126411598076](https://github.com/iouthnamain/bidtoolv3/actions/runs/41780785771/job/126411598076).
That run used PostgreSQL 16.15, applied the migration, and passed 4 integration
files with 17 tests. It validates the earlier acceptance subset. It predates the
additional faults and concurrent retry tests below.

## Additional fault coverage

`tests/integration/shop-import-r14.test.ts` now has 12 cases. Each test copies
migrated table definitions and indexes into its own disposable schema and sets
both PostgreSQL connections to that schema. Triggers, rows, and cleanup stay
inside that schema. The normal CI integration job still migrates the public
schema through `bun run db:migrate` first.

| Case                                       | Injected boundary and required observation                                                                                                                                                                                                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Failure before material commit             | A PostgreSQL `BEFORE INSERT` trigger raises an exception on the material. No material or document write survives. Remove the trigger and restart twice.                                                                                                                                                                              |
| Failure during document writes             | A PostgreSQL trigger fails the document link after the material and document inserts. All related writes roll back. Remove the trigger and restart twice.                                                                                                                                                                            |
| Commit before progress flush               | The progress callback throws immediately after the first durable material and ledger success. Parent counters remain zero. Restart twice and count exactly one material per product.                                                                                                                                                 |
| Delayed concurrent failure, three statuses | One connection rolls back a product transaction and holds its exception. The second commits `created`, `updated`, or `skipped`. Releasing the first exception must preserve that winning row, progress, material count, and revision across two restarts.                                                                            |
| Lost COMMIT acknowledgement                | The real transaction commits, then the database-call wrapper throws. Failure bookkeeping must preserve success across two restarts.                                                                                                                                                                                                  |
| Concurrent retries                         | Two distinct PostgreSQL backends meet at a barrier before product transactions. Both return one created outcome, with one material and one ledger row.                                                                                                                                                                               |
| Bounded progress reads                     | Twelve unique products plus a repeated source produce exactly two full-ledger reads (initial and final), one material per identity, and correct incremental counts/items at each callback. The SQL logger observes the real database calls.                                                                                          |
| Cancellation during resume                 | Initial progress includes a previously committed product later in source order. One resumed product commits; a SQL logger then aborts during the next product's real document-link insert. That product rolls back. Cancellation and a stale scheduler run preserve both prior successes, items, and total without another material. |
| Separate intentional jobs                  | Two jobs each create their own material for the same source product.                                                                                                                                                                                                                                                                 |
| Legacy interrupted job                     | Two recovery attempts leave the job failed with its Vietnamese message and prior partial evidence.                                                                                                                                                                                                                                   |

The trigger tests use a sequence to prove the fault actually fired; sequence
advancement survives the transaction rollback. Transaction wrappers execute real
PostgreSQL commits or rollbacks before delaying or throwing their results.
These are database-boundary failure simulations, not an OS process-kill test.

## Current validation

- `bun run check` — passed on lab-1 after the scoped implementation changes.
- `bunx vitest run src/server/services/shop-product-importer.test.ts src/server/services/shop-import-jobs.test.ts src/server/services/job-scheduler.test.ts src/server/services/job-scheduler.concurrency.test.ts src/server/services/job-scheduler.failure.test.ts` — passed, 5 files and 13 tests.
- Changed TypeScript files pass Prettier and `git diff --check`.
- Hosted run `42010229208`, PostgreSQL job `127187071732`, exposed one R14
  regression: the skipped replay's sanitized source list was empty on restart,
  so the importer raised "Không có sản phẩm scrape để nhập" and the scheduler
  recorded `failed` despite a complete skipped ledger row. The fix returns the
  durable terminal result for this case and still rejects incomplete empty
  sources. The other 11 R14 cases passed in that run.
- Exact-head follow-up `4270c3b1121a292a517bc9f792ce1912a62e3977` passed the
  isolated PostgreSQL integration: [run 42052403569, job
  127331688175](https://github.com/iouthnamain/bidtoolv3/actions/runs/42052403569/job/127331688175).
  This validates all 12 R14 integration cases at that code head.
- The local R14 integration command refuses startup because
  `BIDTOOL_TEST_DATABASE_URL` is unset. No disposable PostgreSQL binaries or Docker
  are available. The next hosted `Isolated PostgreSQL integration` job must
  validate the docs-only follow-up head after this evidence update. PR #33
  stays draft until its exact-head checks and review are complete.

## Migration and rollback

The original additive `0042_sudden_prima.sql`, snapshot, and unique index remain
unchanged in this follow-up. Retain the ledger table and constraints on code
rollback. Disable automatic import recovery before running older importer code.
Do not delete imported materials to roll back the code.
