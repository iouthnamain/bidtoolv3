# 07 — Deployment

## Surfaces (unchanged intent)

| Surface | Artifact | Update path |
| --- | --- | --- |
| On-prem Docker | `web` + `api` + `worker` images | `docs/updates/` on-prem scripts |
| Electron desktop | Bundled static web + local api/worker | `electron-updater` |
| Web (optional) | Same compose or static CDN + api | GitHub release / Vercel static (api separate) |

Option B **removes** Next.js standalone as the runtime unit.

---

## Production Docker topology

```yaml
# compose.production.yml (target)
services:
  caddy:
    # routes:
    #   /     → web:80
    #   /api  → api:3001
    #   (no direct worker exposure)

  web:
    image: ghcr.io/.../bidtoolv3-web:${TAG}
  api:
    image: ghcr.io/.../bidtoolv3-api:${TAG}
    environment:
      DATABASE_URL: ...
      BIDTOOL_RUN_MIGRATIONS: "true"
  worker:
    image: ghcr.io/.../bidtoolv3-worker:${TAG}
    environment:
      DATABASE_URL: ...
      SCRAPE_MAX_CONCURRENT_JOBS: "2"
    # optional: shm_size for chromium
    shm_size: "1gb"
  postgres:
    image: postgres:16-alpine
```

### Caddyfile change

```
:80 {
  handle /api/* {
    reverse_proxy api:3001
  }
  handle {
    reverse_proxy web:80
  }
}
```

Healthchecks:

- `web`: `GET /` → 200
- `api`: `GET /api/health` → 200
- `worker`: `GET :3002/health` → 200

---

## Dockerfiles (multi-stage)

### `apps/web/Dockerfile`

```dockerfile
FROM oven/bun:1.3 AS builder
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bun run --filter @bidtool/web build

FROM nginx:alpine
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY deploy/nginx/web.conf /etc/nginx/conf.d/default.conf
```

### `apps/api/Dockerfile`

```dockerfile
FROM oven/bun:1.3 AS builder
# build domain + api
FROM node:22-alpine AS runner
COPY --from=builder /app/apps/api/dist ./api
COPY --from=builder /app/node_modules ./node_modules
COPY drizzle ./drizzle
COPY docker/entrypoint-api.sh ./entrypoint.sh
ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "api/index.js"]
```

### `apps/worker/Dockerfile`

```dockerfile
FROM oven/bun:1.3 AS builder
FROM node:22-alpine AS runner
RUN apk add --no-cache chromium # or bundle playwright browsers
COPY --from=builder /app/apps/worker/dist ./worker
# ...
CMD ["node", "worker/index.js"]
```

Playwright browser install: follow current Dockerfile pattern; browsers only in worker image.

---

## Electron desktop

### Current

`electron/main.cjs` spawns Next standalone on random port.

### Target

```text
electron/main.cjs
  ├── spawn api (port 3001)
  ├── spawn worker
  ├── serve web static OR spawn nginx/caddy mini
  └── load BrowserWindow → http://127.0.0.1:${WEB_PORT}
```

Shutdown order on quit: worker → api → web static server.

### Build pipeline change

Replace:

```bash
bun run build-next.ts --dist .next-electron
```

With:

```bash
turbo build --filter=@bidtool/web --filter=@bidtool/api --filter=@bidtool/worker
bun run scripts/prepare-electron-bundle.ts
```

Package `apps/web/dist`, `apps/api/dist`, `apps/worker/dist`, playwright browsers into ASAR/external.

---

## CI/CD changes

### GitHub Actions (from `docs/updates/ci-cd.md`)

| Job | Change |
| --- | --- |
| Build | `turbo build` all apps |
| Test | vitest + playwright e2e with compose services |
| Publish | Push 3 images: `bidtoolv3-web`, `bidtoolv3-api`, `bidtoolv3-worker` |
| Desktop | Electron build consumes same dist artifacts |

### Version endpoints

Keep compatibility:

- `GET /api/version` on **api** service
- Update `docs/updates/phase-2-version-api.md` reference from Next route to Hono route

### Release manifest

Add optional fields:

```json
{
  "images": {
    "web": "ghcr.io/.../bidtoolv3-web:0.2.0",
    "api": "ghcr.io/.../bidtoolv3-api:0.2.0",
    "worker": "ghcr.io/.../bidtoolv3-worker:0.2.0"
  }
}
```

---

## On-prem scripts

Update `scripts/onprem-package-release.sh` to include:

- `compose.production.yml` (multi-service)
- `.env.customer.example` with new ports/env vars
- Migration notes for single-image → multi-image upgrade

`onprem-update.sh`: pull all three images; rolling restart order worker → api → web.

---

## Environment variables (production)

```bash
# Shared
DATABASE_URL=postgresql://...
BIDTOOL_APP_VERSION=1.0.0
BIDTOOL_DEPLOYMENT_SURFACE=onprem

# api
PORT=3001
BIDTOOL_RUN_MIGRATIONS=true
BIDWINNER_BASE_URL=https://bidwinner.info
APP_BASE_URL=https://bidtool.customer.local

# worker
SCRAPE_MAX_CONCURRENT_JOBS=2
SCRAPE_MAX_CONCURRENT_PAGES=4
IMPORT_MAX_CONCURRENT_JOBS=1

# web build-time
VITE_API_BASE_URL=/api   # relative when behind Caddy
```

---

## Local dev vs production parity

| Concern | Dev | Prod |
| --- | --- | --- |
| API origin | `http://localhost:3001` | `/api` via Caddy |
| CORS | Allow `localhost:5173` | Disabled (same origin) |
| HTTPS | Optional | Caddy TLS |
| Migrations | Manual `db:migrate` | api entrypoint |

---

## Rollback strategy

Pin all three images to same version tag in `releases/pins.json`:

```json
{
  "onprem": {
    "web": "0.1.5",
    "api": "0.1.5",
    "worker": "0.1.5"
  }
}
```

Rollback = set all pins to previous semver; `onprem-update.sh`.

Database migrations must be **backward compatible** one release (expand → contract pattern).

---

## Resource sizing (on-prem guidance)

| Service | CPU | RAM |
| --- | --- | --- |
| web | 0.25 | 128 MB |
| api | 0.5 | 512 MB |
| worker | 1–2 | 2–4 GB (Chromium) |
| postgres | 0.5 | 512 MB–1 GB |

Single-machine minimum: **4 GB RAM** for comfortable scraping.

---

## Security

- Worker port not exposed externally
- Postgres not exposed on public interface (compose internal network only)
- Same SSRF protections in `assertSafeScrapeUrl` (domain package)
- Optional: Caddy basic auth for LAN deployments
