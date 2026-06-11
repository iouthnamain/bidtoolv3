# Release CLI

The release CLI tags and pushes the next semver so you do not have to remember version numbers manually.

Implementation: [`scripts/release-cli.ts`](../../scripts/release-cli.ts)

## Commands

| Command | Description |
| --- | --- |
| `bun run release` | Same as `release status` |
| `bun run release status` | Show current version and suggested next patch/minor/major |
| `bun run release patch` | Create and push the next patch tag (interactive confirm) |
| `bun run release minor` | Create and push the next minor tag |
| `bun run release major` | Create and push the next major tag |
| `bun run release 0.2.0` | Tag an explicit version |
| `bun run release:patch` | Non-interactive patch release (`--yes`) |
| `bun run release:minor` | Non-interactive minor release |
| `bun run release:major` | Non-interactive major release |
| `bun run release:status` | Alias for status |

## How version numbers are chosen

The CLI resolves the **latest released version** as the highest semver among:

1. [`releases/pins.json`](../../releases/pins.json) → `current`
2. Local git tags matching `v*`
3. [`package.json`](../../package.json) → `version`

Then it bumps:

- `patch` → `0.1.0` → `0.1.1`
- `minor` → `0.1.0` → `0.2.0`
- `major` → `0.1.0` → `1.0.0`

## Typical workflow

```bash
git checkout main
git pull

bun run release status
bun run release patch
```

What the CLI does on release:

1. `git fetch origin --tags` (unless `--no-fetch`)
2. Verify branch, clean worktree, and no duplicate tag
3. Ask for confirmation (unless `--yes`)
4. Create annotated tag `vX.Y.Z`
5. Push branch and tag to `origin`
6. GitHub Actions [`release.yml`](../../.github/workflows/release.yml) starts

## Options

| Flag | Effect |
| --- | --- |
| `--dry-run` | Print actions without tagging or pushing |
| `--yes`, `-y` | Skip confirmation prompt |
| `--allow-dirty` | Allow uncommitted changes |
| `--no-fetch` | Skip `git fetch` before release |
| `--no-push-branch` | Push tag only, not the current branch |
| `--bump-package` | Update `package.json` version before tagging |
| `--branch <name>` | Expected branch (default: `main`) |

## Examples

Preview the next patch without changing anything:

```bash
bun run release patch --dry-run
```

Hotfix after a bad release:

```bash
bun run release patch --yes
```

Explicit version for a planned milestone:

```bash
bun run release 0.3.0
```

## Preconditions

The CLI fails fast when:

- You are not on the expected branch (default `main`)
- The working tree is dirty (unless `--allow-dirty`)
- The branch is behind its upstream remote
- The tag already exists locally or on `origin`

## After the tag pushes

You do **not** need to build artifacts locally. CI publishes web, docker, desktop, manifest, and pins.

Track progress in GitHub Actions → **Release**.

On-prem customers update separately with the command printed at the end:

```bash
BIDTOOL_IMAGE_TAG=0.2.0 bun run onprem:update
```

## Related docs

- [Operating guide](./operating-guide.md)
- [CI/CD review](./ci-cd.md)
- [Update flows](./flows.md)
