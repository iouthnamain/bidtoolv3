# CI/CD Review

Validate pull requests locally. GitHub Actions runs the separate release and rollback workflows. Vercel Git deployments are disabled in `vercel.json`. The Release workflow deploys through the Vercel CLI.

## Local PR checks

Run `bun install --frozen-lockfile` and set `BIDTOOL_TEST_DATABASE_URL` to a disposable PostgreSQL 16 database on loopback. Use the role `bidtool_test` and a database name such as `bidtool_test_pr`. Then run `bun run verify` and record its result in the PR. The command runs lint, TypeScript, unit tests, PostgreSQL integration tests, the release workflow dry run, the production build, and release metadata checks. The build uses the disposable database and writes to `.next/verify`.

Run the affected Playwright test with `bunx playwright test <path>` for browser changes. It uses the same disposable database setting and starts its own app.

For changes to on-prem packaging or storage, commit the candidate and run the Docker checks with the local `default` context and a Unix socket. On Windows use WSL with Docker enabled inside it.

```sh
docker --context default compose --env-file deploy/onprem/.env.customer.example -f compose.production.yml config
image="bidtool-r1-acceptance:$(git rev-parse HEAD)"
git archive --format=tar HEAD | docker --context default build --tag "$image" -
BIDTOOL_RUN_STORAGE_ACCEPTANCE=1 BIDTOOL_STORAGE_TEST_IMAGE="$image" \
  bun run test tests/fixtures/remediation/storage-acceptance.test.ts
```

## Workflows

| Workflow                                                                 | Trigger                     | Purpose                                                                 |
| ------------------------------------------------------------------------ | --------------------------- | ----------------------------------------------------------------------- |
| [`.github/workflows/release.yml`](../../.github/workflows/release.yml)   | Tag `v*` or manual dispatch | Unified release for web, on-prem, desktop, manifest, pins               |
| [`.github/workflows/validate.yml`](../../.github/workflows/validate.yml) | Called by Release           | Quality, integration, runtime, and bundle checks for the release commit |
| [`.github/workflows/rollback.yml`](../../.github/workflows/rollback.yml) | Manual dispatch             | Re-promote pinned web deployment and retag on-prem `:latest`            |

## Release (`release.yml`)

Release resolves the tag to a commit, verifies the artifacts built from that commit, and publishes through the protected `production` environment. Delivery requires the Vercel environment secrets. After publication, download the pins proposal and review it in a separate PR. See the [release job graph, configuration, and operator steps](../ci-cd.md).

### Vercel project settings

Set production runtime env vars or use Vercel dashboard values that match release metadata.

- `BIDTOOL_DEPLOYMENT_SURFACE=web`
- `DATABASE_URL`
- `APP_BASE_URL`

Release workflow embeds version metadata at **build time** via job env. Runtime env on Vercel should still identify the deployment surface.

## Rollback (`rollback.yml`)

Dispatch Rollback with a pinned stable `target_version` such as `0.1.0`. The workflow inspects the Vercel deployment and repository-qualified on-prem image digest before promotion. See [manual artifact rollback](../ci-cd.md#manual-artifact-rollback).

## Release CLI

Maintainers should prefer the release CLI over manual tags. See [Release CLI](./release-cli.md).

## Known limits

| Area              | Limit                                                                               |
| ----------------- | ----------------------------------------------------------------------------------- |
| First release     | The pins registry gains the release once its pins proposal merges                   |
| On-prem bundle    | Ships a `releases/pins.json` snapshot. GitHub Release serves the published manifest |
| Database recovery | Migrations are forward-only. Fix schema issues with a hotfix release                |

Maintainer tagging commands: [Release CLI](./release-cli.md).

## Related docs

- [Operating guide](./operating-guide.md)
- [Update flows](./flows.md)
- [Rollback](./rollback.md)
