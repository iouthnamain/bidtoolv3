# Phase 1: Release Orchestrator

## Workflow

Release automation lives in [`.github/workflows/release.yml`](../../.github/workflows/release.yml).

On tag `v*`, the workflow:

1. Runs quality gates
2. Builds and promotes Vercel production with `vercel build` + `vercel deploy --prebuilt`
3. Publishes the on-prem Docker image to GHCR with version build metadata
4. Builds Windows/Linux desktop artifacts
5. Generates `manifest.json`
6. Publishes a GitHub Release with all assets
7. Updates and commits [`releases/pins.json`](../../releases/pins.json) to `main`

See [CI/CD review](./ci-cd.md) for job graph, secrets, and known limits.

## Required secrets

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

If Vercel secrets are missing, the workflow still publishes docker/desktop/on-prem artifacts and writes `deployment_id=skipped` into the manifest web pin.

## Vercel project setting

Disable automatic production deploys from `main`. Production should only move through the release workflow.

## Scripts

- [`scripts/release-cli.ts`](../../scripts/release-cli.ts) — tag and push releases incrementally
- [`scripts/generate-release-manifest.ts`](../../scripts/generate-release-manifest.ts)
- [`scripts/update-release-pins.ts`](../../scripts/update-release-pins.ts)

See [Release CLI](./release-cli.md) for maintainer commands.

## Pins registry

[`releases/pins.json`](../../releases/pins.json) stores artifact coordinates per version. Rollback reads this file instead of rebuilding old artifacts.
