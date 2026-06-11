# Local Update Development

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

## Manifest generation

Generate a manifest locally:

```bash
bun run ./scripts/generate-release-manifest.ts --input dist-release/manifest-input.json
```

Update pins locally:

```bash
bun run ./scripts/update-release-pins.ts \
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
