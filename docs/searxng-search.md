# SearXNG Search

BidTool uses SearXNG as the only web search provider for material enrichment and Excel research. Configure it from `/settings/search` or with env vars. Env vars override database settings and lock matching UI fields.

## Local Dev

```bash
docker compose up -d searxng
```

Use `SEARXNG_BASE_URL=http://localhost:8888` when the Next.js app runs on the host.

## On-Prem Compose

`compose.production.yml` includes an internal `searxng` service. The app default is:

```env
SEARXNG_BASE_URL=http://searxng:8080
SEARXNG_ENGINES=google,bing,duckduckgo
SEARXNG_LANGUAGE=vi-VN
```

SearXNG is not exposed publicly by default. Keep it private on the Docker network unless you have a reverse proxy with auth.

## VPS Secondary

Minimal VPS compose:

```yaml
services:
  searxng:
    image: searxng/searxng:latest
    restart: unless-stopped
    expose:
      - "8080"
    volumes:
      - ./deploy/searxng:/etc/searxng:ro
    environment:
      SEARXNG_SECRET_KEY: "${SEARXNG_SECRET_KEY}"
      SEARXNG_BASE_URL: "https://search.example.com/"
```

Reverse proxy with bearer token gate:

```caddyfile
search.example.com {
  @missingToken not header Authorization "Bearer {$SEARXNG_API_KEY}"
  respond @missingToken 401
  reverse_proxy searxng:8080
}
```

Point BidTool at the VPS:

```env
SEARXNG_BASE_URL=https://search.example.com
SEARXNG_API_KEY=replace-with-shared-secret
```

Then open `/settings/search` and run test query:

```txt
Ống nhựa Bình Minh D90 thông số kỹ thuật
```

Check that engines are `google,bing,duckduckgo`, language is `vi-VN`, ranking reasons show VN/domain/spec signals, and an audit row is created.
