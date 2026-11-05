# CI/CD

The workflows validate one immutable source commit and assemble artifacts before publication. They do not establish that the architecture remediation is complete. PR #29 stays draft pending native/browser/restore, protected-delivery and actual tag-dispatch evidence.

## Triggers and job graph

- A PR targeting `main` and a push to `main` call `validate.yml` with the event's full SHA (the PR merge commit for `pull_request`). Superseded CI runs are cancelled.
- An existing stable `vX.Y.Z` tag push or manual **Release** dispatch resolves that remote tag to a full commit first. Lightweight and annotated tags work; missing tags, tags pointing at non-commits and prereleases fail. Stable-only matches the current pins reader's version ordering.
- Release calls the same `validate.yml` with the resolved SHA and tag version. All subsequent checkouts explicitly use that SHA. The initial resolver checks out the workflow event SHA only to bootstrap the resolver; a dispatch at B can therefore build tag A. Tags predating these scripts fail closed and need a reviewed backport rather than a fallback to B.

```text
PR/main SHA ------------------------> validate
release event -> resolve tag SHA ---> validate
                                       |-- quality: frozen install, lint, typecheck,
                                       |            unit tests, Next build, metadata/CLI
                                       |-- integration: isolated PG16 migrations
                                       |                and coordinated transactions
                                       |-- runtime: assembled image, disposable PG16,
                                       |            migrations, restart, HTTP liveness
                                       `-- bundle: contents, image version, SHA256
release: validate -> Windows/Linux desktop assembly and checks
                  -> verify all downloaded artifact evidence
                  -> production environment approval
                  -> reverify source/artifacts and build Vercel output
                  -> push verified image -> deploy Vercel -> manifest/pins proposal
                  -> create GitHub Release -> promote image latest
```

The shared `integration` job retains R0's PostgreSQL 16 service and `bun run test:integration` command. It checks out `inputs.source_sha`, asserts `HEAD`, installs the frozen lockfile and runs the guarded migration/concurrent-connection fixtures with a validated `BIDTOOL_TEST_DATABASE_URL`. GitHub allocates the host port; only the test step receives the loopback URL for role `bidtool_test` and database `bidtool_test_ci`. The job has a 15-minute timeout and read-only token. Both CI and release call this same workflow; release desktop/artifact/publication jobs require its successful completion, including integration. The PR's required-check settings must also include this new check once its actual displayed name is reviewed; this source change does not configure branch protection.

The runtime gate creates only uniquely named Docker containers, an internal network and a data volume. PostgreSQL and the app have no host port bindings. Cleanup names only that invocation's resources; it does not use production Compose or prune Docker. A second migration run and app restart must succeed. The SQL migration count is compared with the checked-out journal. `/api/health` proves HTTP liveness, not scheduler readiness or application correctness.

Desktop gates check both staged package versions, server/static/public files, absence of packaged `.env` files, expected installer names, updater version and SHA512, and Windows blockmap presence. Evidence records artifact sizes and SHA256 with the full source SHA. It is checked again after artifact download and before publication. These are assembly checks, not installed NSIS/AppImage, UI or restore proof. The on-prem archive must include the install/update/backup/restore helpers, Compose, Caddy, pins and versioned image template. File presence does not establish backup completeness.

## Observed CI evidence

Reviewed on 2026-11-03: [CI run 41409160797, attempt 1](https://github.com/iouthnamain/bidtoolv3/actions/runs/41409160797) completed successfully on 2026-11-02. It is attached to PR head `45a90419c40c0ab0ae6c858d2796d06115f174a2` and checked out the PR merge commit `3ba78090a73c5a07c2ede16c2d6fca708ee2020d`. Both commits have tree `c1107399966a7a440a4e5d6954e8b128869f5fa8`; the artifact source identity remains the merge commit. This is PR-event evidence, not a tag-release dispatch.

- [Quality job 125157980201](https://github.com/iouthnamain/bidtoolv3/actions/runs/41409160797/job/125157980201): frozen Bun 1.3.11 install, lint, typecheck, 533 tests passed / 5 skipped, Next build and current metadata/CLI validation passed. Its `quality-evidence` manifest is a schema fixture with example URLs/digests, not a published release manifest.
- [Runtime job 125158951226](https://github.com/iouthnamain/bidtoolv3/actions/runs/41409160797/job/125158951226): built the actual Dockerfile image, then passed `image-smoke.sh` at `2026-11-02T07:59:48Z` for the merge SHA. The script required a disposable PostgreSQL 16 database, entrypoint migrations, migration-count equality with the checked-out journal, embedded version/package version/build metadata and OCI revision, expected runtime files and exclusion of four root `.env` variants. It reached HTTP liveness before and after a second migration invocation and app restart. The saved image and receipt were uploaded as [artifact 13125012534](https://github.com/iouthnamain/bidtoolv3/actions/runs/41409160797/artifacts/13125012534), with GitHub ZIP SHA256 `94b945f91ca4798b558953aa8964a60eedbd9d512f7f4856b6e581a7879691c2` and retention through `2026-11-05T08:00:01Z`. The ZIP digest is not a registry image digest. The downloaded Linux/amd64 image tar independently matched its receipt: 736,194,048 bytes, SHA256 `9ca398aba447b080216ad5f55dfbef1a03ee8d6b22e15a40b4f0bcb9a385358d`. Archive inspection confirmed the revision/version labels, app/package version `0.1.0` and build metadata `0.1.0+onprem.3ba7809` without launching it locally.
- [Bundle job 125158951232](https://github.com/iouthnamain/bidtoolv3/actions/runs/41409160797/job/125158951232): built and checked the archive and uploaded [artifact 13125155906](https://github.com/iouthnamain/bidtoolv3/actions/runs/41409160797/artifacts/13125155906). Its downloaded receipt identifies the merge SHA, version `0.1.0`, archive size 7,256 bytes and SHA256 `53ac30654d9c8c55901538c7ceab5281bdf278f30ef4bcfac0999868ea7581a9`; it explicitly says restore was not verified.

These observations replace the initial lack of image-startup evidence. They do not prove concurrent-project cleanup, scheduler readiness/recovery, browser behavior, document downloads, persistent upgrade, complete restore, native desktop packaging/UI, environment protections or production release/rollback. The Docker build emitted `scheduler_init_failed` and `scheduler_poll_failed` against its placeholder database; those logs are an R6/R8 handoff, not successful recovery evidence. The smoke's cleanup trap ran, but removal errors are suppressed and resource absence was not independently asserted. Vercel and Preview Comments checks also passed; an automatic PR preview does not exercise the protected release workflow.

## R0 integration verification

R0 [PR #28](https://github.com/iouthnamain/bidtoolv3/pull/28), reviewed head `38c56faf1ff0c40626d5940c294580d2a50c72a3`, was merged by the coordinator as `4eb0121d34bade948a2e587d4746c2f222e5ecc1`. That merge was brought into PR #29 through a normal branch merge. The overlapping `ci.yml` job moved into `validate.yml`; R0's fixtures, scripts, package command, Playwright config and Vitest integration exclusion remain unchanged.

Local period-4 verification used Bun 1.3.11 and a new temporary PostgreSQL 16.15 cluster listening on an allocated loopback port, with a uniquely named `bidtool_test_r10_p4_<suffix>` database and role `bidtool_test`. `bun run test:integration` passed both tests: migrations provisioned the required app schema, and two independent connections coordinated transactions against an owned fixture row. Post-test checks found 41 migration rows and no remaining `fixture_%` schemas. The owned cluster was stopped and removed. These tests prove the R0 foundation, not all planned domain failure/concurrency cases or browser E2E. The combined unit suite passed 561 tests / 5 skipped. The earlier runner evidence above predates this integration. The first hosted integration check, [job 125813741911 in run 41605366586](https://github.com/iouthnamain/bidtoolv3/actions/runs/41605366586/job/125813741911), reports success for PR head `0f03dbb67ab17d45c265f8002c0b6fae614ce39f`. GitHub withheld its logs while that run was still in progress, so this records the job conclusion without asserting its checkout SHA or test count from runner logs.

## Local checks

Use Bun **1.3.11**, matching `packageManager` and every workflow. No live database is needed for the source suite:

```sh
bun install --frozen-lockfile
bunx vitest run tests/ci-source.test.ts tests/ci-artifacts.test.ts src/lib/release-manifest.test.ts
bun run check
bun run test
DATABASE_URL=postgres://placeholder:placeholder@localhost:5432/placeholder SKIP_ENV_VALIDATION=1 bun run build
bash -n scripts/ci/image-smoke.sh
actionlint
```

Run `bun run test:integration` separately with `BIDTOOL_TEST_DATABASE_URL` set to an owned disposable PostgreSQL 16 database on loopback, using role `bidtool_test` and database name `bidtool_test_<suffix>`. The guard rejects an absent/unsafe URL and never falls back to `DATABASE_URL`. R0's launcher and identity checks remain the prerequisite for mutation browser tests; merging this workflow does not run or establish browser acceptance.

The bundle test runs the real packager against inputs copied into a temporary directory. It never replaces local release outputs or runs backup/restore/install helpers. To reproduce the runtime gate on a disposable Docker host:

```sh
export SOURCE_SHA=$(git rev-parse HEAD)
export BIDTOOL_APP_VERSION=0.1.0
export BIDTOOL_BUILD_METADATA="$BIDTOOL_APP_VERSION+onprem.$(git rev-parse --short=7 HEAD)"
docker build -t bidtool-ci:local \
  --label "org.opencontainers.image.revision=$SOURCE_SHA" \
  --build-arg "BIDTOOL_APP_VERSION=$BIDTOOL_APP_VERSION" \
  --build-arg "BIDTOOL_BUILD_METADATA=$BIDTOOL_BUILD_METADATA" .
IMAGE_REF=bidtool-ci:local bash scripts/ci/image-smoke.sh
```

Do not point mutation tests at development or operator databases. This smoke uses its own fixture credentials and internal PostgreSQL container. It does not load host `.env` files or call live BidWinner/AI/shop services.

## Required repository configuration

These are operator setup steps, not changes made by this PR:

1. Create the GitHub **production** environment before enabling delivery. Require reviewers, prevent self-review, disable administrator bypass where supported, and restrict deployment branches/tags to the reviewed release policy. Environment protection is an external prerequisite; declaring `environment: production` alone does not guarantee approval rules exist.
2. Store `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` as production environment secrets. All three are required for a full release and rollback. Missing credentials fail before any image or web publication. There is no placeholder deployment URL or successful skip.
3. Allow the production jobs' `GITHUB_TOKEN` to write repository releases and that repository's GHCR package. Other jobs have only `contents: read`; checkout credentials are not persisted. Set required PR checks to the reusable workflow's quality, isolated PostgreSQL integration, runtime and bundle jobs, using their actual names from the first reviewed run.
4. Keep protected `main`, review requirements and tag creation rights consistent with the release policy. Review the workflow definition at the dispatch ref as well as the target source. Do not approve an unreviewed dispatch workflow merely because its target tag is trusted.
5. Rehearse on disposable infrastructure and record environment protection, native packages, Vercel CLI and registry evidence before approving production delivery. No remote settings or secrets are configured automatically.

Release and rollback share `bidtool-production-delivery` concurrency with cancellation disabled. GitHub concurrency permits only one running and one pending run and may replace an older pending run; it is not a FIFO delivery queue. Quality jobs use timeouts and a read-only token. The production jobs request write permission only for the operations they perform.

## Manual release

After merging reviewed code and preparing an authorized existing stable tag, dispatch **Release** with that tag from the reviewed workflow ref. A tag push also starts Release. Do not dispatch just to test this PR.

Review quality, isolated PostgreSQL integration, runtime, bundle, both desktop artifacts and their evidence before approving the production environment. Desktop builds set `BIDTOOL_PACKAGE_VERSION`, `BIDTOOL_APP_VERSION`, `BIDTOOL_DEPLOYMENT_SURFACE` and platform build metadata explicitly; the desktop preparation script uses build metadata for the staged package version. The image embeds the version and metadata and labels the full revision. The release manifest carries optional, backward-compatible `commitSha`; new pipeline manifests always set the full SHA.

Publication re-fetches the remote tag and checks `HEAD` against the resolved SHA before external writes. It publishes the saved, tested image without rebuilding. Vercel CLI is pinned to 65.9.0; its prebuilt output must exist before image push or deployment. The successful deployment is inspected for READY state, real ID/URL and the exact source/version metadata; only those fields are retained as evidence. Existing release assets and version images are never intentionally overwritten. A failed run may leave a version image or a deployed web build: cross-service publication is not atomic. Investigate partial state and prepare a new reviewed version; do not delete/rewrite tags or clobber assets to force a rerun.

Download the **release-pins-proposal** artifact after successful publication, review `manifest.json`, `web-deployment.json` and `pins.json`, and open a separate PR applying the proposal to `releases/pins.json` against current `main`. Reconcile any pins added since the tag. The workflow never commits or pushes pins to `main`. Consumers continue using the reviewed current pins until that PR merges. The `latest` image tag moves after GitHub Release creation; customer hosts and desktop installations do not change automatically.

## Manual artifact rollback

Dispatch **Rollback** from a reviewed ref containing the intended `releases/pins.json`; specify a pinned stable version. Approve its production environment after reviewing the forward-only schema compatibility. The job sets up Bun and Docker Buildx, validates a real Vercel deployment ID and constructs `ghcr.io/<this repository>@sha256:<64 hex>` from the image repository plus digest. It rejects another repository, a bare/short digest, conflicting digest coordinates and a historical `skipped` web pin.

Both targets are inspected before promotion. It promotes the pinned Vercel deployment and retags the pinned image digest as `latest`. A separate reviewed pins PR is needed to change the update feed. It does not restore customer bytes, change installed desktop versions, run host updates or reverse database migrations. If the second promotion fails after the first, report the partial result and investigate before retrying.

## Integration handoffs and remaining acceptance

### R10 source acceptance dry run

`R10 source acceptance` is a read-only workflow that runs `scripts/ci/release-dry-run.ts`. The harness parses the checked-in release and reusable validation workflows, checks that the resolved full SHA reaches every checkout and that quality gates remain upstream of artifact verification and publication, then runs the real source resolver against temporary Git repositories. It records tag A resolved from a dispatch at B and fails for missing, non-commit, moved, or wrong-checkout identities. It never creates a shared tag, calls a release or deployment command, or changes repository settings.

Run the same proof locally with `bun run scripts/ci/release-dry-run.ts`.

- **R0 / PR #28:** merged and integrated into `validate.yml` as a required exact-source job for both callers. Its package command/config/fixtures and owned E2E app/database identity checks are preserved. Local PostgreSQL migration/connection tests passed, and the first shared GitHub service job reports success; detailed runner logs remain to be collected. Extend its test suite with the planned domain failure/concurrency cases as those fixes land.
- **R8:** extend the reusable gate with controlled browser, transport/filesystem failures, recovered jobs, persistent upgrade/complete restore and extracted desktop-server readiness/document download outside the checkout. Clear `NODE_PATH` and disable global module lookup. Run native NSIS/AppImage/UI and writable-data-path checks on supported runners. Prove two smoke projects coexist and cleanup of one leaves the other/development intact. Current smoke isolates resources by construction but has no recorded concurrent runtime proof. Add a reviewed SearXNG pin in its assigned scope.
- **R12:** rollback tooling/coordinate source fixes are included here; disposable-registry retag and controlled Vercel rollback rehearsal remain unverified. Existing historical pins with short placeholder digests cannot pass the new gate.
- **R13:** assembly receipts, checksum validation, saved-image delivery and fail-closed web credentials are included. Complete installed/extracted-artifact runtime, browser/restore and deployment-observation evidence. A file receipt or metadata label must not close F15.
- **R10 / F11:** temp-Git regression tests establish local source-resolution behavior. A real dispatch at B targeting A with runner artifacts and moved-tag failure evidence is still required. No workflow dispatch was performed to manufacture that proof.

The original audit findings stay open until their required runtime evidence is reviewed. On-prem remains a single-user no-auth deployment for loopback or a trusted LAN; this pipeline adds no authentication or network-boundary guarantee.
