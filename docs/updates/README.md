# BidTool v3 Update System

BidTool ships through one unified release unit across web, on-prem Docker, and Electron desktop.

## Surfaces

| Surface | Update mechanism | Version source |
| --- | --- | --- |
| Web (Vercel) | Release workflow promotes a prebuilt deployment from tag `v*` | `BIDTOOL_APP_VERSION` + `BIDTOOL_BUILD_METADATA` |
| On-prem (Docker) | Hybrid: app shows status; ops run `BIDTOOL_IMAGE_TAG=x.y.z bun run onprem:update` | Docker env + manifest |
| Desktop (Electron) | `electron-updater` via GitHub Releases or local mock server | Electron app version + updater feed |

## Version format

Each release uses one semver with build metadata:

- Web: `0.2.0+web.abc1234`
- On-prem: `0.2.0+onprem.abc1234`
- Desktop Windows: `0.2.0+desktop.win.abc1234`
- Desktop Linux: `0.2.0+desktop.linux.abc1234`

## Source of truth

1. GitHub Release asset `manifest.json` — canonical release metadata
2. [`releases/pins.json`](../releases/pins.json) — committed artifact pins for rollback
3. Runtime [`/api/version`](../../src/app/api/version/route.ts) and `version.getStatus` tRPC — per-instance status

## Flows

See **[Update flows](./flows.md)** for step-by-step diagrams covering:

- Unified release (tag → artifacts → manifest → pins)
- Runtime version checks (`/api/version`)
- Web, on-prem, and desktop apply paths
- Rollback and forward-only migration limits

## Docs map

- **[Update flows](./flows.md)**
- [Phase 1: Release orchestrator](./phase-1-release-orchestrator.md)
- [Phase 2: Version API](./phase-2-version-api.md)
- [Phase 3: Desktop UX](./phase-3-desktop-ux.md)
- [Phase 4: On-prem admin UI](./phase-4-onprem-admin-ui.md)
- [Rollback](./rollback.md)
- [Local development](./local-dev.md)
