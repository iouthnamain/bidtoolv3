# Update Flows

This page describes how updates move through BidTool for each surface: release, runtime checks, apply, and rollback.

## 1. Unified release flow

One Git tag (`v0.2.0`) is the release unit. CI builds every artifact, writes one manifest, and commits artifact pins.

```mermaid
flowchart TD
  dev[Developer pushes tag v0.2.0] --> ci[GitHub Actions release.yml]
  ci --> quality[Quality gates]
  quality --> parallel[Parallel builds]
  parallel --> web[Build web artifact]
  parallel --> docker[Push GHCR image]
  parallel --> bundle[Build on-prem tarball]
  parallel --> deskWin[Build Windows desktop]
  parallel --> deskLinux[Build Linux desktop]
  web --> vercel[Promote Vercel production]
  docker --> digest[Capture image digest]
  vercel --> manifest[Generate manifest.json]
  digest --> manifest
  bundle --> manifest
  deskWin --> manifest
  deskLinux --> manifest
  manifest --> ghRelease[Publish GitHub Release]
  ghRelease --> pins[Update releases/pins.json]
  pins --> commit[Commit pins to main]
```

**Outcome**

| Artifact | Where it lands | Version example |
| --- | --- | --- |
| Web | Vercel production deployment | `0.2.0+web.abc1234` |
| On-prem | `ghcr.io/.../bidtoolv3:0.2.0` and `:latest` | `0.2.0+onprem.abc1234` |
| Desktop | GitHub Release `.exe` / `.AppImage` | `0.2.0+desktop.win.abc1234` |
| Metadata | Release asset `manifest.json` | semver `0.2.0` |
| Pins | Committed `releases/pins.json` | deployment ID, digest, URLs |

Web production does **not** update from every `main` push. It moves only when the release workflow promotes a tagged build.

---

## 2. Runtime version check flow

Every running instance can answer: *what am I on?* and *is something newer available?*

```mermaid
flowchart LR
  ui[Dashboard / Settings UI] --> api["GET /api/version or version.getStatus"]
  api --> env[Read BIDTOOL_APP_VERSION and BIDTOOL_BUILD_METADATA]
  api --> manifest[Load latest manifest]
  manifest --> pathA[BIDTOOL_MANIFEST_PATH local file]
  manifest --> pathB[BIDTOOL_PINS_URL then manifestUrl]
  manifest --> pathC[Fallback GitHub Release manifest URL]
  env --> compare[Compare current vs latest semver]
  manifest --> compare
  compare --> response[Return updateAvailable changelog updateCommand]
```

**Resolution order**

1. **Current version** — from env (`BIDTOOL_APP_VERSION`, `BIDTOOL_BUILD_METADATA`, `BIDTOOL_DEPLOYMENT_SURFACE`)
2. **Latest version** — from manifest, loaded via:
   - local file (`BIDTOOL_MANIFEST_PATH`) for air-gapped on-prem, or
   - `releases/pins.json` → `manifestUrl`, or
   - GitHub Release `manifest.json` fallback
3. **Response** — includes `updateAvailable`, `changelog`, and (for on-prem) `updateCommand`

Manifest data is cached in memory for about 10 minutes.

---

## 3. Web flow

Web has no in-app “Apply update” button. Users always hit whatever production deployment the release pipeline last promoted.

```mermaid
sequenceDiagram
  participant Dev as Developer
  participant CI as release.yml
  participant Vercel as Vercel production
  participant User as Browser user

  Dev->>CI: Push tag v0.2.0
  CI->>CI: Build Next.js artifact
  CI->>Vercel: vercel deploy --prebuilt --prod
  Note over Vercel: Env BIDTOOL_APP_VERSION=0.2.0
  User->>Vercel: Open app
  Vercel->>User: Serves new build automatically
```

**Settings → About** on web shows version info and notes that production is managed by the release pipeline. No manual update step.

---

## 4. On-prem flow (hybrid)

The app **detects** updates and **guides** ops. The app does **not** run `docker compose pull` itself.

```mermaid
sequenceDiagram
  participant App as BidTool app container
  participant Manifest as manifest.json
  participant UI as Banner + Settings About
  participant Ops as Operator
  participant Script as onprem-update.sh
  participant Docker as Docker Compose

  App->>Manifest: Fetch latest version
  Manifest-->>App: latest=0.2.0 changelog
  App->>UI: updateAvailable=true
  UI->>Ops: Show banner + copy command
  Ops->>Script: BIDTOOL_IMAGE_TAG=0.2.0 bun run onprem:update
  Script->>Script: Optional backup
  Script->>Script: Rewrite BIDTOOL_APP_IMAGE in .env.customer
  Script->>Docker: compose pull
  Script->>Docker: compose up -d
  Docker->>App: New container starts migrations on boot
```

**Operator steps**

1. See dismissible banner or open **Settings → About**
2. Copy `BIDTOOL_IMAGE_TAG=0.2.0 bun run onprem:update`
3. Run on the host (SSH or automation), not inside the app container
4. Script pulls the pinned image, recreates the stack, migrations run on container start

**Air-gapped**

Bundle includes `releases/`. Set `BIDTOOL_MANIFEST_PATH` or `BIDTOOL_MANIFEST_URL` to a local manifest copy so the app can compare versions without reaching GitHub.

---

## 5. Desktop flow

Desktop has two parts:

- **Shell** — Electron app, updated via `electron-updater`
- **Server** — either bundled local Next server or remote on-prem URL

```mermaid
flowchart TD
  subgraph shell [Desktop shell update]
    start[App startup] --> check[autoUpdater check GitHub Release]
    poll[Poll every 30 min] --> check
    manual[Settings About Check for update] --> check
    check --> available{Update available?}
    available -->|yes| pill[Sidebar update pill]
    pill --> download[User clicks Download]
    download --> ready[Update downloaded]
    ready --> confirm[User confirms install]
    confirm --> restart[quitAndInstall restart]
  end

  subgraph server [Server version shown in Settings]
    remote[Remote on-prem URL configured] --> versionApi[/api/version on server]
    bundled[Bundled local server] --> versionApi
    versionApi --> about[Settings About server version row]
  end
```

**Typical user path**

1. Sidebar pill appears when an update is available
2. User downloads the update (or retries from Settings → About)
3. User confirms install — warned that running tasks may be interrupted
4. App restarts on the new shell version

**Remote server mode**

Electron shell and on-prem server update independently. Settings shows server version from `/api/version`; shell updates from GitHub Releases.

**Local dev / testing**

```bash
bun run start:mock-update-server
BIDTOOL_DESKTOP_MOCK_UPDATES=1 bun run desktop:start
```

Mock server serves artifacts from `release-mock/` instead of GitHub.

---

## 6. Rollback flow

Rollback re-promotes **pinned artifacts**. It does not rebuild old code.

```mermaid
flowchart TD
  ops[Operator runs rollback.yml] --> load[Read releases/pins.json target version]
  load --> web[Vercel promote pinned deployment ID]
  load --> docker[Retag pinned digest as GHCR latest]
  load --> note[Desktop unchanged until users update manually]
  load --> dbWarn[DB migrations are forward-only]
```

| Surface | Rollback behavior |
| --- | --- |
| Web | Vercel promotes previous deployment from pin |
| On-prem | `:latest` image retagged to previous digest |
| Desktop | Users stay on installed version until they update |
| Database | **Not rolled back** — ship forward hotfix if schema drift breaks old app |

If migrations already ran, prefer a hotfix tag (`v0.2.1`) over rolling back app code.

---

## 7. End-to-end picture

```mermaid
flowchart TB
  subgraph publish [Publish once per tag]
    tag[v0.2.0 tag] --> manifest[manifest.json]
    tag --> pins[pins.json]
    tag --> artifacts[web docker desktop bundle]
  end

  subgraph webRun [Web runtime]
    artifacts --> vercelProd[Vercel production]
    vercelProd --> webUsers[Users always on latest promoted build]
  end

  subgraph onpremRun [On-prem runtime]
    manifest --> appCheck[App version API]
    appCheck --> banner[Banner + Settings]
    banner --> script[onprem-update.sh]
    script --> dockerStack[Docker stack]
  end

  subgraph desktopRun [Desktop runtime]
    artifacts --> ghRelease[GitHub Release feed]
    ghRelease --> electron[electron-updater]
    electron --> desktopUser[Download install restart]
  end
```

---

## Related docs

- [Phase 1: Release orchestrator](./phase-1-release-orchestrator.md)
- [Phase 2: Version API](./phase-2-version-api.md)
- [Phase 3: Desktop UX](./phase-3-desktop-ux.md)
- [Phase 4: On-prem admin UI](./phase-4-onprem-admin-ui.md)
- [Rollback](./rollback.md)
- [Local development](./local-dev.md)
