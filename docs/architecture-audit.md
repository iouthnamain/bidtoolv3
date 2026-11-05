# BidTool v3 architecture audit

Canonical consolidated review, 2026-11-02. Baseline source: `60a6f3eb981c268b95b1e223417b1819638b053f` (`main`). Scope: application/API boundaries, database writes, job recovery, files, Electron/on-prem packaging, tests and release workflows. This document proposes changes; it implements none.

F01–F10 preserve the descriptions and evidence from the prior local audit (retained as a local review artifact). Earlier mocked-fetch and standalone-build probes are explicitly prior evidence. This pass verifies source ordering and guards; it did not rerun those probes or a build. F11–F19 extend that review with source-confirmed failure paths. Runtime proofs listed below remain unperformed.

The core stack fits the stated single-user product. The highest-priority changes are durable file storage and a consistent outbound-content boundary. Next come atomic writes, concurrency safety and recovery checks. A framework rewrite would not itself fix these defects.

## Architecture observed

Browser or Electron → Next.js UI and tRPC → domain services → PostgreSQL and local files. The same Next.js Node runtime also starts the scheduler, Playwright scraping and enrichment work. PostgreSQL already supports transactional queue claims. On-prem runs the app behind Caddy with PostgreSQL and SearXNG.

The Option B documents describe a future Vite/Hono/worker topology, not the current implementation. Current assumptions are one scheduler-owning Node process and one local operator. Horizontal deployment, multiple users and public access were not assumed.

## Prioritized findings

P1 = address before depending on unattended upgrades, release identity or untrusted source downloads. P2 = concrete reliability or data-integrity gap. P3 = conditional capability mismatch. Source-confirmed means the code contains the stated ordering or missing guard; it does not mean a production incident was observed.

### F01 · P1 · On-prem upgrades can discard uploaded and generated files

Catalog PDFs and Excel research artifacts default to /app/data inside the container. The production app service has no data volume, while the update command recreates containers and the backup script saves only PostgreSQL. An image update can therefore leave valid database records pointing at files that no longer exist.

**Evidence:** Source-confirmed; no live upgrade performed. [compose.production.yml:21](../compose.production.yml#L21), [src/server/services/catalog-pdf-storage.ts:14](../src/server/services/catalog-pdf-storage.ts#L14), [src/server/services/excel-research-storage.ts:33](../src/server/services/excel-research-storage.ts#L33), [scripts/onprem-update.sh:37](../scripts/onprem-update.sh#L37), [scripts/onprem-backup.sh:17](../scripts/onprem-backup.sh#L17)

**Existing protections:** PostgreSQL already has a persistent volume; artifact roots support explicit overrides. Neither protects the default container-local file paths.

**Smallest improvement:** Mount one persistent app-data volume, route every server-managed artifact directory into it, and back up and restore the database and files as one recoverable set. Keep operator-selected export folders explicit.

**Runtime/failure proof not performed:** Upload a PDF and create research output; back up, replace the app container, and verify bytes/checksums. Restore into a clean stack and repeat the download checks.

### F02 · P1 · Outbound URL protection is inconsistent

The shop scraper checks destination hosts, but the catalog downloader checks only HTTP/HTTPS and follows redirects automatically. Search-result fetching also follows arbitrary URLs. A pasted or discovered URL, or an external redirect, can make the server contact internal services. Single-user operation does not make external source content trustworthy.

**Evidence:** Source-confirmed in this pass; prior mocked-fetch probe accepted a localhost PDF URL. No internal network request was sent. [src/server/services/catalog-pdf-storage.ts:101](../src/server/services/catalog-pdf-storage.ts#L101), [src/server/services/material-web-search.ts:765](../src/server/services/material-web-search.ts#L765), [src/server/services/shop-material-scraper/url-safety.ts:7](../src/server/services/shop-material-scraper/url-safety.ts#L7)

**Existing protections:** The shop scraper validates public hosts. BidWinner detail validates the initial domain; neither fact establishes a shared redirect or connection policy.

The same boundary must cover BidWinner callers. Detail URLs pass an initial domain allowlist at [bidwinner-detail.ts:785](../src/server/services/bidwinner-detail.ts#L785), through [the caller at :1047](../src/server/services/bidwinner-detail.ts#L1047), but [detail fetching at :900](../src/server/services/bidwinner-detail.ts#L900) follows redirects and returns an unbounded `response.text()` promise before `finally` clears the timer. [Search fetching at :654](../src/server/services/bidwinner-search.ts#L654) also follows redirects and buffers an uncapped HTML body, although it awaits that body inside its timeout. These are source observations, not a live redirect/body probe. Include both callers in the shared policy and body-limit tests; F03 retains the specific PDF-body defect.

**Smallest improvement:** Create one outbound HTTP boundary for user/discovered public content: reject private, loopback and link-local destinations, validate every redirect, and address DNS changes between validation and connection. Keep intentionally internal integrations such as SearXNG and a configured local AI endpoint in an explicit separate policy.

**Runtime/failure proof not performed:** Cover direct private IPs, IPv6, public-to-private redirects, and DNS changes with controlled transports. Preserve supported internal AI/search configuration.

### F03 · P2 · PDF download limits do not cover the response body

The 60-second timer is cleared immediately after response headers arrive. The body is then read fully into memory; the size check happens afterward unless Content-Length is supplied. A stalled or oversized chunked response can occupy the operation indefinitely or consume substantial memory in the same process that serves the UI.

**Evidence:** Source-confirmed in this pass; prior mocked-fetch probe observed the timeout cleared before arrayBuffer() began. [src/server/services/catalog-pdf-storage.ts:112](../src/server/services/catalog-pdf-storage.ts#L112), [src/server/services/catalog-pdf-storage.ts:127](../src/server/services/catalog-pdf-storage.ts#L127), [src/server/services/catalog-pdf-storage.ts:137](../src/server/services/catalog-pdf-storage.ts#L137)

**Existing protections:** A header deadline, declared-length check and post-download PDF validation exist. They do not bound body consumption.

**Smallest improvement:** Keep cancellation active until the body finishes. Read the body as a stream, enforce a byte ceiling while reading, cancel on overflow, and apply the same limits in the shared public-content fetcher.

**Runtime/failure proof not performed:** Test delayed headers, stalled body, missing or false Content-Length, and a body exceeding the limit. Assert the stream is cancelled.

### F04 · P2 · Price refreshes can silently overwrite newer material edits

refreshPriceSource reads the full material, waits for a network fetch, then writes metadataJson, defaultUnitPrice and sourceUrl from that old snapshot. If another tab or background task adds a source, changes a field lock, or edits the price during the fetch, the refresh can erase that change. It writes the old default price even when updateDefaultPrice is false. Enrichment commits lock the enrichment item but read the material without a material-row lock.

**Evidence:** Source-confirmed read/await/write interleaving; not reproduced against PostgreSQL. [src/server/api/routers/material/price-sources.ts:288](../src/server/api/routers/material/price-sources.ts#L288), [src/server/api/routers/material/price-sources.ts:309](../src/server/api/routers/material/price-sources.ts#L309), [src/server/api/routers/material/price-sources.ts:334](../src/server/api/routers/material/price-sources.ts#L334), [src/server/services/material-enrichment-commit.ts:266](../src/server/services/material-enrichment-commit.ts#L266), [src/server/services/material-enrichment-commit.ts:290](../src/server/services/material-enrichment-commit.ts#L290)

**Existing protections:** Enrichment uses a transaction and locks its work item; field locks exist. That does not serialize all writers of a material row.

**Smallest improvement:** Fetch externally before opening a short transaction. Then lock and re-read the material, merge only the requested source changes, and omit defaultUnitPrice entirely when no price update was requested. Use a shared material-write service and an optimistic revision check for browser edits.

**Runtime/failure proof not performed:** Interleave a delayed refresh with a source addition, lock change and manual price edit in a real PostgreSQL test; assert all unrelated changes survive.

### F05 · P2 · Enrichment enqueue is not atomic

The queued parent job is inserted separately from its child work items. If the second insert fails or the process exits between writes, the parent survives with a positive total and no items. The runner finds no pending items and the scheduler can mark this job completed, producing a successful no-op.

**Evidence:** Source-confirmed failure path; no database fault injection performed. [src/server/services/material-enrichment-jobs.ts:209](../src/server/services/material-enrichment-jobs.ts#L209), [src/server/services/material-enrichment-jobs.ts:225](../src/server/services/material-enrichment-jobs.ts#L225), [src/server/services/material-enrichment-runner.ts:679](../src/server/services/material-enrichment-runner.ts#L679), [src/server/services/job-scheduler.ts:717](../src/server/services/job-scheduler.ts#L717)

**Existing protections:** Input material IDs are validated and items have explicit pending state; the two insert statements still commit independently.

**Smallest improvement:** Insert the job and its items in one transaction. Before completing a job, verify its terminal counts agree with the persisted work set.

**Runtime/failure proof not performed:** Force the child insert to fail and assert the parent is rolled back. Also reject completion of an inconsistent job fixture.

### F06 · P2 · PDF replacement deletes the good copy before saving the new one

reuploadPdf validates the incoming bytes, deletes the current document directory, writes the replacement, then updates PostgreSQL. A disk-full error, process exit or database failure in this sequence can destroy the existing PDF or leave database metadata inconsistent with the file. Current replacement tests cover the successful path without disk or database failure injection.

**Evidence:** Source-confirmed failure ordering; disk/DB failures not injected. [src/server/api/routers/catalog-document.ts:327](../src/server/api/routers/catalog-document.ts#L327), [src/server/services/catalog-pdf-storage.ts:56](../src/server/services/catalog-pdf-storage.ts#L56), [src/server/services/catalog-pdf-storage.test.ts:88](../src/server/services/catalog-pdf-storage.test.ts#L88)

**Existing protections:** Incoming PDF bytes are validated and storage sanitizes paths and calculates checksums. These checks do not preserve the old file after deletion.

**Smallest improvement:** Write the replacement to a new immutable path first, commit its metadata, and remove the previous file only afterward. Clean abandoned files separately; preserve the previous version if any earlier step fails.

**Runtime/failure proof not performed:** Inject file-write and database-update failures and confirm the old document remains downloadable with its original checksum.

### F07 · P2 · Startup recovery can fail once and leave jobs stuck

initializeScheduler catches recovery errors and logs them, while schedulerStarted remains true. Later interval ticks poll queues but do not rerun resetStaleRunningJobs. A transient database error during startup recovery can leave previously running scrape/import/enrichment/profile-search jobs unavailable to queued-only claimers until another restart.

**Evidence:** Source-confirmed control flow; transient startup database failure not injected. [src/server/services/job-scheduler.ts:74](../src/server/services/job-scheduler.ts#L74), [src/server/services/job-scheduler.ts:152](../src/server/services/job-scheduler.ts#L152), [src/server/services/job-scheduler.ts:163](../src/server/services/job-scheduler.ts#L163), [src/server/services/job-scheduler.ts:1206](../src/server/services/job-scheduler.ts#L1206)

**Existing protections:** Startup recovery and transactional queue claims exist. Recovery errors are logged, but no retry gate protects later polling.

**Smallest improvement:** Gate polling on successful initialization and retry recovery with backoff. For stronger recovery, add worker ownership and renewable job leases; do not periodically reset every running job because active work must remain owned.

**Runtime/failure proof not performed:** Fail recovery once, restore the database connection, and prove stale jobs resume without restarting the application. Ensure healthy active jobs are not reset.

### F08 · P2 · SQL restore can continue after statement errors

The plain-SQL restore path invokes psql without ON_ERROR_STOP and then starts the application. psql normally continues after SQL statement errors, so shell set -e does not guarantee a valid restore. Operators can receive an apparently successful restart over a partially restored database.

**Evidence:** Source-confirmed psql invocation; no restore executed. [scripts/onprem-restore.sh:18](../scripts/onprem-restore.sh#L18), [scripts/onprem-restore.sh:35](../scripts/onprem-restore.sh#L35)

**Existing protections:** The script checks the backup path and uses shell `set -eu`. Those checks do not stop `psql` on statement errors or make app shutdown mandatory.

The script also ignores failure to stop the app at [scripts/onprem-restore.sh:16](../scripts/onprem-restore.sh#L16). Restore can therefore run while application and scheduler writes continue. This is part of the same unsafe restore boundary, not a separate finding.

**Smallest improvement:** Require app shutdown to succeed before restore. Use psql -v ON_ERROR_STOP=1 and make restore success explicit before restarting. Validate a backup by restoring it into an isolated database; where compatible, use a single transaction for plain SQL restore.

**Runtime/failure proof not performed:** Restore a fixture containing a failing statement and assert a nonzero exit and no app restart. Force app-stop failure and assert restore does not run. Test a real backup/restore round trip separately.

### F09 · P2 · Health checks cannot detect an unusable database or scheduler

/api/health always returns ok: true without checking PostgreSQL or scheduler initialization. Docker and Compose use that endpoint to report health and to gate Caddy startup. A server with broken database connectivity or failed job recovery can therefore remain healthy from the deployment system's perspective.

**Evidence:** Source-confirmed readiness contract; outage not simulated. [src/app/api/health/route.ts:5](../src/app/api/health/route.ts#L5), [compose.production.yml:62](../compose.production.yml#L62), [Dockerfile:55](../Dockerfile#L55)

**Existing protections:** The endpoint establishes HTTP liveness; Compose separately checks PostgreSQL container health. Neither establishes application DB access or scheduler readiness.

**Smallest improvement:** Keep a cheap liveness endpoint and add bounded readiness checks for database connectivity, expected schema readiness and scheduler initialization on surfaces that run jobs. Use readiness for rollout checks and report scheduler heartbeat/backlog separately.

**Runtime/failure proof not performed:** Disconnect the database or fail scheduler initialization and assert readiness fails promptly while liveness continues to respond.

### F10 · P3 · The in-app updater advertises a capability absent from the supplied image

BIDTOOL_ALLOW_IN_APP_UPDATES=true enables a service that spawns scripts/onprem-update.sh from the current directory. The prior standalone-build probe found that Next traces that entry script, but its sourced onprem-lib.sh helper is absent. That built script failed immediately. The runtime image and Compose also lack a supported host Docker control integration. The enable flag alone does not make this deployment capable of updating itself.

**Evidence:** Prior production standalone-build probe: the traced update script exits at line 6 because onprem-lib.sh is missing. Optional flag defaults off. [src/server/services/onprem-update.ts:10](../src/server/services/onprem-update.ts#L10), [src/server/services/onprem-update.ts:24](../src/server/services/onprem-update.ts#L24), [scripts/onprem-update.sh:6](../scripts/onprem-update.sh#L6), [Dockerfile:45](../Dockerfile#L45)

**Existing protections:** The optional update flag defaults off; the supported host-side script remains available. No fresh assembled-image capability check was run.

**Smallest improvement:** Keep the current supported host-side update command. Derive UI capability from an actual supported integration, or remove the dormant option. If in-app updates become a requirement, use a narrowly scoped host updater rather than broad Docker-socket access.

**Runtime/failure proof not performed:** Test capability reporting against the assembled runtime image, not only a mocked child-process spawn.

### F11 · P1 · Manual release tag can label artifacts built from another revision

**Trigger and impact:** Dispatch Release from a ref different from the requested `release_tag`. The input controls version labels, but checkout defaults to the dispatch ref and metadata uses `GITHUB_SHA`. Existing release assets can be overwritten with binaries from that other revision; a new release can target the dispatch SHA. Version and tag identity then cease to identify the tested source.

**Source evidence:** [release.yml:9](../.github/workflows/release.yml#L9), [default checkout :35](../.github/workflows/release.yml#L35), [version/SHA resolution :62](../.github/workflows/release.yml#L62), [Docker checkout :142](../.github/workflows/release.yml#L142), [asset clobber and target :372](../.github/workflows/release.yml#L372).

**Existing protections:** Tag syntax is validated and release concurrency is grouped by tag. These checks do not resolve the tag's commit or compare it with each job's checkout.

**Smallest improvement:** Resolve the requested tag once to an immutable commit, require it to exist, and use that SHA for every checkout and metadata field. Verify package/version agreement and require an explicit policy for replacing existing assets.

**Runtime proof not performed:** Dispatch against a deliberately mismatched branch/tag in a disposable repository; assert refusal or exact tag-SHA builds, including an existing-release case. No release was created or replaced.

### F12 · P2 · E2E configuration can reuse the operator's app and database

**Trigger and impact:** Run Playwright locally while a development server is already listening. It may reuse that server, while Material Profile tests override inherited environment with `.env.local` and directly insert/delete database fixtures. An intended test connection can be replaced, and browser/server and fixture connections can point at different data stores. Running these tests is not currently safe evidence of isolation.

**Source evidence:** [playwright.config.ts:13](../playwright.config.ts#L13), [.env.local override and connection at material-profile.spec.ts:10](../tests/e2e/material-profile.spec.ts#L10), [SQL inserts :136](../tests/e2e/material-profile.spec.ts#L136), [cleanup deletes :163](../tests/e2e/material-profile.spec.ts#L163).

**Existing protections:** Random fixture markers and cleanup constrain ordinary fixture deletion; CI does not reuse an existing server. Neither checks database identity or guarantees a disposable target locally.

**Smallest improvement:** Require a dedicated test DB variable and an explicit disposable-database guard, propagate that same connection to a newly started test server, and disable reuse for mutation suites. Do not override a test connection from `.env.local`.

**Runtime proof not performed:** Give the harness a development-shaped URL and an occupied port; prove it refuses both before any write. Then run browser tests against an isolated migrated database. No E2E run was attempted here.

### F13 · P2 · Workbook replacement invalidates work before parsing and commits partial state

**Trigger and impact:** Upload malformed workbook bytes or fail a database statement during replacement. Active profile searches are invalidated before parsing succeeds. The workspace update and old-item deletion are separate writes, so failure can leave a new workbook paired with old review items. This is a workspace-state defect distinct from F06's PDF file replacement.

**Source evidence:** [material-profile-workspaces.ts:1146](../src/server/services/material-profile-workspaces.ts#L1146) invalidates before decode/parse; [optional file cache :1176](../src/server/services/material-profile-workspaces.ts#L1176), [workspace update :1183](../src/server/services/material-profile-workspaces.ts#L1183), [item delete :1200](../src/server/services/material-profile-workspaces.ts#L1200).

**Existing protections:** The workspace must exist, parsing must yield a sheet, filenames are sanitized, and workbook bytes remain in JSON if disk caching fails. These do not make replacement atomic.

**Smallest improvement:** Parse and validate first. In one short transaction invalidate the old searches, update workbook state and delete old items, checking the expected workspace revision. Publish any optional cache through a new path after validation.

**Runtime proof not performed:** Invalid-file, delete-failure and concurrent-review tests against isolated PostgreSQL must preserve the previous workbook, items and active search state on failure.

### F14 · P2 · Rollback assumes unavailable tooling and passes a digest without a repository

**Trigger and impact:** Execute the configured rollback with web credentials and/or a populated image digest. It invokes `bunx` without setting up Bun. Image retagging prefers the bare digest, even though the workflow loads image and digest separately; `sha256:…` does not identify the registry repository. Rollback can fail before restoring the intended artifact pins.

**Source evidence:** [rollback.yml:23](../.github/workflows/rollback.yml#L23) begins the steps without Bun setup; [bunx :61](../.github/workflows/rollback.yml#L61), [digest-only source :70](../.github/workflows/rollback.yml#L70), [release manifest stores image/digest separately :324](../.github/workflows/release.yml#L324).

**Existing protections:** The pin must exist, commands use `set -euo pipefail`, and missing web credentials/build IDs cause a skip. They do not provision Bun or construct a valid image reference.

**Smallest improvement:** Set up pinned Bun and the required Docker tooling. Construct and validate `registry/repository@sha256:…` from the pinned image repository plus digest. Report skips separately from successful rollback.

**Runtime proof not performed:** Run command-contract fixtures and a disposable-registry retag, then a controlled rollback rehearsal. No runner, registry or Vercel action was executed.

### F15 · P2 · Release success does not prove artifact behavior or web promotion

**Trigger and impact:** A release passes source checks and packaging but an assembled artifact cannot run, or web credentials are absent. The workflow does not run packaged startup/readiness, browser or restore checks. The missing-credentials branch exits successfully with a canned production URL and `deployment_id=skipped`, which is then written into the manifest. Consumers can mistake a URL for proof that this version was promoted.

**Source evidence:** [source quality gates at release.yml:45](../.github/workflows/release.yml#L45), [successful web skip :109](../.github/workflows/release.yml#L109), [desktop asset presence :312](../.github/workflows/release.yml#L312), [manifest web fields :321](../.github/workflows/release.yml#L321). F11 covers source identity; this finding covers artifact verification and reported deployment state.

**Existing protections:** Builds, unit checks and required asset-file checks catch some failures; actual web promotion parses deployment output. These do not execute installed artifacts or establish that a skipped surface has this release.

**Smallest improvement:** Smoke-test the assembled on-prem image and extracted desktop packages with isolated data, expected versions and required files. Add browser/readiness and complete restore evidence. Encode each surface as deployed, skipped or failed; omit an unverified deployment claim when credentials are missing, or fail if that surface is required.

**Runtime proof not performed:** Break a required packaged file and omit web credentials in fixtures; prove gates fail or report an explicit skip. No fresh build, package launch, release or deployment was run.

### F16 · P2 · Restarting a partial create-all import duplicates committed materials

**Trigger and impact:** Stop the process after some products have committed but before their import job completes, then restart. Recovery requeues the whole import and the runner reloads all products. `create_all` always classifies them for insertion, so previously committed products are created again. This is replay safety, distinct from F07's recovery initialization failure.

**Source evidence:** [job-scheduler.ts:1220](../src/server/services/job-scheduler.ts#L1220), [reload and mode :609](../src/server/services/job-scheduler.ts#L609), [shop-product-importer.ts:295](../src/server/services/shop-product-importer.ts#L295), [material insertion :199](../src/server/services/shop-product-importer.ts#L199).

**Existing protections:** Progress and created material IDs are recorded; `match_existing` has lookup logic. `create_all` intentionally bypasses matching and recovery does not use persisted results as an idempotency boundary.

**Smallest improvement:** Persist a per-job product receipt with a stable product key and material ID in the same transaction as material creation; replay returns the receipt. Preserve deliberate create-all semantics across different jobs.

**Runtime proof not performed:** Terminate an isolated import after a committed item, restart twice and assert one material per job-product receipt with accurate terminal counts.

### F17 · P2 · Recent orphan Excel rows can be left processing under a completed job

**Trigger and impact:** Restart less than ten minutes after an Excel research row was claimed. Startup resets only older processing rows. Pending-only counting can return zero while recent orphan processing rows remain, and the scheduler marks the parent completed or awaiting review. Aging later does not repair that terminal parent through the startup-only reset.

**Source evidence:** [claim processing state at process-batch.ts:140](../src/server/services/excel-research/process-batch.ts#L140), [ten-minute reset :395](../src/server/services/excel-research/process-batch.ts#L395), [pending-only count :95](../src/server/services/excel-research/process-batch.ts#L95), [startup reset at job-scheduler.ts:152](../src/server/services/job-scheduler.ts#L152), [terminal decision :313](../src/server/services/job-scheduler.ts#L313).

**Existing protections:** Row claims are transactional and have processing tokens, start times and attempt counts. The age threshold protects recent work but does not establish whether its owner survived a restart.

**Smallest improvement:** Under the current single scheduler, recover rows owned by the prior process before polling. Require no pending or processing work before parent completion. If ownership expands, use renewable leases and reclaim only expired ownership.

**Runtime proof not performed:** Restart immediately after row claim; assert recovery and processing, and prove the parent cannot complete with any nonterminal row.

### F18 · P2 · Enrichment startup can overwrite cancellation with running

**Trigger and impact:** Cancel an enrichment job during the runner's awaited initial read, after its first abort check. The subsequent unconditional `running` write overwrites the cancelled state. The signal may later stop work, but the persisted cancellation has already been lost and the job can appear active or be recovered again.

**Source evidence:** [material-enrichment-runner.ts:655](../src/server/services/material-enrichment-runner.ts#L655) checks the signal before the read; [unconditional status write :667](../src/server/services/material-enrichment-runner.ts#L667), [later cancellation check :699](../src/server/services/material-enrichment-runner.ts#L699), [scheduler abort return at :709](../src/server/services/job-scheduler.ts#L709).

**Existing protections:** Abort controllers, per-item cancelled-state checks and scheduler completion checks exist. They do not guard this initial state transition.

**Smallest improvement:** Recheck the signal after the read and use a conditional status update tied to the claimed active state/owner. If it updates no row, stop. Keep cancellation terminal across runner and progress writes.

**Runtime proof not performed:** Place a barrier around the initial read, cancel, resume it and assert persisted status remains cancelled and no material work starts.

### F19 · P2 · Metadata normalization deterministically removes materialProfile

**Trigger and impact:** Save field locks or commit enrichment for a material containing profile provenance. The normalizer and builder reconstruct only their known fields and omit `materialProfile`; callers replace `metadataJson` with that result. Profile confidence, provenance and source details disappear even with one writer. F04 concerns concurrent stale writes; this failure requires no race.

**Source evidence:** [profile metadata producer at material-profile-workspaces.ts:274](../src/server/services/material-profile-workspaces.ts#L274), [normalizeMaterialMetadata at material-price-sources.ts:107](../src/lib/material-price-sources.ts#L107), [builder :148](../src/lib/material-price-sources.ts#L148), [field-lock persistence at material.ts:884](../src/server/api/routers/material.ts#L884), [enrichment persistence at material-enrichment-commit.ts:400](../src/server/services/material-enrichment-commit.ts#L400).

**Existing protections:** Normalization validates price sources, web enrichment and locks; the profile writer itself spreads existing metadata. The other writers do not preserve that profile field.

**Smallest improvement:** Add authoritative typed normalization/serialization for profile metadata and preserve unrelated metadata in focused write operations. Make field-lock saves change only locks. Do not rely on concurrency fixes to repair this deterministic loss.

**Runtime proof not performed:** Round-trip metadata containing profile provenance through normalization, lock save and enrichment commit; assert the profile survives unchanged. This pass inspected source without executing that regression test.

## Current and target module boundaries

| Boundary           | Current ownership                                                                                             | Smallest target within the existing stack                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI and transport   | Next.js UI, tRPC validation and routers; some domain writes in routers                                        | Keep Next.js/tRPC. Routers validate inputs and translate errors; services own material/workspace decisions.                                                       |
| Material writes    | CRUD, price-source procedures, profile saves and enrichment write the same row                                | Focused material operations own locks, metadata preservation, revision checks and short Drizzle transactions (F04, F19).                                          |
| Workbook lifecycle | `material-profile-workspaces.ts` combines parsing, review persistence, export packaging and folder operations | Separate workbook I/O, atomic review/workbook persistence and export operations behind the existing facade (F13). File length alone is not a defect.              |
| External content   | PDF, search, BidWinner and scraper callers each choose policy                                                 | One bounded public-content HTTP implementation with explicit per-integration policies (F02, F03); preserve configured internal AI/SearXNG.                        |
| Durable jobs       | One embedded scheduler, PostgreSQL queues, local controllers/events                                           | Keep one scheduler owner; atomic enqueue, replay receipts, guarded transitions, recoverable ownership and initialization gate (F05, F07, F16–F18).                |
| Files and delivery | Local storage, Compose, shell helpers and release workflows                                                   | Persistent artifact roots, staged replacement, complete backup sets, truthful capabilities and verified immutable release artifacts (F01, F06, F08–F11, F14–F15). |

Next.js, tRPC, Drizzle, PostgreSQL, Bun and Electron fit this single-user dashboard. PostgreSQL already provides transactional queue claims and `FOR UPDATE SKIP LOCKED`; adding a broker or a second scheduler would add ownership and event-delivery obligations. First repair the existing state transitions. Extract a worker process only when measured contention or crash isolation requires it, with leases and cross-process event delivery in place before more than one scheduler can run.

[Option B's Vite/Hono topology](./architecture-option-b/01-target-architecture.md) and [migration roadmap](./architecture-option-b/08-migration-roadmap.md) are proposals. A transport/runtime/workspace rewrite would not itself fix file persistence, lost metadata, replay duplication or release identity. Defer it while these failures can be addressed through existing services. Keep the intentional no-auth, single-user model; document loopback/trusted-LAN exposure rather than adding sessions or ownership columns.

Measure representative large BOQs before changing query shapes or process topology: response bytes, DB time, heap, refetch latency and UI responsiveness. This review establishes no performance regression from file size or payload size alone.

## Delivery plan and research

The dedicated [remediation plan](./architecture-remediation-plan.md) maps all F01–F19 across R0–R8 and R10–R14, with dependencies and acceptance evidence. The [T3 Code and PandaCode research](./architecture-research-t3code-pandacode.md) supplies pinned upstream examples and limits; upstream tests do not verify BidTool fixes.

The plan defines this staged delivery:

1. R0 isolates the database and browser server before mutation tests (F12). Failure injection and controlled transports remain independent of operator data.
2. R1–R3 address persistent files, fail-closed restore including app stop, bounded HTTP across all callers, and safe PDF replacement (F01–F03, F06, F08). R11 owns atomic workbook replacement (F13), with storage support from R1.
3. R4–R6 cover atomic enqueue (F05), material preservation and races (F04, F19), startup recovery/readiness (F07, F09), orphan-row completion checks (F17) and guarded cancellation (F18). R14 owns import replay safety (F16) and precedes R6's automatic recovery of interrupted imports.
4. R7 retains supported host-side updates and truthful capability reporting (F10). R10 pins release checks and builds to the tag commit (F11); R12 repairs rollback tooling and image references (F14); R13 verifies artifacts and reports actual deployment outcomes (F15). R8 consolidates cross-system verification for all findings. Complete these gates before relying on unattended releases.

## Existing strengths and checks

Typed tRPC/Zod boundaries, Drizzle schema reuse, PostgreSQL queue claims, transactional profile-search/review paths and enrichment item locking are useful foundations. Storage already validates filenames, path containment, checksums and PDF headers. Preserve these protections while changing lifecycle behavior. Web and Electron share domain logic.

Evidence is separated by provenance:

| Evidence                                               | Result and limits                                                                                                                                                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fresh source pass in this consolidation                | Read the cited code/workflows; verified failure ordering and existing guards. Checked all local Markdown link targets and cited line bounds, and uniqueness/completeness of F01–F19. No application tests run by this publishing worker.               |
| Completed verification worker, reported for this audit | `bun run typecheck --incremental false`, `bun run lint`, `bun run test --no-cache`: all exit 0. Reported 70 test files passed, 2 skipped; 513 tests passed, 5 skipped. This is supplied worker evidence, not commands rerun by this publishing worker. |
| Completed verification worker, shell syntax report     | `sh -n` on `scripts/onprem-backup.sh`, `scripts/onprem-restore.sh`, `scripts/onprem-update.sh`, `scripts/onprem-lib.sh` and `docker/entrypoint.sh`: passed. Syntax does not prove restore/upgrade behavior.                                            |
| Prior audit only                                       | `bun install --frozen-lockfile --ignore-scripts`, `bun run check`, `bun run test`, `bun run build` passed. It recorded local Bun 1.4.0 versus repository/CI 1.3.11. These are historical results, not a fresh build for this pass.                     |
| Prior probes only                                      | Standalone updater invocation failed at line 6 for missing `onprem-lib.sh`, before Docker/update execution. Mocked PDF fetch accepted a localhost URL and observed early timer cleanup; no network request was sent. Neither probe was repeated.       |

No fresh build, browser/E2E run, PostgreSQL migration/race/fault injection, container upgrade/backup/restore, Electron launch, release/rollback rehearsal, external scraping, CVE analysis or performance benchmark was performed in this consolidation. Passing source checks and unit tests does not establish these runtime properties. No application source, configuration, lockfile, production data, commit or deployment was changed by this documentation assignment.
