# Lessons from T3 Code and PandaCode for BidTool

Provenance refreshed on 2026-11-02; the saved audit was checked against BidTool `60a6f3eb981c268b95b1e223417b1819638b053f`. This note explains the upstream evidence behind the [implementation plan](./architecture-remediation-plan.md). Application fixes remain proposed.

## Sources and scope

The repository names resolve to [pingdotgg/t3code](https://github.com/pingdotgg/t3code) and [aicodeking/pandacode](https://github.com/aicodeking/pandacode). Source links pin the inspected snapshots:

| Repository | Reviewed commit                            | Relevant architecture                                                            |
| ---------- | ------------------------------------------ | -------------------------------------------------------------------------------- |
| T3 Code    | `0c4454ca6adc09058f3d311db6744788507d6af5` | Node server, shared contracts, React web client, Electron desktop, mobile client |
| PandaCode  | `4579dd4f6b69219bd9975d6b1aa2c19e76cba7d1` | Rust backend, Tauri desktop, TypeScript UI, SQLite persistence                   |

Architecture sources: [T3 Code repository guide](https://github.com/pingdotgg/t3code/blob/0c4454ca6adc09058f3d311db6744788507d6af5/AGENTS.md#L1-L5), [T3 Code module map](https://github.com/pingdotgg/t3code/blob/0c4454ca6adc09058f3d311db6744788507d6af5/AGENTS.md#L183-L196), and [PandaCode package](https://github.com/aicodeking/pandacode/blob/4579dd4f6b69219bd9975d6b1aa2c19e76cba7d1/package.json) and [native package](https://github.com/aicodeking/pandacode/blob/4579dd4f6b69219bd9975d6b1aa2c19e76cba7d1/src-tauri/Cargo.toml). These are coding-agent tools, while BidTool manages procurement data and long-running research. Their implementation discipline transfers more directly than their product architecture.

## Retrieval and revision provenance

The upstream research worker verified both exact repositories above on `main` on 2026-11-02. The saved pins remain valid. These observed heads record freshness; the evidence links throughout this note deliberately retain the immutable inspected pins.

| Repository             | Observed `main` head                                                                                                                  | Head commit timestamp (UTC) | Commits beyond saved pin |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------ |
| `pingdotgg/t3code`     | [`c65f8d552baca1b51e15b5fb4737f07e18cce177`](https://github.com/pingdotgg/t3code/commit/c65f8d552baca1b51e15b5fb4737f07e18cce177)     | 2026-11-02T05:53:04Z        | 13                       |
| `aicodeking/pandacode` | [`d46592bd968264db65aa3820e2d8fca566cbfb05`](https://github.com/aicodeking/pandacode/commit/d46592bd968264db65aa3820e2d8fca566cbfb05) | 2026-11-02T05:28:59Z        | 41                       |

That worker reported successful retrieval of all 13 pinned sources in its verification set and nine source comparisons against the observed heads. Eight compared sources were unchanged. PandaCode's `lib.rs` changed, but its stable app-data setup moved to [lines 3727–3739 at the observed head](https://github.com/aicodeking/pandacode/blob/d46592bd968264db65aa3820e2d8fca566cbfb05/src-tauri/src/lib.rs#L3727-L3739). These are that worker's retrieval results, not a claim that every link or every upstream change was rechecked in this refresh.

This refresh independently fetched five raw files at the saved pins, with a 20-second request timeout and a 2 MB read cap per file. The inspected ranges support five transferable patterns:

| Pattern                                           | Immutable evidence                                                                                                                                                          | Limit on the conclusion                                                                                                                                                    |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Count bytes while streaming                       | [T3 `ContextMenuImage.ts:27–53`](https://github.com/pingdotgg/t3code/blob/0c4454ca6adc09058f3d311db6744788507d6af5/apps/desktop/src/window/ContextMenuImage.ts#L27-L53)     | Body limits and redirect rejection do not prove SSRF or DNS-rebinding defense. BidTool's checked manual redirects and destination validation remain proposed R2 work.      |
| Gate work on readiness                            | [T3 `serverRuntimeStartup.ts:104–145`](https://github.com/pingdotgg/t3code/blob/0c4454ca6adc09058f3d311db6744788507d6af5/apps/server/src/serverRuntimeStartup.ts#L104-L145) | Line 106 uses `Queue.unbounded`. Adopt the readiness boundary in R6; do not copy this queue or add Effect.                                                                 |
| Migrate only required persistent state            | [T3 `DesktopUserData.ts:58–95`](https://github.com/pingdotgg/t3code/blob/0c4454ca6adc09058f3d311db6744788507d6af5/apps/desktop/src/app/DesktopUserData.ts#L58-L95)          | This copies Windows `Local State` with exclusive creation, not a whole Chromium profile or BidTool's documents. Pair it with the server-root evidence below for R1.        |
| Publish configuration through a sibling temp file | [Panda `remote/config.rs:149–168`](https://github.com/aicodeking/pandacode/blob/4579dd4f6b69219bd9975d6b1aa2c19e76cba7d1/src-tauri/src/remote/config.rs#L149-L168)          | File sync precedes rename; there is no directory fsync. The saved success test does not prove write, sync, or rename failure behavior. Keep this a low-priority follow-up. |
| Smoke-test the package before publication         | [Panda `release.yml:96–104`](https://github.com/aicodeking/pandacode/blob/4579dd4f6b69219bd9975d6b1aa2c19e76cba7d1/.github/workflows/release.yml#L96-L104)                  | Non-macOS packaged startup precedes artifact upload. Survival does not establish rendered UI, readiness, or a working document workflow; R8 needs separate evidence.       |

Keep Bun, Next.js, tRPC, PostgreSQL, and Electron. Implement these principles through existing server services, database transactions, startup state, and Electron filesystem APIs. This research does not propose Rust, Tauri, SQLite, Effect, or another queue stack.

## Adopt within the audited fixes

### 1. Make the persistent root explicit

T3 Code derives database, attachments, logs, and settings paths from one configured base. Its Electron profile migration copies only the required Windows credential state, uses exclusive creation, and preserves an existing destination. The accompanying test checks rerun behavior and excludes locked browser databases. PandaCode uses the platform app-data directory and retains its database filename across upgrades.

Sources: [T3 server paths](https://github.com/pingdotgg/t3code/blob/0c4454ca6adc09058f3d311db6744788507d6af5/apps/server/src/config.ts#L138-L172), [Electron migration](https://github.com/pingdotgg/t3code/blob/0c4454ca6adc09058f3d311db6744788507d6af5/apps/desktop/src/app/DesktopUserData.ts#L34-L95), [migration test](https://github.com/pingdotgg/t3code/blob/0c4454ca6adc09058f3d311db6744788507d6af5/apps/desktop/src/app/DesktopUserData.test.ts#L9-L41), [Panda startup](https://github.com/aicodeking/pandacode/blob/4579dd4f6b69219bd9975d6b1aa2c19e76cba7d1/src-tauri/src/lib.rs#L3644-L3664).

For BidTool R1, keep one `BIDTOOL_DATA_DIR`, with existing per-feature overrides. Bundled Electron passes a path under `userData` to its child server. Docker mounts `/app/data`. Copy legacy files while writers are stopped, verify checksums, and retain the source. T3's Chromium credential migration is an example of selective migration; BidTool needs its own document inventory. Neither source proves BidTool's database-and-files backup design. That design follows F01 and F08.

### 2. Bound the response body, including when headers lie

T3's context-menu image download uses an abort deadline, rejects redirects, checks declared size, counts bytes during streaming, cancels on overflow, and checks decoded dimensions. Tests exercise oversized bodies with and without `Content-Length`.

Sources: [download implementation](https://github.com/pingdotgg/t3code/blob/0c4454ca6adc09058f3d311db6744788507d6af5/apps/desktop/src/window/ContextMenuImage.ts#L17-L64), [body-limit tests](https://github.com/pingdotgg/t3code/blob/0c4454ca6adc09058f3d311db6744788507d6af5/apps/desktop/src/window/ContextMenuImage.test.ts#L128-L155).

Apply the deadline, incremental byte count, and cleanup pattern to R2's PDF and HTML fetches. Keep the deadline active until body consumption finishes. Select limits for BidTool's PDFs and HTML; do not reuse the image helper's 32 MiB cap blindly. The example does **not** validate public destinations or pin DNS. R2 still needs connection-level validation, checked manual redirects, and decoded-byte limits for F02 and F03.

### 3. Commit durable work before announcing it

T3's event sink reserves a command receipt, appends events, updates projections, and enqueues effects inside a transaction. After commit, it wakes the effect worker and publishes events. A repeated command returns the stored result; a test checks that retrying thread creation leaves the projection unchanged.

Sources: [transaction and publication boundary](https://github.com/pingdotgg/t3code/blob/0c4454ca6adc09058f3d311db6744788507d6af5/apps/server/src/orchestration-v2/EventSink.ts#L257-L284), [command commit](https://github.com/pingdotgg/t3code/blob/0c4454ca6adc09058f3d311db6744788507d6af5/apps/server/src/orchestration-v2/EventSink.ts#L635-L710), [duplicate-command test](https://github.com/pingdotgg/t3code/blob/0c4454ca6adc09058f3d311db6744788507d6af5/apps/server/src/orchestration-v2/Orchestrator.control-reads.test.ts#L1433-L1460).

For R4, commit the enrichment parent and children together before returning queued status or waking the scheduler. Existing PostgreSQL queue rows already represent durable work; no new outbox or event-sourcing framework is needed. R5 keeps domain writes in services and rechecks current material state inside a short transaction. Tests use separate PostgreSQL connections to prove isolation and retry safety. T3's receipt test supports a pattern, not an assertion that BidTool's current writes are idempotent.

### 4. Separate startup readiness from process existence

T3 queues commands behind an explicit startup gate, resolves them after readiness, and fails them when startup fails. Its tests cover both outcomes.

Sources: [startup gate](https://github.com/pingdotgg/t3code/blob/0c4454ca6adc09058f3d311db6744788507d6af5/apps/server/src/serverRuntimeStartup.ts#L104-L147), [gate tests](https://github.com/pingdotgg/t3code/blob/0c4454ca6adc09058f3d311db6744788507d6af5/apps/server/src/serverRuntimeStartup.test.ts#L262-L302).

R6 applies a smaller gate: no queue claims until recovery succeeds, observable startup state, and bounded readiness checks. BidTool must retry transient recovery failures; the cited T3 gate alone does not establish that retry policy. Keep ordinary commands fail-fast while unavailable. The source explicitly uses `Queue.unbounded` at line 106; do not copy that queue or introduce an Effect dependency.

### 5. Derive update actions from runtime support

PandaCode uses a discriminated `UpdateState`, separates update policy from app imports, and checks whether a copy supports installation before automatic downloads. Its restart policy refuses installation while an agent is busy, including after an explicit install request. Policy tests cover installability and busy states.

Sources: [state and restart policy](https://github.com/aicodeking/pandacode/blob/4579dd4f6b69219bd9975d6b1aa2c19e76cba7d1/src/app-updates-policy.ts#L4-L42), [policy tests](https://github.com/aicodeking/pandacode/blob/4579dd4f6b69219bd9975d6b1aa2c19e76cba7d1/tests/app-updates.test.mjs#L7-L39).

R7 uses the capability principle to disable unsupported on-prem in-app updates and show the existing host command. Keep Electron's supported updater. Its current [state helper](../src/lib/desktop-update.ts) has a status plus many nullable fields; a discriminated state can improve a later focused updater change. Job-aware desktop restart gating is a separate follow-up because it changes installation behavior and requires a reliable view of local running work. Keep manual install behavior for now.

### 6. Test the assembled artifact outside the source checkout

T3 extracts its packaged server into a temporary directory, refuses visible ancestor `node_modules`, clears `NODE_PATH`, disables global package lookup, and executes the bundled entry point under a timeout. This catches dependencies supplied accidentally by the developer machine. The probe runs `--version`; it does not establish full server readiness.

Source: [self-contained bundle check](https://github.com/pingdotgg/t3code/blob/0c4454ca6adc09058f3d311db6744788507d6af5/scripts/build-desktop-artifact.ts#L2203-L2258).

PandaCode separately runs release-script tests, builds installers, and checks packaged process startup on Windows and Linux. Its release guide explicitly distinguishes staying alive from rendering a window. Tests validate the exact artifact version and smoke-test isolation.

Sources: [release workflow](https://github.com/aicodeking/pandacode/blob/4579dd4f6b69219bd9975d6b1aa2c19e76cba7d1/.github/workflows/release.yml#L74-L104), [smoke limitations](https://github.com/aicodeking/pandacode/blob/4579dd4f6b69219bd9975d6b1aa2c19e76cba7d1/docs/releasing.md#L158-L174), [build policy tests](https://github.com/aicodeking/pandacode/blob/4579dd4f6b69219bd9975d6b1aa2c19e76cba7d1/scripts/release/desktop-build.test.mjs#L8-L75), [startup fixture tests](https://github.com/aicodeking/pandacode/blob/4579dd4f6b69219bd9975d6b1aa2c19e76cba7d1/scripts/release/ci-startup-smoke.test.mjs#L1-L90).

R8 should inspect and start BidTool's actual on-prem image and extracted Electron artifact with isolated data. Reject development module resolution and leaked `.env` files. Validate the expected version and files for Windows NSIS and Linux AppImage, then verify readiness and one document workflow. Avoid live AI calls. The known on-prem failure is a bundled `onprem-update.sh` that cannot source `onprem-lib.sh`; script presence alone is weak evidence. R7 disables that unsupported path instead of copying one helper and claiming support.

Keep four distinct kinds of evidence: policy tests, packaged startup, browser behavior, and complete restore. Each catches failures the others miss.

## Adapt after the audited fixes

### Bounded event delivery and representative performance measurements

T3 limits retained live events by item count and serialized bytes, reports overflow, releases retained data, and tells clients to resume from a sequence. Its event sink replays history in pages. Tests cover slow consumers, blocked replay, and replay/live overlap.

Sources: [budget and overflow](https://github.com/pingdotgg/t3code/blob/0c4454ca6adc09058f3d311db6744788507d6af5/apps/server/src/orchestration-v2/LiveStreamBudget.ts#L18-L100), [paged replay](https://github.com/pingdotgg/t3code/blob/0c4454ca6adc09058f3d311db6744788507d6af5/apps/server/src/orchestration-v2/EventSink.ts#L803-L831), [stream tests](https://github.com/pingdotgg/t3code/blob/0c4454ca6adc09058f3d311db6744788507d6af5/apps/server/src/orchestration-v2/LiveStreamBudget.test.ts#L18-L48), [replay tests](https://github.com/pingdotgg/t3code/blob/0c4454ca6adc09058f3d311db6744788507d6af5/apps/server/src/orchestration-v2/LiveStreamBudget.test.ts#L89-L198).

BidTool already persists enrichment events, trims event payloads, and caps history queries at 500 rows in [material-enrichment-events.ts](../src/server/services/material-enrichment-events.ts). Before a worker split or larger workload, review the [SSE route](../src/app/api/material-enrichment/jobs/[jobId]/events/route.ts) for complete cursor replay, subscribe/replay races, bounded pending bytes, and disconnect cleanup. Add tests for more than 500 missed events, overlap deduplication, and slow readers. Do not label these cases fixed by the query cap or copy T3's Effect infrastructure. Derive suitable limits from measured jobs.

PandaCode's benchmark records pinned revisions, a seeded workload, production builds, fresh Chrome processes, alternating run order, an idle baseline, and raw results. It drops a second workload when the apps render different outputs.

Source: [benchmark method and workload](https://github.com/aicodeking/pandacode/blob/4579dd4f6b69219bd9975d6b1aa2c19e76cba7d1/bench/t3-compare/README.md#L7-L60).

Use that method for BidTool's 100, 1,000, and 5,000-row BOQs: deterministic fixtures, identical output, isolated production builds, and repeated cold runs. Record request bytes, database time, heap after GC, refetch time, and UI responsiveness. Establish budgets from the baseline before optimizing. The published upstream benchmark uses older revisions, fake transport, and Chrome rather than the native shells, and excludes turn completion. I did not rerun it. Its performance ratios do not justify switching BidTool to Rust, Tauri, plain TypeScript, or SQLite.

Source: [benchmark limitations](https://github.com/aicodeking/pandacode/blob/4579dd4f6b69219bd9975d6b1aa2c19e76cba7d1/bench/t3-compare/README.md#L82-L92).

### Atomic desktop configuration and safe restarts

BidTool directly overwrites `desktop-config.json`; parsing failure falls back to `{}` and loses the saved server URL. PandaCode's remote-settings writer creates a unique sibling temp file, syncs it, renames it over the destination, and removes the temp on failure. Its success test checks persisted values and no leftover temp file.

Sources: [BidTool config](../electron/main.cjs), [Panda atomic write](https://github.com/aicodeking/pandacode/blob/4579dd4f6b69219bd9975d6b1aa2c19e76cba7d1/src-tauri/src/remote/config.rs#L144-L169), [Panda settings test](https://github.com/aicodeking/pandacode/blob/4579dd4f6b69219bd9975d6b1aa2c19e76cba7d1/src-tauri/src/remote/config.rs#L277-L290).

This is a low-priority follow-up after the audited fixes. Panda's writer does not fsync the parent directory, and its success test does not establish failure safety. A focused follow-up can preserve unknown settings, publish through a same-directory rename, and test injected write and rename failures on supported desktop platforms. Rename atomicity alone does not prove power-loss durability; select file and directory flush behavior by platform. Separately, adapt Panda's busy-state restart policy once BidTool can reliably identify bundled-server work. A desktop connected to a remote server needs a different decision because restarting the client does not stop remote jobs.

## Recommended application order

| Decision    | BidTool work                                                                               | Evidence required before completion                                                  |
| ----------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Adopt now   | R0 fixtures, R1 durable files, R2 bounded HTTP, R3 immutable PDFs                          | Isolated failure injection, body-stream cases, checksums through upgrade and restore |
| Adopt now   | R4 atomic enqueue, R5 current-state writes, R6 readiness gate                              | Real PostgreSQL races, no partial queue, transient-startup recovery                  |
| Adopt now   | R7 capability reporting, R8 artifact checks                                                | Actual artifact behavior, supported-platform smoke, browser workflow                 |
| Adapt later | SSE recovery and limits, BOQ measurements, atomic desktop config, job-aware restart        | Workload baseline and focused tests before behavior changes                          |
| Leave out   | New orchestration framework, service split, runtime rewrite, new database, multi-user auth | No current requirement justifies their migration cost                                |

Follow the canonical package dependencies and file handoffs. R7 has no storage dependency; R2 waits for the R1 storage handoff, and R3 follows R1 and R2. Every fix carries its own tests; release rehearsals remain part of R8.

## Applicability to the expanded findings

Keep F01–F10 and their existing R0–R8 mappings. The additional findings have dedicated packages or extend acceptance evidence for existing packages; upstream examples do not close them. This table records research relevance, not implemented fixes. The [canonical remediation plan](./architecture-remediation-plan.md) is authoritative for package ownership, dependencies and delivery order.

| Finding                                                 | Plan package and applicable principle                                                            | BidTool evidence still required                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| F11 (P1), release tag/source mismatch                   | R10/R8, pin the release source and verify the assembled artifact                                 | Tag, checked-out SHA, build version, and published artifact agree.                                   |
| F12 (P2), E2E isolation                                 | R0/R8, isolate verification inputs and state                                                     | Browser and server use disposable data and controlled external responses.                            |
| F13 (P2), workbook replacement                          | R11, publish workbook replacement atomically (R1/R3 support recoverable storage and replacement) | Failed writes or database commits preserve the previous workbook and reference.                      |
| F14 (P2), rollback tooling/image ref                    | R12/R8, repair rollback tooling and rehearse the actual operation                                | Rollback tooling is included and restores a recorded immutable image reference.                      |
| F15 (P2), release artifact verification/reporting       | R13/R8, distinguish policy tests, package startup, and UI evidence                               | Every required artifact is checked and the report identifies omitted or failed checks.               |
| F16 (P2), import restart duplication                    | R14/R6, make import replay safe and recover deliberately                                         | Restart and retry preserve import progress without duplicate domain writes.                          |
| F17 (P2), recent orphan Excel work                      | R6, recover work by durable state                                                                | Recovery handles recently orphaned work without taking work from a live owner.                       |
| F18 (P2), cancellation resurrection                     | R5/R6, recheck current state before transitions                                                  | Cancellation stays terminal during recovery and concurrent worker completion.                        |
| F19 (P2), deterministic `materialProfile` metadata loss | R5, preserve current fields inside domain writes                                                 | Deterministic merge cases preserve unrelated metadata; stale-state protection alone is insufficient. |

## License and verification limits

T3 Code uses the [MIT license](https://github.com/pingdotgg/t3code/blob/0c4454ca6adc09058f3d311db6744788507d6af5/LICENSE#L1-L21). PandaCode uses the [PandaCode license, MIT with an additional fork-attribution requirement](https://github.com/aicodeking/pandacode/blob/4579dd4f6b69219bd9975d6b1aa2c19e76cba7d1/LICENSE#L1-L21). This research adopts engineering principles and copies no implementation. Any future code reuse needs a license review appropriate to the material copied.

The prior saved research records checks of both repository identities and revisions against GitHub and local clones, plus inspection of the linked source and test assertions. It also records this dependency-free PandaCode check in its temporary checkout. This refresh did not rerun it:

```sh
node --test scripts/release/desktop-build.test.mjs scripts/release/ci-startup-smoke.test.mjs tests/app-updates.test.mjs
```

Prior recorded result: **24 tests passed, zero failed or skipped**. These are upstream policy and fixture tests, not an installed PandaCode smoke run and not verification of BidTool fixes. This refresh ran source retrieval and document checks only; it ran no upstream or BidTool tests. The prior note reports no upstream dependency install, full build, native GUI run, cross-app benchmark, live PostgreSQL test, or BidTool deployment. BidTool's earlier passing check, 513 unit tests, and build remain the previously reported pre-remediation baseline, not fresh verification.
