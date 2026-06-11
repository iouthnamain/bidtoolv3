# Phase 2: Version API

## Endpoints

- REST: `GET /api/version`
- tRPC: `version.getStatus`

## Runtime env vars

| Variable | Purpose |
| --- | --- |
| `BIDTOOL_APP_VERSION` | Current semver |
| `BIDTOOL_BUILD_METADATA` | Build metadata suffix |
| `BIDTOOL_DEPLOYMENT_SURFACE` | `web`, `onprem`, or `desktop-bundled` |
| `BIDTOOL_MANIFEST_URL` | Canonical manifest URL override |
| `BIDTOOL_MANIFEST_PATH` | Local filesystem manifest for air-gapped installs |
| `BIDTOOL_PINS_URL` | Override for committed pins registry URL |
| `BIDTOOL_GITHUB_REPO` | Default `iouthnamain/bidtoolv3` |

## Resolution order

1. Read current version/build metadata from env
2. Load latest manifest from `BIDTOOL_MANIFEST_PATH` if set
3. Otherwise fetch [`releases/pins.json`](../../releases/pins.json) and follow `manifestUrl`
4. Fall back to release-scoped GitHub manifest URL

Manifest responses are cached in memory for 10 minutes.

## Implementation

- [`src/server/services/version-info.ts`](../../src/server/services/version-info.ts)
- [`src/server/api/routers/version.ts`](../../src/server/api/routers/version.ts)
- [`src/lib/release-manifest.ts`](../../src/lib/release-manifest.ts)

## Related docs

- [Operating guide](./operating-guide.md)
- [Update flows](./flows.md)
