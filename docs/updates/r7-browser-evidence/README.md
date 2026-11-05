# R7 controlled browser evidence

Captured on 2026-11-03 against source commit `43ef291e7338a6781fa01c4797f827e59eeab1ce` in the R7 worktree. No production code changed during this evidence pass.

## Observed behavior

| Case | Observed result | Artifacts |
| --- | --- | --- |
| Legacy flag `true` | Real `/api/version` returned `canApplyInApp: false`; the update button copied the exact host command to the native clipboard, opened no dialog, and made no update mutation request. A direct compatibility mutation returned HTTP 501 / `NOT_IMPLEMENTED`. | [Assertions](./legacy-true.json), [screenshot](./legacy-true.png), [recording](./legacy-true.webm) |
| Legacy flag `false` | Same status, clipboard, no-dialog, no-mutation and HTTP 501 assertions passed. | [Assertions](./legacy-false.json), [screenshot](./legacy-false.png), [recording](./legacy-false.webm) |
| Simulated Electron bridge | The real browser component selected check, download and install in order. The install confirmation addressed desktop updates; confirmation called the fake bridge once. No on-prem mutation request occurred. | [Assertions](./desktop-bridge.json), [screenshot](./desktop-bridge.png), [recording](./desktop-bridge.webm) |

The on-prem command in both runs was `BIDTOOL_IMAGE_TAG=0.2.0 bun run onprem:update`. It was copied, never executed. The Electron bridge was a browser fixture with `isDesktop: true` and synthetic idle → available → downloaded states. Its check/download/install methods returned fixture results and recorded calls. No real desktop download, installation, native Electron runtime, or packaged desktop artifact was exercised.

## Isolation and reproduction

The owned Next development server bound only to `127.0.0.1:31427`. Its environment was cleared with `env -i`; no private `.env` files existed in the worktree. `DATABASE_URL` was explicitly empty, which prevented scheduler startup. No DB, migration, seed, production data or paid service was used. The real version service read [the local manifest fixture](./manifest.fixture.json). Browser requests outside the local origin were blocked; the assertion files record the blocked Vercel analytics request.

Run from this worktree after installing frozen dependencies. Confirm port 31427 is free; do not reuse another server. In one terminal, start the owned app, first with `true`, then stop it and repeat with `false`:

```sh
R7_LEGACY_FLAG=true

env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR" \
  NODE_ENV=development NEXT_TELEMETRY_DISABLED=1 SKIP_ENV_VALIDATION=1 \
  DATABASE_URL= APP_BASE_URL=http://127.0.0.1:31427 \
  BIDTOOL_DEPLOYMENT_SURFACE=onprem BIDTOOL_APP_VERSION=0.1.0 \
  BIDTOOL_ALLOW_IN_APP_UPDATES="$R7_LEGACY_FLAG" \
  BIDTOOL_MANIFEST_PATH="$PWD/docs/updates/r7-browser-evidence/manifest.fixture.json" \
  BIDTOOL_NEXT_DIST_DIR=.next-r7-browser BIDTOOL_LOG_LEVEL=error \
  BIDTOOL_EXCEL_RESEARCH_DIR="$PWD/docs/updates/r7-browser-evidence/.runtime-data" \
  node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 31427
```

In another terminal, run `node docs/updates/r7-browser-evidence/capture.mjs true` (or `false` to match the server). Both commands exited 0. The capture uses installed Playwright and Google Chrome, real HTTP endpoints, native clipboard readback, visible UI clicks, screenshots and video. It closes its own browser. Stop only the server you started. Next may add its custom build path to `tsconfig.json`; preserve unrelated changes when removing that generated entry. This pass removed its own build output and restored the original unchanged config after stopping the servers.

The requested T3 preview was attempted first, but snapshot calls timed out twice with `Preview automation snapshot timed out after 15000ms`. The Chrome CLI fallback required an MCP `pageId` that its wrapper omitted. The successful captures used the repository's installed Playwright library with the installed Chrome channel, without installing additional tooling.

## Checks and remaining acceptance

- `node docs/updates/r7-browser-evidence/capture.mjs true`: passed.
- `node docs/updates/r7-browser-evidence/capture.mjs false`: passed.
- One-off Playwright fake-bridge run: passed check → download → confirm install; recorded `check`, `download`, `install` once each.
- `bun run test src/server/services/onprem-update.test.ts src/server/services/version-info.test.ts src/lib/update-apply.test.ts src/lib/desktop-update.test.ts src/lib/desktop-update-react-query.test.ts`: passed, 5 files / 22 tests, including desktop updater checks.
- `bun run typecheck --incremental false`: passed.
- `node --check docs/updates/r7-browser-evidence/capture.mjs` and `bunx --no-install eslint docs/updates/r7-browser-evidence/capture.mjs`: passed.
- `git diff --check`: passed; all evidence JSON files parsed successfully.
- PR #27 had five green checks before this evidence commit: `check`, `Validate Release Scripts`, `On-Prem Package`, `Vercel`, `Vercel Preview Comments`. The image build does not establish runtime smoke.

Production-image runtime smoke remains unverified. The local Docker daemon is unavailable and was not retried in this pass. No image was started, no host update was executed, and no packaged runtime/DB proof was obtained. R7/F10 acceptance stays open and PR #27 stays draft until that proof is attached.
