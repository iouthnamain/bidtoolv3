# Phase 4: On-Prem Admin UI

## Hybrid update model

The app does not run `docker compose pull` itself. Instead it:

1. Shows current vs latest version
2. Displays release notes from the manifest
3. Provides a copy-paste update command

Example:

```bash
BIDTOOL_IMAGE_TAG=0.2.0 bun run onprem:update
```

## UI components

- Dismissible admin banner: [`admin-update-banner.tsx`](../../src/app/_components/dashboard/admin-update-banner.tsx)
- Settings → About section: [`about-version-section.tsx`](../../src/app/_components/dashboard/about-version-section.tsx)

Both are visible to all authenticated users.

## Script support

[`scripts/onprem-update.sh`](../../scripts/onprem-update.sh) accepts `BIDTOOL_IMAGE_TAG` and rewrites `BIDTOOL_APP_IMAGE` in the customer env file before pulling images.

## Air-gapped installs

The on-prem bundle includes [`releases/`](../../releases/) so customers can point `BIDTOOL_MANIFEST_PATH` or `BIDTOOL_MANIFEST_URL` at a local copy of `manifest.json`.
