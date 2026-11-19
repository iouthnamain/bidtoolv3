# CI/CD Review

Validate pull requests locally. GitHub Actions runs the separate release and rollback workflows. Vercel Git deployments are disabled in `vercel.json`. The Release workflow deploys through the Vercel CLI.

## Local PR checks

Run `bun install --frozen-lockfile` and set `BIDTOOL_TEST_DATABASE_URL` to a disposable PostgreSQL 16 database on loopback. Use the role `bidtool_test` and a database name such as `bidtool_test_pr`. Then run `bun run verify` and record its result in the PR. The command runs lint, TypeScript, unit tests, PostgreSQL integration tests, the production build, and release metadata checks. The build uses the disposable database and writes to `.next/verify`.

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

| Workflow                                                                 | Trigger                     | Purpose                                                      |
| ------------------------------------------------------------------------ | --------------------------- | ------------------------------------------------------------ |
| [`.github/workflows/release.yml`](../../.github/workflows/release.yml)   | Tag `v*` or manual dispatch | Unified release for web, on-prem, desktop, manifest, pins    |
| [`.github/workflows/rollback.yml`](../../.github/workflows/rollback.yml) | Manual dispatch             | Re-promote pinned web deployment and retag on-prem `:latest` |

## Release (`release.yml`)

### Job graph

```mermaid
flowchart TD
  quality[quality] --> deploy[deploy-vercel]
  quality --> docker[docker]
  quality --> bundle[onprem-bundle]
  quality --> win[desktop-windows]
  quality --> linux[desktop-linux]
  resolve[resolve-version] --> deploy
  resolve --> docker
  resolve --> bundle
  resolve --> win
  resolve --> linux
  deploy --> publish[publish-release]
  docker --> publish
  bundle --> publish
  win --> publish
  linux --> publish
  resolve --> publish
```

### Web deploy details

The `deploy-vercel` job:

1. Pulls Vercel project settings (`vercel pull`)
2. Builds with `vercel build --prod` using release env vars (`BIDTOOL_*`)
3. Deploys with `vercel deploy --prebuilt --prod --json`
4. Stores the real Vercel deployment ID (`dpl_...`) in `manifest.json` and `pins.json`

If Vercel secrets are missing, web promotion is skipped and `deployment_id=skipped` is recorded.

### Pins commit

After publishing, `publish-release` updates `releases/pins.json` and commits it to **`main`**, not the tag ref. This keeps the pins registry on the default branch for rollback and runtime version checks.

### Required secrets

| Secret              | Used by                                 |
| ------------------- | --------------------------------------- |
| `GITHUB_TOKEN`      | Release publish, GHCR push, pins commit |
| `VERCEL_TOKEN`      | Web deploy and rollback                 |
| `VERCEL_ORG_ID`     | Web deploy                              |
| `VERCEL_PROJECT_ID` | Web deploy                              |

### Vercel project settings

Set production runtime env vars or use Vercel dashboard values that match release metadata.

- `BIDTOOL_DEPLOYMENT_SURFACE=web`
- `DATABASE_URL`, `APP_BASE_URL`, etc.

Release workflow embeds version metadata at **build time** via job env. Runtime env on Vercel should still identify the deployment surface.

## Rollback (`rollback.yml`)

Manual workflow with input `target_version` (for example `0.1.0`):

1. Loads pin from `releases/pins.json`
2. Promotes pinned Vercel deployment by deployment ID
3. Retags pinned on-prem digest (or image ref) as GHCR `:latest`

Does **not** roll back desktop installs or database migrations.

## Release CLI

Maintainers should prefer the release CLI over manual tags. See [Release CLI](./release-cli.md).

## Known limits

| Area                       | Limit                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| Web without Vercel secrets | Release continues; web pin marked `skipped`                                                  |
| First release              | `pins.json` starts empty until first successful release                                      |
| On-prem bundle             | Ships `releases/pins.json` snapshot; latest manifest comes from GitHub Release after publish |
| DB rollback                | Not supported — use forward hotfix releases                                                  |

Maintainer tagging commands: [Release CLI](./release-cli.md).

## Related docs

- [Operating guide](./operating-guide.md)
- [Update flows](./flows.md)
- [Rollback](./rollback.md)
