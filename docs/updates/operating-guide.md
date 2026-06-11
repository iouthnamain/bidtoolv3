# Operating Guide

What to do for future updates after the unified update system is in place.

## One-time setup (before the first real release)

1. Add GitHub repository secrets:
   - `VERCEL_TOKEN`
   - `VERCEL_ORG_ID`
   - `VERCEL_PROJECT_ID`

2. In the Vercel project settings, **disable automatic production deploys from `main`**. Production should move only through the release workflow.

3. In Vercel production env, set at minimum:
   - `BIDTOOL_DEPLOYMENT_SURFACE=web`
   - `DATABASE_URL`, `APP_BASE_URL`, and other required app env vars

4. Merge the update-system changes to `main`.

See [CI/CD review](./ci-cd.md) for workflow details and limits.

After this, normal releases are: merge to `main` → tag → CI handles the rest.

---

## Every release (maintainer checklist)

### 1. Ship code to `main`

Use the usual development flow: PRs, review, merge.

### 2. Tag the release

Use the release CLI so you do not have to remember the version number:

```bash
bun run release status   # show current + suggested next versions
bun run release patch      # tag v0.1.1 and push (interactive confirm)
bun run release minor
bun run release major
bun run release 0.2.0    # explicit version
```

Non-interactive shortcuts:

```bash
bun run release:patch
bun run release:minor
bun run release:major
```

Manual equivalent:

```bash
git checkout main
git pull
git tag v0.2.0
git push origin v0.2.0
```

That triggers [`.github/workflows/release.yml`](../../.github/workflows/release.yml), which:

- Builds and promotes Vercel production (`vercel build` + `vercel deploy --prebuilt`)
- Publishes the on-prem Docker image to GHCR
- Builds Windows/Linux desktop artifacts and on-prem bundle
- Publishes a GitHub Release with `manifest.json`
- Updates and commits [`releases/pins.json`](../../releases/pins.json) to `main`

See [Release CLI](./release-cli.md) for all CLI flags and [CI/CD review](./ci-cd.md) for workflow details.

### 3. What happens on each surface

| Surface | Your action | Automatic behavior |
| --- | --- | --- |
| **Web (Vercel)** | None | Users receive the new production deployment |
| **On-prem** | Run the update command on the server (see below) | App shows banner + command in Settings → About |
| **Desktop** | None (users update themselves) | App checks GitHub Releases; sidebar pill → download → restart |

---

## On-prem updates (hybrid flow)

When the app shows an update is available:

1. Open **Settings → About**, or use the dismissible admin banner.
2. Copy the update command, for example:

   ```bash
   BIDTOOL_IMAGE_TAG=0.2.0 bun run onprem:update
   ```

3. Run it **on the host** (SSH or automation), not inside the app container.

The script optionally creates a backup, rewrites `BIDTOOL_APP_IMAGE` in the customer env file, runs `docker compose pull`, and recreates the stack. Migrations run when the new container starts.

### Air-gapped on-prem

Point `BIDTOOL_MANIFEST_PATH` or `BIDTOOL_MANIFEST_URL` at a local copy of `manifest.json`. The on-prem bundle includes [`releases/`](../../releases/) for this purpose.

---

## Desktop updates

**For end users**

1. Sidebar update pill or **Settings → About** shows when an update is available.
2. Download the update.
3. Confirm install (running tasks may be interrupted).
4. App restarts on the new version.

**For maintainers**

Ship a tag; `electron-updater` reads the GitHub Release feed. No separate desktop publish step.

**Remote server mode**

The Electron shell and on-prem server update independently. Settings shows server version from `/api/version`; the shell updates from GitHub Releases.

---

## When something goes wrong

### Roll back app artifacts

Run [`.github/workflows/rollback.yml`](../../.github/workflows/rollback.yml) manually with `target_version`, for example `0.1.0`.

The workflow:

- Re-promotes the pinned Vercel deployment
- Retags the pinned on-prem digest as GHCR `:latest`

See [Rollback](./rollback.md) for details.

### Limitations

| Surface | Rollback behavior |
| --- | --- |
| Web | Previous pinned Vercel deployment is promoted |
| On-prem | `:latest` image retagged to previous digest |
| Desktop | Users stay on their installed version until they update |
| Database | **Not rolled back** — migrations are forward-only |

If migrations already ran and the old app no longer works with the current schema, **ship a forward hotfix**:

```bash
bun run release patch --yes
```

---

## Local testing before release

Test the desktop updater without publishing to GitHub:

```bash
bun run start:mock-update-server
BIDTOOL_DESKTOP_MOCK_UPDATES=1 bun run desktop:start
```

See [Local development](./local-dev.md) for mock artifact layout and manifest scripts.

---

## Quick reference

| Task | Command or location |
| --- | --- |
| Release status | `bun run release status` |
| Next patch release | `bun run release patch` |
| Next minor/major | `bun run release minor` / `bun run release major` |
| Release CLI docs | [release-cli.md](./release-cli.md) |
| On-prem update | `BIDTOOL_IMAGE_TAG=0.2.0 bun run onprem:update` |
| Check version | `curl http://localhost:3000/api/version` |
| Rollback | GitHub Actions → Rollback workflow |
| Flow diagrams | [Update flows](./flows.md) |
| CI/CD | [ci-cd.md](./ci-cd.md) |

**TL;DR:** Merge to `main` → `bun run release patch` → web and desktop update automatically → on-prem ops run the copied `onprem:update` command → rollback uses pinned artifacts, not rebuilds.
