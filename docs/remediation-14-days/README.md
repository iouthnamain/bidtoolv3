# Fourteen-day remediation delivery

Window: **2026-11-02 through 2026-11-15**, Asia/Ho_Chi_Minh. Day 1 starts now. This is a target schedule; prerequisite failures move dependent work rather than weakening acceptance checks.

The [architecture plan](../architecture-remediation-plan.md) remains the implementation specification for F01–F19. Each package has one GitHub task, an isolated T3 Code thread, and one intended implementation PR, except R8's two planned stages. PRs open when there is reviewable code. Dates do not authorize releases, deployment, or production-data access. The user separately authorized coordinator review and merge of qualifying prerequisites on November 3; see the automatic-start rules.

## Package ownership and PR sequence

| Package | Window                | Findings           | Depends on                                              | Task and implementation brief                                                                                                      | PR branch                                |
| ------- | --------------------- | ------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| R0      | D1–D2 · 11-02–11-03   | F12                | None                                                    | [Isolate database and destructive E2E fixtures](https://github.com/iouthnamain/bidtoolv3/issues/12) · [brief](./R0.md)             | `test/isolate-remediation-fixtures`      |
| R7      | D1–D1 · 11-02–11-02   | F10                | None                                                    | [Disable unsupported on-prem in-app updates](https://github.com/iouthnamain/bidtoolv3/issues/13) · [brief](./R7.md)                | `fix/onprem-update-capabilities`         |
| R10     | D2–D3 · 11-03–11-04   | F11                | R0                                                      | [Pin release checks and artifacts to one tag commit](https://github.com/iouthnamain/bidtoolv3/issues/14) · [brief](./R10.md)       | `fix/release-tag-provenance`             |
| R1      | D2–D5 · 11-03–11-06   | F01, F08           | R0                                                      | [Preserve application files through upgrades and restore](https://github.com/iouthnamain/bidtoolv3/issues/15) · [brief](./R1.md)   | `fix/durable-app-storage`                |
| R4      | D3–D4 · 11-04–11-05   | F05                | R0                                                      | [Commit enrichment jobs and children atomically](https://github.com/iouthnamain/bidtoolv3/issues/16) · [brief](./R4.md)            | `fix/atomic-enrichment-enqueue`          |
| R2      | D3–D6 · 11-04–11-07   | F02, F03           | R0                                                      | [Validate public destinations and bound download bodies](https://github.com/iouthnamain/bidtoolv3/issues/17) · [brief](./R2.md)    | `fix/public-content-http`                |
| R12     | D4–D5 · 11-05–11-06   | F14                | R0, R10                                                 | [Validate rollback tooling and immutable image references](https://github.com/iouthnamain/bidtoolv3/issues/18) · [brief](./R12.md) | `fix/rollback-image-references`          |
| R5      | D4–D8 · 11-05–11-09   | F04, F19           | R0                                                      | [Preserve material metadata and reject stale writes](https://github.com/iouthnamain/bidtoolv3/issues/19) · [brief](./R5.md)        | `fix/material-write-concurrency`         |
| R3      | D6–D7 · 11-07–11-08   | F06                | R0, R1, R2                                              | [Publish PDF replacements without losing current bytes](https://github.com/iouthnamain/bidtoolv3/issues/20) · [brief](./R3.md)     | `fix/recoverable-pdf-replacement`        |
| R11     | D6–D9 · 11-07–11-10   | F13                | R0, R1                                                  | [Replace workbook state atomically](https://github.com/iouthnamain/bidtoolv3/issues/21) · [brief](./R11.md)                        | `fix/atomic-workbook-replacement`        |
| R14     | D9–D10 · 11-10–11-11  | F16                | R0, R5                                                  | [Prevent duplicate imports after interruption](https://github.com/iouthnamain/bidtoolv3/issues/22) · [brief](./R14.md)             | `fix/idempotent-import-recovery`         |
| R6      | D10–D12 · 11-11–11-13 | F07, F09, F17, F18 | R0, R4, R14                                             | [Gate work on recovery and report readiness](https://github.com/iouthnamain/bidtoolv3/issues/23) · [brief](./R6.md)                | `fix/scheduler-readiness-recovery`       |
| R13     | D11–D13 · 11-12–11-14 | F15                | R7, R10, R12                                            | [Verify actual artifacts and report skipped surfaces](https://github.com/iouthnamain/bidtoolv3/issues/24) · [brief](./R13.md)      | `fix/release-artifact-evidence`          |
| R8      | D10–D14 · 11-11–11-15 | F01–F19 closure    | R0, R1, R2, R3, R4, R5, R6, R7, R10, R11, R12, R13, R14 | [Require runtime, upgrade, restore and browser evidence](https://github.com/iouthnamain/bidtoolv3/issues/25) · [brief](./R8.md)    | `test/remediation-runtime-release-gates` |

## T3 Code task threads

All 14 threads belong to the registered BidTool project. Day 1 threads start implementation immediately; the others begin idle, with worktree strategies reserved for their own branches. Automatic starts follow the eligibility checks below.

| Package | Thread                                                                                                                            | Initial execution  |
| ------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| R0      | <t3-thread://v2/ae3d783a-16ba-4027-ab0b-0b380f8a69aa/mcp:launch:0bb4852f55e1f36ec5409606cde83ad3230c384d059f59dec8ed1beb5f36897c> | Launched for Day 1 |
| R7      | <t3-thread://v2/ae3d783a-16ba-4027-ab0b-0b380f8a69aa/mcp:launch:a5af30eb5f2b081d05b281654281b1811066fd481b95eb1ebb5783b15758f177> | Launched for Day 1 |
| R10     | <t3-thread://v2/ae3d783a-16ba-4027-ab0b-0b380f8a69aa/mcp:launch:e3bc9177586c2d2c1fe079510438009ff125a68e3146e93e6d5ab8bc4ca329d5> | Idle backlog       |
| R1      | <t3-thread://v2/ae3d783a-16ba-4027-ab0b-0b380f8a69aa/mcp:launch:05ea83af77e6b7916e12ea9de7c571f160cd5d3c32e36e820c2b20f4ae443482> | Idle backlog       |
| R4      | <t3-thread://v2/ae3d783a-16ba-4027-ab0b-0b380f8a69aa/mcp:launch:78da64d9fa24413877706f8c4872e3ca2eeea3d2e808c414ab22b07ce999138a> | Idle backlog       |
| R2      | <t3-thread://v2/ae3d783a-16ba-4027-ab0b-0b380f8a69aa/mcp:launch:2d8a27c8f10f163ee7cfdf9e874e2bb8d7ab9a1c6ed836b48ff196b2e05a0dbf> | Idle backlog       |
| R12     | <t3-thread://v2/ae3d783a-16ba-4027-ab0b-0b380f8a69aa/mcp:launch:dad89ee2de123d490bf4951dbf0f6e5fdc7c700afbdfbbbd3ed9808e08a229e3> | Idle backlog       |
| R5      | <t3-thread://v2/ae3d783a-16ba-4027-ab0b-0b380f8a69aa/mcp:launch:22adfa6d380d22c839cf3915b86c055aea8c5e62b3c730c3f6e5858c5cd38b93> | Idle backlog       |
| R3      | <t3-thread://v2/ae3d783a-16ba-4027-ab0b-0b380f8a69aa/mcp:launch:c5832901b724610bbe31e02746b2e5ba419673ba28ce5909a5af9fdf125a58c6> | Idle backlog       |
| R11     | <t3-thread://v2/ae3d783a-16ba-4027-ab0b-0b380f8a69aa/mcp:launch:c22c7bce0a7cdb9a5f344a4fb83a6d5f11d58b5170f094e0c8a43b81c67e1e39> | Idle backlog       |
| R14     | <t3-thread://v2/ae3d783a-16ba-4027-ab0b-0b380f8a69aa/mcp:launch:10455e41a1684a6df15bda8e20b949d7fd6c4f3f8babb38204b23144b8d2c642> | Idle backlog       |
| R6      | <t3-thread://v2/ae3d783a-16ba-4027-ab0b-0b380f8a69aa/mcp:launch:e34a0f282fbf0e1fcda269703041dcecaa597a4b1f19b2a85e372cfd8b543bb3> | Idle backlog       |
| R13     | <t3-thread://v2/ae3d783a-16ba-4027-ab0b-0b380f8a69aa/mcp:launch:8a882b88a92250a8d57df742be6a4c839bf8ece5d8c91bb74e9f215bd0ef08bc> | Idle backlog       |
| R8      | <t3-thread://v2/ae3d783a-16ba-4027-ab0b-0b380f8a69aa/mcp:launch:51caea278dccd4a2eef938bb8b9ee9fb39fa937d451363d428e162cc4ecab5e2> | Idle backlog       |

## Daily outcomes

| Day | Date       | Planned work and review outcome                                                                                                                                      |
| --- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 2026-11-02 | Run R0 and R7 in parallel worktrees. Open separate PRs; publish the planning PR and task/thread registry.                                                            |
| 2   | 2026-11-03 | Finish R0 isolation proof. Start R1 storage and R10 tag provenance after R0 is available.                                                                            |
| 3   | 2026-11-04 | Finish R10. Start R2 public HTTP and R4 atomic enqueue; continue R1.                                                                                                 |
| 4   | 2026-11-05 | Finish R4. Start R5 material writes and R12 rollback after prerequisites. Keep each workflow owner separate.                                                         |
| 5   | 2026-11-06 | Finish R1 upgrade/restore proof and R12 clean-runner proof. Review R2 controlled network cases.                                                                      |
| 6   | 2026-11-07 | Finish R2. Start R3 after R1/R2 handoff and R11 after R1. R5 remains the sole owner of shared material writers.                                                      |
| 7   | 2026-11-08 | Finish R3 PDF fault cases. Continue R5 and R11; resolve lock-order contracts together.                                                                               |
| 8   | 2026-11-09 | Finish R5 writer inventory, metadata preservation, revisions and PostgreSQL races.                                                                                   |
| 9   | 2026-11-10 | Finish R11 workbook replacement and start R14 import recovery after R5.                                                                                              |
| 10  | 2026-11-11 | Finish R14 safe import policy. Start R6 only after R14 handoff. R8 scaffolds runtime smoke executables.                                                              |
| 11  | 2026-11-12 | R8 hands smoke command contracts to R13. Start R13 artifact reporting after R7/R10/R12; keep release workflow ownership with R13.                                    |
| 12  | 2026-11-13 | Finish R6 readiness, orphan-row and cancellation proofs. R13 consumes R8 smoke commands.                                                                             |
| 13  | 2026-11-14 | Finish R13 verification/reporting. Hand release workflow ownership to R8 for final gates; rehearse upgrade and restore.                                              |
| 14  | 2026-11-15 | Run R8 complete evidence matrix, verify supported desktop packaging and browser workflows, review all F01–F19 closures. Report remaining gaps; no automatic release. |

## Concurrency and integration rules

- R0 and R7 are the only implementation tasks launched on Day 1. The coordinator owns planning documents and the registry.
- R1 hands off shared storage files to R2/R3/R11. R2 completes the catalog downloader before R3 changes replacement. R5 hands importer and schema ownership to R14; R14 hands scheduler ownership to R6.
- R10 owns `release.yml` first. R13 owns it next. R8 builds smoke executables separately, then takes the final workflow gate wiring after R13. R8 smoke scaffolding has no dependency on R13; final R8 closure does. This avoids a circular implementation dependency.
- Start dependent work only with its prerequisite changes merged, or in an explicit reviewed stack whose parent is available in the task worktree. Workers do not merge their own dependencies. The coordinator may merge qualifying prerequisites after review and acceptance verification.
- Future threads must fetch and inspect current `origin/main` before implementation. Their initial worktree snapshot is not evidence that dependencies exist. Keep branch updates non-destructive; never rewrite a published branch without authorization.
- One worker owns each listed writable scope. Shared-file changes require a handoff. Workers may report a needed adjacent change but must not edit outside their scope silently.
- Use focused tests with each fix, then the package acceptance matrix. Keep missing native-platform, database, Docker, registry or browser proof visible. A code-complete PR is not finding closure.

## Execution state

The live task and thread registry is recorded locally in `.pipeline/runs/remediation-20261102/registry.json`. It contains external links, workspace bindings and observed run state. This document is the dated plan; GitHub issues and PRs hold execution evidence. The canonical plan checkboxes stay open until that evidence exists.

Automatic eligibility checks run **every five hours**, starting **November 2, 2026 at 19:26 Asia/Ho_Chi_Minh (12:26 UTC)**, through November 15. One interval replaces the disabled daily schedules. Each period starts or resumes one or two eligible tasks, with a hard maximum of two dispatches per period and two implementation threads active overall. Blocked work carries forward to the next check; the November 3 immediate-completion instruction allows dependency-ready work before its target date. All fourteen workers use GPT-6.1 Sol and iterate through implementation, tests, review and fixes until their scoped PR is prepared. Prerequisite PRs must be merged. See [automatic-start rules](./automatic-starts.md).

R8 uses a smoke-foundation PR before R13 and a final-gates PR afterward, as described in the automatic-start rules. Both belong to the original R8 task/thread. No automatic starts occur after November 15. Release publication and deployment remain separate actions.

R9 remains deferred. Framework/database rewrites, multi-user authentication, and speculative worker separation remain outside this delivery.
