# Local Update Development

## Release CLI (dry run)

Preview the next version and validate git state without tagging:

```bash
bun run release status
bun run release patch --dry-run
```

See [Release CLI](./release-cli.md) for full options.

## Mock desktop updater

1. Put updater artifacts in `release-mock/`
2. Start the mock server:

```bash
bun run start:mock-update-server
```

3. Launch a packaged desktop build with mock updates enabled:

```bash
BIDTOOL_DESKTOP_MOCK_UPDATES=1 BIDTOOL_DESKTOP_MOCK_UPDATE_PORT=3000 bun run desktop:start
```

Optional mock server flags:

```bash
bun run ./scripts/mock-update-server.ts --port 3000 --dir release-mock
```

## Manifest generation

Generate a manifest locally:

```bash
mkdir -p dist-release
# create dist-release/manifest-input.json (see CI fixture in .github/workflows/ci.yml)
bun run release:manifest --input dist-release/manifest-input.json --output dist-release/manifest.json
```

Update pins locally:

```bash
bun run release:pins \
  --manifest dist-release/manifest.json \
  --manifest-url https://github.com/iouthnamain/bidtoolv3/releases/download/v0.2.0/manifest.json
```

## Version API

With env configured, inspect runtime status:

```bash
curl http://localhost:3000/api/version
```

On-prem local stack:

```bash
BIDTOOL_DEPLOYMENT_SURFACE=onprem BIDTOOL_APP_VERSION=0.1.0 bun run start
```

## npm scripts reference

| Script | Purpose |
| --- | --- |
| `release` / `release:status` | Show current and next versions |
| `release:patch` / `release:minor` / `release:major` | Tag and push non-interactively |
| `release:manifest` | Generate `manifest.json` |
| `release:pins` | Update `releases/pins.json` |
| `start:mock-update-server` | Local desktop updater feed |
| `onprem:update` | Pull and recreate on-prem Docker stack |
