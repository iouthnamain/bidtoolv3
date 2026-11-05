# Architecture remediation plan

Status: proposed implementation plan. No remediation has been implemented by this document.

Prepared on 2026-11-02 against `60a6f3eb981c268b95b1e223417b1819638b053f` (`main`). Recheck the affected files before starting each change. Finding IDs F01–F19 refer to the [architecture audit](./architecture-audit.md). This plan preserves the original IDs and prior evidence; source observations below describe defects, not implemented fixes.

## Goal and completion criteria

Make upgrades preserve documents, make external content safe to retrieve, and make concurrent jobs and edits preserve correct state. Keep Next.js, tRPC, Drizzle, PostgreSQL, Bun, and Electron.

Complete the work when all nineteen findings pass the acceptance checks below and CI exercises the failures that exposed them. Preserve the single-user product model and Vietnamese UI copy. Implementation, commits, releases, customer-host migration, and deployment are separate actions from writing this plan.

## Delivery order

Treat the following as separate reviewable changes. Use the dependency column for implementation order; package IDs remain stable. This is not a request to create PRs now.

| Change | Scope                                                | Findings                         | Dependency     | Completion evidence                                                                                |
| ------ | ---------------------------------------------------- | -------------------------------- | -------------- | -------------------------------------------------------------------------------------------------- |
| R0     | Add isolated database and failure-test fixtures      | F12; supports all fixes          | None           | Tests cannot connect to a development or customer database accidentally                            |
| R1     | Persist files and make complete backups and restores | F01, F08                         | R0             | Existing-install migration, container replacement, and clean restore preserve checksums            |
| R2     | Bound and validate public-content downloads          | F02, F03                         | R0, R1         | Private destinations, redirect bypasses, body stalls, and oversized streams are rejected           |
| R3     | Replace PDFs without deleting the good version first | F06                              | R0, R1, R2     | Disk and database failures leave the current document readable                                     |
| R4     | Enqueue enrichment work atomically                   | F05                              | R0             | Failed child insertion leaves no parent job; inconsistent jobs cannot complete successfully        |
| R5     | Serialize material changes and reject stale edits    | F04, F19                         | R0             | Concurrent refresh, manual edit, field-lock, and enrichment tests preserve unrelated changes       |
| R6     | Retry scheduler recovery and expose readiness        | F07, F09, F17, F18               | R0, R4, R14    | A startup database outage recovers without restart; readiness reflects recovery and database state |
| R7     | Report only supported update capabilities            | F10                              | None           | Packaged on-prem status offers the host command and cannot invoke the broken self-updater          |
| R8     | Run cross-system checks and document operation       | All findings; audit improvements | R1–R7, R10–R14 | Required CI and release jobs, upgrade and restore evidence, and an operator runbook                |
| R10    | Pin release checks and builds to the tag commit      | F11 (P1)                         | R0             | Dispatch from another branch still checks and builds the resolved tag SHA                          |
| R11    | Replace workbooks atomically                         | F13 (P2)                         | R0, R1         | Invalid input or failed replacement preserves jobs, rows, and the previous workbook                |
| R12    | Repair rollback tooling and image references         | F14 (P2)                         | R0, R10        | Clean runner has pinned Bun; rollback resolves repository@digest and fails on invalid pins         |
| R13    | Verify and report actual release artifacts           | F15 (P2)                         | R7, R10, R12   | Missing, wrong-version, corrupt, or skipped artifacts cannot be reported as verified               |
| R14    | Make interrupted imports safe to resume              | F16 (P2)                         | R0, R5         | Restart does not duplicate one job's products; a separate intentional import still works           |

R9 is reserved for the previously considered low-priority atomic desktop configuration follow-up; it remains deferred, and package IDs stay stable.

R7 has no storage dependency. R2 starts after the R1 storage handoff; R3 waits for both R1 and R2 so the catalog storage file has one owner. Add each regression check with its fix; R8 consolidates deployment verification rather than postponing tests until the end.

## Decisions to preserve

- Keep PostgreSQL as the queue authority. Continue running one scheduler-owning Node process per installation for this work.
- Use the existing filesystem and a persistent Docker volume for document bytes. A new object-storage service is unnecessary for this product.
- Keep configured internal integrations, including SearXNG and local AI endpoints, separate from arbitrary public-content URLs.
- Use native Node networking where connection-level DNS control is required. Prefer existing dependencies for parsing and testing.
- Put domain write rules under `src/server/services/`. Keep tRPC handlers responsible for inputs, errors, and transport.
- Keep `/api/health` as liveness and introduce `/api/ready` for readiness.
- Support on-prem updates through the existing host-side command. Add no host agent or Docker-socket mount in this remediation.

The [T3 Code and PandaCode research note](./architecture-research-t3code-pandacode.md) supplies pinned source and test evidence for the implementation choices in R1, R2, R4, R6, R7, and R8. Preserve these small service boundaries; neither upstream project justifies a runtime or database migration.

Migration and rollback apply to every package: rehearse against disposable data first. R5's revision and an optional R14 ledger are additive schema changes; generate, review, and apply them through the repository commands, and retain columns/tables during code rollback. Other packages require no schema migration unless implementation discovers one and amends this plan. Preserve the pre-upgrade bundle and verify old-image schema compatibility before rollback. Workflow changes can revert to a reviewed commit, but never publish with known unsafe checks or silently resume non-idempotent jobs. Storage-specific recovery is defined in R1, R3, and R11.

## R0 — Create isolated verification fixtures

Addresses **F12 (P2): E2E database and app isolation**. Primary files: [E2E spec](../tests/e2e/material-profile.spec.ts), [Playwright configuration](../playwright.config.ts), and new isolated integration fixtures.

Start with a disposable PostgreSQL 16 database and controlled HTTP responses. Extend Vitest and Playwright rather than introducing another test runner.

1. Guard the existing Playwright flow before running it: `tests/e2e/material-profile.spec.ts:10` loads `.env.local` with `override: true`, line 17 uses `DATABASE_URL`, and line 169 begins destructive cleanup. Remove that override for tests and require a dedicated, explicitly validated test database variable before any connection, seed, or deletion. Never fall back to the normal `DATABASE_URL`.
2. Start a separately owned app with exactly the validated test database and an isolated port/data root. Disable `playwright.config.ts`'s local `reuseExistingServer` for destructive E2E. Refuse an occupied port or unverified remote base URL; an existing development app must never receive test requests.
3. Add a database test setup under `tests/integration/` with a dedicated test connection variable. Require an explicit test database name and refuse a development or customer target. Apply migrations through `bun run db:migrate` with that isolated connection.
4. Make tests create and remove their own fixtures. Use independent database connections and explicit barriers for concurrency tests, so assertions do not depend on sleeps.
5. Add a shell-test fixture that substitutes a fake `docker` executable. Record commands and control exit codes without touching a real daemon.
6. Use controlled resolver and socket fixtures for HTTP safety tests. Test streaming and abort behavior with real streams. Do not contact public websites or private services.
7. Add `test:integration` with a dedicated Vitest configuration that reuses the existing aliases. Exclude this group from the default unit run, then run it explicitly against a CI PostgreSQL service. A missing test connection must fail that command with a clear prerequisite message.

**Acceptance:** a development URL, missing test variable, `.env.local` override, occupied app port, and mismatched app/database target all fail before writes; concurrent connections work, and a failing fake restore cannot start an application. Keep live scraping opt-in.

## R1 — Preserve file bytes through upgrades and restore

Addresses **F01: nonpersistent app files** and **F08: SQL restore continues after errors**.

Primary files: [production Compose](../compose.production.yml), [backup script](../scripts/onprem-backup.sh), [restore script](../scripts/onprem-restore.sh), [update script](../scripts/onprem-update.sh), [on-prem helpers](../scripts/onprem-lib.sh), [customer configuration example](../deploy/onprem/.env.customer.example), and the three storage consumers below.

### Put server-managed files under one durable root

Introduce `BIDTOOL_DATA_DIR` as the default root for server-managed files. Resolve the root in one small server-only path module; keep each storage module responsible for its own files.

| Surface                        | Default data root             | Compatibility requirement                                                        |
| ------------------------------ | ----------------------------- | -------------------------------------------------------------------------------- |
| Source web development         | `<project>/data`              | Preserve today's default                                                         |
| Docker on-prem                 | `/app/data` in a named volume | Preserve the Compose project name and existing PostgreSQL volume                 |
| Bundled Electron server        | `<Electron userData>/data`    | Pass the root in the child environment; do not write into packaged app resources |
| Electron using a remote server | Server's configured root      | Keep bytes on the server; do not migrate them to the desktop                     |

Use `catalog-pdfs`, `excel-research`, and `material-profiles` subdirectories. Preserve explicit `BIDTOOL_CATALOG_PDF_DIR`, research-directory, and profile-directory settings. Inventory effective paths before backup; if a server-managed path is outside the durable root, include it explicitly or fail the complete-backup check. Do not silently omit an override.

References: [catalog PDF storage](../src/server/services/catalog-pdf-storage.ts), [research storage](../src/server/services/excel-research-storage.ts), [profile storage](../src/server/services/material-profile-workspaces.ts), [settings](../src/server/services/app-settings.ts), and [Electron child startup](../electron/main.cjs).

Keep operator-selected export destinations explicit. List those destinations as external outputs in the backup manifest, without claiming they are included. Keep the existing serverless temporary-file behavior documented; durable local jobs remain supported by the Node and on-prem surfaces.

### Move an existing installation before replacing its container

A new volume hides the old container's `/app/data`; adding the mount alone does not migrate the bytes.

1. Record the current image identifier and check free disk space. Discover effective artifact roots and report missing referenced files.
2. Stop the app, including its embedded scheduler, while preserving the existing container. Copy its files into a host staging directory before any recreation command runs.
3. Create a complete pre-upgrade backup from that stopped state. Keep this copy outside the old container and outside the new application volume.
4. Initialize the volume from staging and verify a file inventory and checksums. Do not overwrite a nonempty destination or delete the old copy automatically.
5. Start the new image with the persistent mount. Validate document downloads and research artifacts against their database metadata.
6. Keep the old container or exported files and backup until verification succeeds. Resume only the previously running services if migration fails before replacement.

For bundled desktop installations, detect legacy data under the former standalone working directory before changing the default. Copy and verify it into `userData` while the child server is stopped. Preserve configured paths and the original copy. Test this before a desktop upgrade can remove the old resources.

### Back up and restore a consistent set

Use a versioned backup bundle containing a manifest, a PostgreSQL custom-format dump, and the included file trees. Record the app image, backup format, schema marker, relative file paths, sizes, and checksums. Do not include secret environment files by default.

For this single-user deployment, accept a maintenance window: stop the app before dumping PostgreSQL and copying files, then restart it only if the backup operation stopped it. With all app writers stopped, the database and files describe the same state. Reject completion if any required copy or checksum fails. Publish a finished bundle only after verification; keep incomplete output clearly separate.

First require `compose stop app` to succeed. `scripts/onprem-restore.sh:16` currently ignores its failure with `|| true`; remove that bypass. A failed stop must exit before any SQL, file replacement, migration, or start command.

On restore, validate the bundle before replacing data. Restore into empty staging storage where practical, check the database and file references, and retain the previous data until validation passes. Use `psql -v ON_ERROR_STOP=1` for legacy SQL backups. Use fail-fast `pg_restore` options for custom dumps. Leave the app stopped when restore fails; return a nonzero status and a concrete recovery message.

Continue recognizing older `.dump` and `.sql` backups as **database-only**. Require explicit operator selection for that mode and report that document bytes are unavailable. Do not label such a restore complete when referenced files are absent. Never replace a newer schema with an older image unless that image is known to support the restored schema.

**Acceptance checks:**

- Existing-container migration retains uploaded PDFs, generated PDFs, research files, and profile files, including checksums.
- Replacing the app container retains the same bytes and downloadable records.
- Restoring the complete bundle into a fresh stack reproduces database records and file checksums.
- A fake Docker stop failure records no restore, migration, or start command.
- A failing SQL statement, corrupt bundle, missing tree, or failed copy exits nonzero and cannot restart the app over incomplete data.
- Desktop defaults resolve to `userData`; explicit directory settings retain precedence.

## R2 — Make public-content downloads safe and bounded

Addresses **F02: inconsistent destination checks** and **F03: body reads outlive limits**.

Primary files: [PDF downloader](../src/server/services/catalog-pdf-storage.ts), [web search](../src/server/services/material-web-search.ts), [price fetcher](../src/server/services/material-price-sources.ts), [BidWinner details](../src/server/services/bidwinner-detail.ts), and [shop URL policy](../src/server/services/shop-material-scraper/url-safety.ts). Inventory other arbitrary URL readers with `rg -n 'fetch\(|https?\.request|\.goto\(' src/server` before changing callers.

`bidwinner-detail.ts:785` validates the initial host, but lines 900–913 follow redirects automatically, read an unbounded body, and clear the timer before the returned `response.text()` promise settles. Include this caller explicitly; retain its BidWinner host allowlist at every hop as well as the public-address checks.

Create a focused server-only public-content client. A caller requests a bounded PDF or page and receives bytes or text, the final public URL, and content type. The caller must not coordinate DNS checks, redirects, timers, and stream limits.

1. Accept only HTTP and HTTPS URLs without embedded credentials. Normalize IP forms, including IPv6 and IPv4-mapped IPv6. Reject loopback, private, link-local, unspecified, and other nonpublic destinations. Reuse one tested address classifier.
2. Resolve the hostname for the actual connection and connect only to a validated public address. Preserve the original hostname for HTTP Host and TLS verification. A separate DNS check followed by unrestricted `fetch` is insufficient. Remove indefinite public-host approval caching from policy reused by this client.
3. Follow redirects manually, at most five hops. Validate and pin each destination, cancel each unused response body, and carry the original deadline across the chain. Do not forward cookies or credentials across origins.
4. Keep a total deadline active through DNS, connection, redirects, and body consumption. Preserve caller cancellation. Use the existing 60-second PDF budget and the existing configured search and price deadlines.
5. Preserve the PDF limit of 50 MiB. Start with a 5 MiB decoded-body limit for fetched HTML and text; check fixture compatibility before shipping. Count bytes while consuming the body, including after decompression. Treat `Content-Length` as an early rejection hint, not the authority. Destroy the stream on timeout, cancellation, or overflow.
6. Migrate the arbitrary HTTP callers to this boundary. Leave configured SearXNG and AI endpoints on their explicit integration paths, including supported local endpoints. Return useful Vietnamese error messages without exposing internal addresses or credentials.

Use Node's `http` and `https` connection options if the existing fetch implementation cannot pin validated DNS results. Validate behavior under the supported Bun tooling and the Node runtime used by Docker and Electron. Do not add a general HTTP framework.

Keep Chromium's existing same-host request restrictions. Audit navigation and redirect handling against the shared address classifier, but distinguish URL checks from connection-level isolation. The HTTP fix does not prove that Chromium is protected from DNS rebinding. If controlled browser tests reveal a bypass, keep that part of F02 open and design a browser-specific connection restriction before claiming full outbound isolation.

**Acceptance checks:**

- Direct and redirected private destinations, including encoded IP forms and mixed public/private DNS answers, are refused before sending an HTTP request.
- A controlled DNS change cannot redirect the HTTP connection to an unvalidated address. The allowed hostname still receives correct TLS validation.
- Chunked responses with no length, false lengths, stalled bodies, decompression growth, redirect loops, and caller aborts remain bounded and cancel their streams.
- A BidWinner-allowed initial URL redirecting to a disallowed host or private address fails; a stalled or oversized BidWinner body aborts within budget.
- PDF header validation, existing HTML extraction, configured local AI, and local SearXNG still work.
- Caller inventory is accounted for: migrated public HTTP calls, trusted integration calls, and any remaining browser-specific limits are listed explicitly.

## R3 — Make PDF replacement recoverable

Addresses **F06: deleting the previous file before replacement succeeds**.

Primary files: [catalog router](../src/server/api/routers/catalog-document.ts), [PDF storage](../src/server/services/catalog-pdf-storage.ts), and [storage tests](../src/server/services/catalog-pdf-storage.test.ts).

1. Validate bytes before writing. Write a replacement to a unique version path under the same durable root, then finish the file before exposing it.
2. Lock and re-read the document in a short database transaction. Update its path and checksum only after the replacement exists. Preserve the original display filename separately from the physical version path.
3. If the write or database update fails, keep the previous path and bytes intact. Remove the abandoned new file when safe.
4. Remove the old version only after commit and after confirming that it is no longer referenced. Cleanup failure must not reverse a successful replacement.
5. Retain compatibility when reading old `<documentId>/<filename>` paths. Apply the safe publication rule to reuploads and downloaded replacements.
6. Clean stale unreferenced versions conservatively, with a grace period longer than an in-flight replacement. Never delete merely because a file has not yet been attached during an active write.

**Acceptance:** inject partial writes, disk errors, database errors, and process-exit checkpoints before and after commit. The current database reference must always point to a complete readable version. Concurrent replacements must leave one valid committed version. Backup during the R1 maintenance window must retain that version.

## R4 — Enqueue complete enrichment jobs atomically

Addresses **F05: a parent job can survive without its work items**.

Primary files: [job service](../src/server/services/material-enrichment-jobs.ts), [runner](../src/server/services/material-enrichment-runner.ts), and [scheduler](../src/server/services/job-scheduler.ts).

1. Insert the parent job and all child items in one Drizzle transaction. Derive `materialIds` and `total` from the same active material selection used to create children.
2. Return a queued snapshot and send any scheduler wakeup only after commit. A scheduler connection must never observe a partially enqueued job. Existing PostgreSQL queue rows are sufficient durable work records; add no event-sourcing framework or second outbox for this fix.
3. Before success, compare the persisted work set and terminal item counts with the expected total. Respect the existing terminal statuses; failed item outcomes must remain visible. Never mark a positive-total job with no items completed.
4. Detect malformed jobs left by older versions and mark them failed with an actionable message. Do not invent work items from an incomplete snapshot or silently retry paid AI work.

**Acceptance:** force the item insertion to fail and assert no parent survives. Verify a concurrent scheduler cannot claim an uncommitted parent. A malformed legacy fixture must fail visibly; a normal and a cancelled job must retain existing behavior.

## R5 — Protect material writes from stale snapshots

Addresses **F04: concurrent refreshes and edits can erase each other's changes** and **F19 (P2): deterministic materialProfile metadata loss**.

Primary files: [price-source procedures](../src/server/api/routers/material/price-sources.ts), [material router](../src/server/api/routers/material.ts), [enrichment commit](../src/server/services/material-enrichment-commit.ts), [profile save batches](../src/server/services/material-profile-material-batches.ts), [shop importer](../src/server/services/shop-product-importer.ts), [profile-search writers](../src/server/services/material-profile-search-jobs.ts), [metadata normalization](../src/lib/material-price-sources.ts), and [schema](../src/server/db/schema.ts).

Inventory all writers with `rg -n 'update\(materials\)|insert\(materials\)|metadataJson:' src/server`. Include imports, field locks, enrichment, profile saves, and undo operations. Keep existing fill-empty and overwrite rules.

1. Add a focused material-write service for source changes, field-lock changes, and accepted enrichment updates. Derive transaction and row types from Drizzle. Avoid a generic repository or public callback that makes callers manage the invariants.
2. Fetch external prices before a transaction. Inside a short transaction, lock and re-read the current material, locate the source by ID, and verify its URL still matches the fetched URL. If the source was removed or changed, return a conflict instead of applying obsolete results.
3. Merge into the raw current metadata object and update only fields owned by the operation. `normalizeMaterialMetadata` returns selected known keys and strips `materialProfile`; using its output as the complete saved object loses provenance even without concurrency. Use normalization only to interpret owned fields, then preserve all unrelated raw keys, including `materialProfile` and unknown future keys. Apply this to price-source edits, field locks, enrichment, shop imports, and profile-search promotion writers. When `updateDefaultPrice` is false, omit the price column from the update entirely. Re-evaluate primary-source selection and field locks from current state.
4. When committing enrichment, retain the existing work-item lock and also lock the material before evaluating fill-empty and field-lock rules. Retain the existing profile job/item locks and promotion ledger; extend their material merge rather than replacing their stale-source protections. Keep network work outside the transaction. Use one documented lock order across involved operations; lock material IDs in ascending order for bulk writes.
5. Add a monotonic integer `revision` to materials for stale browser edits and destructive undo checks. Increment it atomically in every material writer. Derive snapshots from returned database rows. Require `expectedRevision` on browser commands that replace saved state; do not rely on millisecond timestamps as a unique version.
6. On a revision conflict, preserve the unsaved draft and offer reload or review of current values. Do not silently retry a stale replacement. Background operations re-read under lock and apply their bounded merge rather than replaying a browser snapshot.
7. Generate and review the additive migration through `bun run db:generate`; apply it only with `bun run db:migrate` in the isolated database. Include updated fixtures and all writer increments in the same coherent change.

**Acceptance:** use two real PostgreSQL connections to interleave a delayed price refresh with a source addition, source URL change, source deletion, manual price edit, field-lock edit, and enrichment commit. Preserve unrelated changes, reject obsolete results, and keep revision increments monotonic. Two stale browser submissions must not both replace the same saved version. A second commit of the same enrichment item must remain idempotent. Seed `materialProfile` and an unknown nested key, then run each metadata writer sequentially and concurrently; unrelated raw values must survive unchanged. Existing profile cancellation, fingerprint, promotion-ledger, and field-lock tests must still pass.

## R6 — Recover scheduler startup and report readiness

Addresses **F07: recovery failure is not retried** and **F09: health always reports success**, **F17 (P2): recent orphan Excel work**, and **F18 (P2): cancellation resurrection**.

Primary files: [scheduler](../src/server/services/job-scheduler.ts), [Excel batch recovery](../src/server/services/excel-research/process-batch.ts), [enrichment runner](../src/server/services/material-enrichment-runner.ts), [instrumentation](../instrumentation.ts), [router bootstrap](../src/server/api/root.ts), [health route](../src/app/api/health/route.ts), [Dockerfile](../Dockerfile), and [production Compose](../compose.production.yml).

### Retry initialization before accepting queued work

Replace the implicit `schedulerStarted` meaning with explicit startup states: disabled, recovering, retrying, ready, and stopped. Put state needed by readiness in a small module that does not start the scheduler when imported.

- Keep startup idempotent across instrumentation and router imports. Allow one initialization attempt at a time.
- Run stale-job recovery before any queue polling. If recovery partially succeeds and then fails, await every query from that attempt settling before retrying. The current `Promise.all` can reject while sibling updates still run; use an all-settled barrier or serial recovery so attempts never overlap. Keep claims paused until the full required attempt succeeds.
- At startup only, reset orphan Excel `processing` rows even when their timestamp is newer than ten minutes or missing. `excel-research/process-batch.ts:395` currently resets only old rows, leaving recently interrupted work stranded. Retain the age guard for any maintenance after startup; never reclaim live work blindly. Reject parent completion while pending/processing children remain, and derive counters from persisted rows.
- Make enrichment start/finish and progress transitions conditional on the expected active state. `material-enrichment-runner.ts:655–675` reads a job and then sets `running` by ID alone; a cancelled job can be resurrected. Cancellation must win both before that read and between read and update. Abort work without further AI calls or completion writes when the guarded transition loses. Apply the same terminal-state rule to recovery and completion. Deploy the R14 safe-import policy before enabling automatic retries of interrupted imports.
- Retry with capped backoff, starting at one second and capped at 30 seconds. Cancel pending attempts on shutdown or test reset.
- Once recovery succeeds, start polling and record the last successful poll time. Treat optional cleanup failures separately so cleanup cannot hold startup indefinitely.
- Never rerun the existing blanket reset of all running jobs after work has started. A later database outage may pause claims and degrade readiness; it must not reset live work blindly.
- Keep the single-owner assumption explicit. Worker leases and multiple schedulers require a separate design because today's restart recovery is not an ownership protocol.

### Separate liveness from readiness

Keep `/api/health` backward-compatible as a cheap process response. Add `/api/ready` with an overall two-second deadline and HTTP 503 when required dependencies are unavailable.

Readiness must check PostgreSQL connectivity, the expected migration marker, and successful scheduler initialization on deployments that own background jobs. Check the migration marker read-only; do not run migrations from the endpoint. Bound database operations so a timed-out request does not leave unlimited queued probes.

Return coarse status and a timestamp. Log diagnostic details on the server. Do not return connection strings, private paths, or raw database errors. If a surface intentionally disables the scheduler, require an explicit supported capability configuration rather than treating accidental missing job execution as healthy.

Point container health and rollout verification at readiness. Keep liveness available for diagnosis. Use an explicit bounded readiness wait in install and update commands; Docker's unhealthy status alone does not restart a container or prove a successful update.

**Acceptance:** fail the first recovery query, restore the database, and verify stale jobs resume without restarting Node. Hold one recovery query pending while another fails: no second attempt or claim may start until all siblings settle. Assert no claims occur before recovery finishes and no duplicate timer starts. Restart immediately after an Excel row enters processing, including a missing-timestamp fixture: recover it at startup and process it once; a parent with unfinished rows must not report completion. Cancel before runner entry, between select/update, and during completion: status stays cancelled, with no resurrected work or success event. Simulate a later outage and confirm live jobs are not blanket-reset. Verify liveness returns 200 while database, schema, or startup failures make readiness return 503 within its deadline. Restore readiness when dependencies recover.

## R7 — Remove the unsupported on-prem self-update path

Addresses **F10: a flag exposes an updater absent from the packaged environment**.

Primary files: [update service](../src/server/services/onprem-update.ts), [version service](../src/server/services/version-info.ts), [version router](../src/server/api/routers/version.ts), [UI action selection](../src/lib/update-apply.ts), and associated tests.

Report `canApplyInApp: false` for the supplied on-prem deployment, even if the legacy enable flag is present. Keep the host update command generated by the version service. Return an explicit unsupported-operation response from the old mutation for compatibility. Ensure the UI selects its existing copy-command action rather than spawning a process.

Preserve Electron's separate supported updater. Document removal of the legacy flag. Do not attempt to fix the container by copying one shell helper: it still lacks a supported host-control boundary.

**Acceptance:** status and UI action tests use a real packaged capability result; a legacy mutation never spawns a process. A production image smoke check confirms the advertised action matches the available host workflow. Desktop update action tests remain green.

## R8 — Make cross-system evidence part of delivery

Extend [.github/workflows/ci.yml](../.github/workflows/ci.yml), [release workflow](../.github/workflows/release.yml), and the existing Playwright setup. Make the affected failure suites required in CI and in the release dependency graph before any publication or promotion, all against the R10 resolved SHA. A green branch CI run does not cover a manually dispatched tag release. Add checks as their fixes land, then require these groups before calling the remediation complete:

| Check group                                              | What it proves                                                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Existing lint, TypeScript, Vitest, and build             | The current stack and unit behavior still work                                                        |
| PostgreSQL integration                                   | Atomic enqueue, locked material merges, revisions, cancellation, and idempotent commits               |
| Controlled HTTP transport                                | Address rejection, pinned connections, redirect checks, decoded size limits, and end-to-end deadlines |
| Filesystem failure cases                                 | Valid previous PDFs survive failed replacements                                                       |
| On-prem upgrade and restore                              | Persistent bytes survive replacement and a complete bundle restores into a fresh project              |
| Packaged capability smoke                                | On-prem update status is honest; bundled desktop uses a writable persistent directory                 |
| Existing material-profile and material browser workflows | Import, edit, save, export, and document download remain usable                                       |

Use unique Compose project names and test-only volumes. A unique `-p` alone is insufficient: `compose.production.yml` has fixed `container_name` values and published host ports. Remove or override fixed names in the test configuration and allocate isolated ports, or avoid host bindings with network-local probes. Prove two test projects can run together and that tearing down one leaves the other and any development stack intact. Clean up only resources created by that test. Build and start the actual runtime image for packaging checks; configuration parsing and mocked child processes are insufficient. Keep tests independent of live BidWinner, AI billing, and external shops.

Run the extracted desktop server outside the checkout with an isolated data root. Clear `NODE_PATH` and disable global module lookup so developer dependencies cannot hide missing bundled files. Assert the expected release version, platform artifact, static assets, runtime dependencies, and absence of packaged `.env` files. A file-list or version probe is only the first check: also reach readiness and download a fixture document from the assembled runtime. Test Windows NSIS and Linux AppImage on supported disposable runners. Keep process-survival evidence separate from visible UI and restore evidence.

Add the missing `test:e2e` script or correct the README to the supported command. Add a reviewed SearXNG version or digest pin instead of `latest`; record the selected version when implementation verifies it. Do not invent a digest in this plan.

Document the trusted-LAN or loopback deployment boundary. Preserve existing configured access when adding a loopback option. The single-user no-auth choice remains intentional. Remove misleading claims that compatibility permission helpers enforce authorization, without expanding into an auth rewrite.

Run affected tests first, then use the following completion commands. Commands marked planned must be added with their test group before they can be used.

| Command                     | State         | Purpose                                                                                   |
| --------------------------- | ------------- | ----------------------------------------------------------------------------------------- |
| `bun run check`             | Existing      | ESLint and TypeScript                                                                     |
| `bun run test`              | Existing      | Unit and fixture suite                                                                    |
| `bun run test:integration`  | Planned in R0 | Isolated PostgreSQL failure and concurrency cases                                         |
| `bun run test:e2e`          | Planned in R8 | Existing Playwright workflows with controlled external responses                          |
| `bun run test:onprem:smoke` | Planned in R8 | Runtime-image replacement, complete restore, and readiness in disposable Compose projects |
| `bun run build`             | Existing      | Production artifact assembly                                                              |

Keep the slow on-prem smoke job separate from unit tests, but make it required for remediation completion and affected releases. Test missing Vercel secrets explicitly: `release.yml:109` reports `deployment_id=skipped` while the manifest construction near line 321 still supplies normal web metadata. Report skipped web separately from verified artifacts and never treat its placeholder URL as deployment proof (R13). Attach desktop persistent-path and updater smoke evidence from a supported desktop platform before shipping the desktop storage change.

## R10 — Resolve one release commit before checks or builds

Addresses **F11 (P1): release tag/source mismatch**. Depends on R0. Primary file: [release workflow](../.github/workflows/release.yml).

`workflow_dispatch.release_tag` names the release while `short_sha` comes from `GITHUB_SHA` and checkouts use the dispatch ref. Resolve and validate the tag to its full commit SHA in a prerequisite job; fail for a missing/non-commit tag. Pass that immutable SHA to every quality, web, Docker, desktop, manifest, and publishing job. Checkout that SHA explicitly everywhere, derive build metadata from it, and assert the source SHA before publishing. Protect against a moved tag by rechecking its resolution before publication and failing on mismatch.

**Acceptance:** dispatch from commit B for a tag at A; all checks, build provenance, image labels, and manifests identify A. Missing tags, changed tags, a checkout at B, or a failed quality gate block publication. No database migration. Revert workflow changes only while publication is disabled until the pinned-source checks pass.

## R11 — Publish a workbook replacement as one state change

Addresses **F13 (P2): workbook replacement is non-atomic**. Depends on R0 and R1. Primary file: [workspace service](../src/server/services/material-profile-workspaces.ts), with its workbook/replacement tests.

At lines 1146–1200, upload invalidates active jobs before parsing, then updates the workspace and deletes items separately. Decode, parse, and validate the full workbook before invalidating anything. Stage any file cache at a unique version path; do not overwrite the currently referenced filename. Then lock/re-read the workspace in a short transaction, validate the expected workspace version, cancel/invalidate old jobs, update the workbook, and remove old items atomically. Coordinate the lock order with existing search job/item locks so a promotion cannot commit stale results into the replacement. Keep parsing and file I/O outside that transaction.

**Acceptance:** invalid base64, invalid workbook, missing sheet, parse failure, item-deletion error, database commit failure, concurrent replacement, and replacement racing promotion preserve either the complete old state or complete new state. Parsing failure leaves old jobs active. Inject file write/rename failure: preserve the old bytes; retain the existing database-backed workbook fallback on read-only/serverless filesystems without publishing a partial path.

No schema migration unless a workspace revision is needed; if added, use an additive migration. On database failure, remove only the abandoned new version. Delete old files only after commit and reference checks; preserve recoverable database bytes and compatibility with old paths. Code rollback must retain the current committed workbook and its files.

## R12 — Make artifact rollback executable on a clean runner

Addresses **F14 (P2): rollback tooling and image references**. Depends on R0 and R10. Primary files: [rollback workflow](../.github/workflows/rollback.yml), [release pins](../releases/pins.json), and [pin generator](../scripts/update-release-pins.ts).

Install the repository-pinned Bun before any `bunx` invocation. Validate the pin fields before external actions. Construct the Docker source as the recorded repository plus `@sha256:…`; a bare digest from `.onprem.digest` is not a pullable image reference. Verify that digest exists and belongs to the expected repository before retagging. Preserve the explicit skipped-web case and report each actual action separately.

**Acceptance:** run with no preinstalled Bun and a valid fixture pin; record the full `repository@digest` argument. Missing/malformed digest, wrong repository, unavailable image, and failed promotion/retag exit nonzero without a success summary. A skipped web pin must never invoke Vercel. Use command fakes first, then a disposable registry rehearsal before closure. No database migration; artifact rollback does not authorize a schema downgrade or customer-host deployment. Revert the workflow if needed while retaining known-good immutable pins.

## R13 — Verify release artifacts and report unsupported or skipped surfaces

Addresses **F15 (P2): release artifact verification/reporting**. Depends on R7, R10, and R12. Primary files: [release workflow](../.github/workflows/release.yml), [manifest generator](../scripts/generate-release-manifest.ts), [pin generator](../scripts/update-release-pins.ts), and [release status CLI](../scripts/release-cli.ts).

Add explicit built, verified, skipped, and failed outcomes per surface to release evidence. Validate expected platform filenames, checksums, version/build SHA, Docker digest, and runtime readiness from the actual assembled artifacts before reporting verified. Use R8's extracted desktop and image smoke checks, including downloading a fixture document. A file's existence or successful upload alone proves neither startup nor package completeness. Preserve available surfaces when web is intentionally skipped; omit unsupported web promotion claims and keep manifest/pin/status consumers consistent with that outcome. Block a required artifact's publication when it is missing or unverified.

**Acceptance:** missing executable/AppImage, wrong version/SHA, corrupt file, missing runtime dependency, image readiness failure, absent Vercel secrets, and failed promotion produce accurate per-surface results. Skipped web must not look deployed merely because a default URL exists. All verified artifacts must identify the same R10 commit. No database migration; keep readers compatible with older manifests/pins. Revert reporting code without replacing immutable artifacts or inventing verification evidence; use R12 for an explicitly authorized rollback.

## R14 — Prevent duplicate products after interrupted imports

Addresses **F16 (P2): import restart duplication**. Depends on R0 and R5; R6 must use this policy before requeueing imports. Primary files: [scheduler](../src/server/services/job-scheduler.ts), [importer](../src/server/services/shop-product-importer.ts), [schema](../src/server/db/schema.ts), and importer/recovery tests.

`job-scheduler.ts:1220` requeues interrupted imports; line 609 reloads all products. `shop-product-importer.ts` creates materials unconditionally in `create_all`. Progress flushing alone cannot prove which inserts committed before a crash.

Use a durable per-import-job/product ledger with a stable product identity and a uniqueness constraint. In one transaction, claim/check that ledger entry, write or match the material, and record the result; resume committed products without creating them again. Include required related database writes in the same boundary or give them explicit idempotent recovery. Thread the import job ID into the importer. Reconcile progress from the ledger rather than treating in-memory counters as durable. Scope deduplication to one job so separate intentional imports remain allowed.

If that transactional boundary cannot ship immediately, explicitly fail interrupted non-idempotent `create_all` jobs at startup with a Vietnamese recovery message and preserved partial results. Do not automatically requeue them or present a manual restart as safe resumption. Keep F16 open until the selected safe policy and its failure tests pass; automatic resume remains unavailable under the interim policy.

**Acceptance:** crash before material commit, after material/ledger commit but before progress flush, and during related-document writes; restart twice. Each product creates at most one material for that job, counters match durable outcomes, and a second intentional job may create its own materials. Under the interim policy, an interrupted job stays failed and no import runs automatically. Test cancellation during resume as well.

Ledger migration must be additive, generated and reviewed through the normal commands. Legacy interrupted jobs have no reliable ledger: fail them visibly instead of guessing which products to replay. Retain ledger rows/constraints on code rollback and disable unsafe automatic recovery before using older code. Do not delete already imported materials as rollback.

## Keep follow-up refactors separate

After the fixes pass, extract workbook I/O, review persistence, export creation, and OS folder commands from the 3,079-line workspace service. Move one responsibility at a time behind the existing facade. Use the new behavior tests to preserve workflow results.

Measure representative BOQs of 100, 1,000, and 5,000 rows. Record response bytes, query time, browser memory, and refetch latency for the full workspace read. Set a product budget from those measurements before deciding whether to split or paginate the response. No measured regression was established in the audit.

Defer the Vite/Hono migration, worker process split, multi-user auth, and distributed job ownership. Revisit worker separation if measured UI contention or a demonstrated process-failure risk warrants it. A worker split must also specify leases, event delivery across processes, and shutdown behavior.

The upstream comparison also identifies three bounded follow-ups, outside F01–F19:

- Review enrichment SSE replay beyond 500 events, subscribe/replay overlap, byte limits for slow readers, and disconnect cleanup. Keep PostgreSQL event history as the source for reconnects. Establish the failing case and a measured budget before changing transport.
- Save Electron `desktop-config.json` through a unique same-directory temporary file, flush, and rename. Preserve unknown fields and old bytes on write or rename failure. Test replacement on supported platforms. Atomic rename alone does not establish power-loss durability.
- Consider blocking bundled desktop installation while local jobs are active. Derive the busy state from supported server status, test activity starting during an install request, and treat a remote-server client separately. Preserve current manual installation behavior until this follow-up is designed.

## Release and rollback checks

Before any authorized release, record a clean commit, image identifier, migration list, and passing checks. Apply additive schema changes before code requiring `revision`; do not edit old migration history. Keep the database and file backup from before the upgrade.

Test the first upgrade with the previous released image and representative fixtures in a disposable environment. Extract old container files before recreation. Prove the pre-upgrade backup can restore into a fresh stack with the matching image. After upgrade, verify readiness, queue processing, record edits, and document checksums.

On failure, stop the app and preserve failed-state evidence. Revert to the previous image only when schema compatibility is established. Otherwise restore the complete pre-upgrade database-and-files bundle into preserved storage. Do not drop new columns or delete volumes as an automatic rollback step. Document recovery time and maintenance downtime from the rehearsal rather than estimating them here.

## Finding closure checklist

- [ ] F01 — Persistent storage, existing-install migration, and complete restore preserve all included file bytes.
- [ ] F02 — Public HTTP destinations and redirects are connection-validated; caller coverage and remaining browser limits are explicit.
- [ ] F03 — Body deadlines and decoded-byte ceilings hold without trustworthy response headers.
- [ ] F04 — Material merges preserve concurrent changes, and stale browser replacements conflict.
- [ ] F05 — Enqueue is atomic, and inconsistent legacy work cannot report success.
- [ ] F06 — Replacement failure leaves a complete current PDF readable.
- [ ] F07 — Startup recovery retries without duplicate claims or resets of healthy active work.
- [ ] F08 — SQL and custom restores fail visibly and keep the app stopped on error.
- [ ] F09 — Readiness reflects bounded database, schema, and scheduler checks.
- [ ] F10 — Packaged on-prem capability reporting never invokes the unsupported updater.
- [ ] F11 (P1) — R10 checks, builds, and publication use the resolved tag SHA, including manual dispatch.
- [ ] F12 (P2) — R0 refuses unsafe Playwright DB/app targets before seed or cleanup.
- [ ] F13 (P2) — R11 replacement failures preserve the previous workbook, rows, and job state.
- [ ] F14 (P2) — R12 works with pinned Bun and a verified repository@digest reference.
- [ ] F15 (P2) — R13/R8 verify actual artifacts and report skipped web accurately before release.
- [ ] F16 (P2) — R14 prevents restart duplication, or visibly fails interrupted non-idempotent jobs without automatic retry.
- [ ] F17 (P2) — R6 recovers recent orphan Excel rows at startup and rejects completion with unfinished rows.
- [ ] F18 (P2) — R6 guarded transitions cannot resurrect or complete a cancelled job.
- [ ] F19 (P2) — R5 preserves raw unrelated metadata, including materialProfile, across every writer.

Attach the relevant test output and upgrade or restore evidence to each completed item. Keep an item open when its required environment has not been exercised. The audit's earlier lint, typecheck, 513 passing tests, and build results are a baseline, not evidence that these planned fixes exist.

## Verification recorded for this plan

Fresh commands run on 2026-11-02 against the shared checkout:

| Command                                 | Observed outcome                                                             |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| `bun run typecheck --incremental false` | Passed, exit 0; no incremental cache used                                    |
| `bun run lint`                          | Passed, exit 0                                                               |
| `bun run test --no-cache`               | Passed, exit 0; 70 test files passed, 2 skipped; 513 tests passed, 5 skipped |

These checks establish the current static/unit baseline only. No new build, browser, runtime image, restore, desktop package, or live concurrency proof was performed in this pass. Earlier build evidence remains historical. Every remediation and closure checkbox above remains proposed until its failure tests and required environment checks pass.
