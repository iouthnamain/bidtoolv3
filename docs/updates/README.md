# BidTool v3 Update System

BidTool ships through one unified release unit across web, on-prem Docker, and Electron desktop.

**Start here:** [Operating guide](./operating-guide.md) for day-to-day releases.

## Surfaces

| Surface | Update mechanism | Version source |
| --- | --- | --- |
| Web (Vercel) | Release workflow promotes production on tag `v*` | `BIDTOOL_APP_VERSION` + `BIDTOOL_BUILD_METADATA` |
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
2. [`releases/pins.json`](../../releases/pins.json) — committed artifact pins for rollback
3. Runtime [`/api/version`](../../src/app/api/version/route.ts) and `version.getStatus` tRPC — per-instance status

## Quick commands

```bash
bun run release status          # what version am I on? what's next?
bun run release patch           # tag + push next patch release
BIDTOOL_IMAGE_TAG=0.2.0 bun run onprem:update   # on-prem server update
curl http://localhost:3000/api/version        # runtime version check
```

## Docs map

### Day-to-day

- **[Operating guide](./operating-guide.md)** — setup, release checklist, on-prem/desktop/rollback
- **[Release CLI](./release-cli.md)** — incremental tagging without remembering version numbers
- **[Update flows](./flows.md)** — diagrams for each path
- **[CI/CD review](./ci-cd.md)** — GitHub Actions workflows and secrets

### Reference

- [Phase 1: Release orchestrator](./phase-1-release-orchestrator.md)
- [Phase 2: Version API](./phase-2-version-api.md)
- [Phase 3: Desktop UX](./phase-3-desktop-ux.md)
- [Phase 4: On-prem admin UI](./phase-4-onprem-admin-ui.md)
- [Rollback](./rollback.md)
- [Local development](./local-dev.md)
