# Durable files, backup and restore (R1)

Implementation for [issue #15](https://github.com/iouthnamain/bidtoolv3/issues/15), based on merged R0 `4eb0121d34bade948a2e587d4746c2f222e5ecc1` / reviewed fixture head `38c56faf1ff0c40626d5940c294580d2a50c72a3`. F01 and F08 remain open pending the runtime evidence below. This document does not authorize an upgrade, restore or deployment.

## Storage contract and handoff

`src/server/services/data-root.ts` resolves `BIDTOOL_DATA_DIR`, defaulting to `<cwd>/data`. The catalog, research and profile services own their files under `catalog-pdfs`, `excel-research`, and `material-profiles`.

| Surface | Default | Precedence and limits |
| --- | --- | --- |
| Source Node server | `<project>/data` | Explicit directory override, then data-root subdirectory |
| On-prem | `/app/data` | Named application volume; Compose project and PostgreSQL volume unchanged |
| Bundled Electron | `<userData>/data` | Explicit `BIDTOOL_DATA_DIR` wins; passed only to the bundled child |
| Electron remote mode | Server's configured directory | No desktop file copy or local server start |
| Serverless profile cache | `<tmp>/bidtool/material-profiles` | Existing explicit profile directory wins; temporary cache and DB workbook fallback remain |

For research and profiles, existing operational settings retain **environment > database > default** precedence. A complete backup reads effective settings and the old container environment. An out-of-root server-managed path fails the backup; it is never silently omitted. Move and verify such data during a separately planned maintenance window before changing its setting. Nested directories under the durable root are supported. Symbolic links and special files fail verification. Secret `.env` files must live outside the data root.

Operator-selected `excel_workspaces.output_dir_path` destinations are external outputs. The manifest lists them with `included: false`. Copy them separately if required; their existence is not a complete-backup prerequisite. The profile directory setting is also used by the existing workbook cache and therefore remains server-managed.

Handoff for parallel remediation packages:

- **R2:** keep catalog root resolution through `resolveStorageDirectory`; networking remains unchanged here. No R2 HTTP safety claim is made.
- **R3:** catalog relative paths and returned metadata remain unchanged. Atomic PDF publication and deletion policy remain R3's responsibility.
- **R11:** profile upload publication, transactions and cache replacement are unchanged. Old absolute `.../data/material-profiles/...` workbook paths can fall back to the relocated root when the original is absent; the DB-backed workbook fallback remains. Retain this read compatibility when introducing versioned workbook paths. If a future format changes stored paths/settings, extend the backup reference inventory and version the manifest protocol before release.

## Operator prerequisites

Use a trusted Linux/POSIX operator host with Docker Compose v2 (`config --format json`, `up --wait`) and **Node.js 20+**. No additional Node packages are required by these scripts. Run from the installation directory. `BIDTOOL_ONPREM_ENV_FILE`, `BIDTOOL_ONPREM_COMPOSE_FILE`, `BIDTOOL_ONPREM_PROJECT` retain their meanings. Use an absolute `BIDTOOL_BACKUP_DIR` outside container files and application volumes; relative values resolve against the caller's working directory.

Only the app owns the embedded scheduler and file/DB writes. Stop any additional manual writers for the maintenance window. Scripts serialize through a project lock inside the backup directory; a crashed script leaves a lock requiring operator inspection. Do not remove another running operation's lock.

## Complete backup

```sh
sh scripts/onprem-backup.sh
```

The script discovers the old container, records its immutable image ID and checks file-copy space. For a running installation with no data directory yet, preflight creates the empty directory before stopping. It refuses a mismatch between the old app database target and the effective bundled PostgreSQL configuration before stopping. After a successful `compose stop app`, it reads the schema ledger, effective settings and file references, checks database staging space, copies the stopped container's data root, and makes a PostgreSQL custom dump. A stopped legacy container whose root is missing needs manual empty-directory preparation; a copy failure is fatal.

A published `bidtool-<id>.bundle/` contains:

- `manifest.json`: format `bidtool-complete`, version `1`, image ID, app version when present, full migration ledger, effective roots, previous mounts, file references and external outputs.
- `database.dump`: custom dump, SHA-256 recorded in the manifest; `pg_restore --list` must succeed.
- `files/`: complete data-root tree, relative names, directory inventory, file sizes and SHA-256 checksums.

Referenced PDFs and research files must match their DB size/checksum metadata when present. Referenced profile workbooks must exist inside the effective tree, even if a DB fallback also exists. Missing or mismatched references fail the complete-backup check and identify the path.

Only verified output is renamed from `.incomplete-*` to `.bundle`. Failure retains incomplete evidence and returns nonzero. Standalone backup resumes the app only after a successful backup and only if it was running beforehand. It never starts caddy, PostgreSQL or unrelated services. A failed backup leaves the app stopped.

Keep the bundle intact as a directory. Copy it with permissions preserved to separate recovery storage. Checksums detect corruption; they do not authenticate an untrusted bundle. Secret environment files are not included. The database dump itself can contain configured application secrets, so restrict access to the bundle.

## Existing-container upgrade

Do **not** run `compose up` with the new mount before extracting the old container's files: the mount hides those bytes.

After establishing that the target image supports the installed schema:

```sh
BIDTOOL_IMAGE_TAG=0.2.0 sh scripts/onprem-update.sh --schema-compatible
```

`--schema-compatible` is the operator's explicit assertion backed by reviewed release/schema evidence; the script cannot infer safe downgrade compatibility. Use a reviewed version, not the example version blindly. Append the compatibility flag to any copied UI command only after that review; command generators outside this storage scope are unchanged. Missing the flag fails before stopping the app. The old `BIDTOOL_UPDATE_BACKUP=false` bypass is no longer supported: every update requires a complete pre-upgrade backup.

The script stops the existing app, publishes its complete bundle **before any recreation**, pulls the target image, and requires the target effective roots to match the saved roots. It creates a uniquely named volume, checks destination free space, refuses a nonempty destination, copies and verifies every included file, and selects that volume in the customer env. It pins the application image to the locally resolved immutable image ID. Subsequent updates need a new explicit `BIDTOOL_IMAGE_TAG` (or an operator-reviewed image setting); Docker cannot pull a bare local image ID from a registry.

Only then does it recreate the app, wait for its Compose healthcheck and probe liveness. The complete host-side bundle and prior application volume remain; the old container may be replaced once its export is safe. PostgreSQL's existing volume is not renamed or removed. Migration failure before activation can resume only the previously running old app. Failure after activation attempts to stop the app and retains all recovery data. There is no automatic volume deletion, SQL downgrade or rollback.

Liveness does not prove downloads or job recovery. After the update, download representative uploaded/generated PDFs and research files through the actual application, compare checksums against metadata, and exercise a workbook/profile read. Keep the prior bundle and volume until this succeeds. Do not declare F01 closed from script output alone.

## Complete restore

Prepare a separate fresh stack or a stopped installation using the **exact image ID in the manifest**, with matching effective directories and PostgreSQL 16. Make the recorded image available locally (pull its matching immutable registry digest or load a trusted saved image), confirm `docker image inspect` returns the manifest image ID, and set `BIDTOOL_APP_IMAGE` accordingly. Bundle verification rejects a different image before stopping anything. This prevents silently starting an older, incompatible image over restored schema.

```sh
sh scripts/onprem-restore.sh /recovery/bidtool-example.bundle
```

The script verifies dump/files/references before mutation and requires app stop to succeed. If a prior app exists, it captures a complete recovery bundle from that stopped installation before recreation. A fresh PostgreSQL service with no app container is supported. It restores into an empty `bidtool_stage_<id>` database with `pg_restore --exit-on-error --single-transaction`, re-reads and compares schema/settings/references with the manifest, then initializes and checksum-verifies a new volume.

Activation selects the new volume, pins the exact recorded image, and renames the old database to `bidtool_previous_<id>` while moving staging to the configured DB name. Both renames run in one transaction from the maintenance database. Other connections to either database cause activation to fail; do not terminate unknown sessions automatically. The old database, original file volume or exported bundle, and staged resources remain available for recovery. No previous data is automatically dropped.

On any restore failure, leave the app stopped. A failed post-activation health/start check triggers another stop attempt; if that also fails, the error explicitly says stopping could not be confirmed. Inspect the error and retained resources before any manual start. If the customer env already selects the staging volume, restore the recorded prior volume selection only together with the matching prior database and schema-compatible image. For a legacy container without a mount, recover its files from the pre-restore bundle. Never start an app over a mixture of old DB and new files. Retained database names and volume names are printed by the script; the bundle records prior mounts and image.

## Legacy DB-only recovery

Old `.dump` and `.sql` files are recognized only with explicit selection:

```sh
sh scripts/onprem-restore.sh /recovery/old.dump --database-only --schema-compatible
sh scripts/onprem-restore.sh /recovery/old.sql --database-only --schema-compatible
```

Use trusted PostgreSQL dumps only. SQL uses `psql -X -v ON_ERROR_STOP=1 -1`; custom dumps use fail-fast, single-transaction `pg_restore`. Both restore into staging before activation. SQL/custom restore errors return nonzero and cannot start the app. Schema inventory must be readable before activation.

A successful DB-only activation still **leaves the app stopped** and reports the number of file references whose bytes are unavailable. Restore and verify those files separately before manually starting the matching image. A DB-only recovery is never reported as a complete restore. Establish schema compatibility independently before passing the flag.

## Desktop migration and the first upgrade

Bundled child startup detects `<standalone working directory>/data`, copies it into a staging directory next to `userData/data`, verifies file names/sizes/SHA-256, then renames it into place. The original stays intact. A nonempty conflicting destination blocks startup. A completion record outside the data tree allows later starts to use modified live files without copying stale legacy files again. A copy/checksum failure retains staging and the original and prevents child spawn. Explicit root/directory settings retain precedence; migrate any explicit directory inside disposable application resources manually before an installer removes it.

Before a future updater install, the shell waits for the bundled child to exit before checking migration and calling the installer. Remote-server mode skips this entirely. Migration runs with no local child filesystem writers.

**An already-installed older binary cannot run code it does not contain.** Before the first upgrade to this R1 implementation, close that old desktop app and export its legacy standalone `data` directory to safe storage outside application resources. Preserve its database and configuration separately. Rehearse restoring that export to `<userData>/data` before allowing the old installer resources to disappear. Native installer evidence is required to validate this transition; startup unit tests cannot prove it. A previously removed legacy directory cannot be recovered by this code.

## Evidence and open findings (2026-11-03)

The scoped fake Docker fixture extends merged R0 and operates only on temporary directories. It records commands and simulates container file copies, PostgreSQL outputs and new volume contents; it does not use a Docker daemon, database, external website or paid AI service. Desktop function tests use temporary directories and a mocked shell; they do not launch a packaged app.

Observed validation on the final implementation tree:

| Command | Result |
| --- | --- |
| `bun install --frozen-lockfile` | Passed; lockfile unchanged |
| `bun run test --no-cache` | 78 files passed, 2 skipped; 572 tests passed, 5 skipped |
| `bun run test tests/fixtures/remediation/storage.test.ts tests/fixtures/remediation/restore.test.ts tests/data-root.test.ts tests/desktop-data-root.test.ts tests/storage-consumers.test.ts src/server/services/catalog-pdf-storage.test.ts` | 6 files, 42 checks passed |
| `bun run typecheck --incremental false` | Passed |
| `bun run lint` | Passed |
| `DATABASE_URL=postgresql://bidtool_test:fixture@127.0.0.1:1/bidtool_test_build SKIP_ENV_VALIDATION=1 NEXT_TELEMETRY_DISABLED=1 bun run build` | Passed source assembly; scheduler probes logged expected connection refusals to the isolated non-listening fixture target. No DB/runtime proof |
| `sh -n scripts/onprem-lib.sh scripts/onprem-backup.sh scripts/onprem-restore.sh scripts/onprem-update.sh` | Passed |
| `node --check electron/main.cjs` and `git diff --check` | Passed |

Full-diff review fixed exported old image/volume values overriding the rewritten env file, added Compose volume ownership labels, and rejected mismatched app/database targets before stop. The fixtures also caught copy-to-existing-directory behavior and migration retry handling; both were corrected before the final passing runs.

Still required before F01/F08 closure or release approval:

- Real previous-image upgrade: uploaded/generated PDFs, research originals/enriched workbooks/reports, and profile files retain metadata and SHA-256 after container replacement.
- Real PostgreSQL 16 complete restore into a fresh isolated stack; actual SQL/custom restore failure and database activation/retention behavior.
- Real image permissions, named-volume initialization, Compose parsing/health waiting and document downloads through the assembled runtime.
- Native desktop startup and updater rehearsal on supported Windows/Linux installers, including legacy-resource preservation before the first R1 install, userData writes, explicit-directory precedence and remote mode.

Docker is unavailable in the implementation environment; this unchanged blocker was not repeatedly retried. Runtime, restore and native claims remain unverified. No production/customer data was accessed, no workflow dispatched, and no release or deployment performed. R8/R13 should collect the actual runtime/artifact evidence; this handoff does not edit their tasks.
