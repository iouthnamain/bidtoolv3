# syntax=docker/dockerfile:1

FROM oven/bun:1.3.11-alpine AS deps
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM deps AS builder
WORKDIR /app

ARG BIDTOOL_APP_VERSION=0.1.0
ARG BIDTOOL_BUILD_METADATA=""
ARG BIDTOOL_DEPLOYMENT_SURFACE=onprem

COPY . .

ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
ENV NODE_ENV="production"
ENV SKIP_ENV_VALIDATION="1"
ENV BIDTOOL_APP_VERSION="${BIDTOOL_APP_VERSION}"
ENV BIDTOOL_BUILD_METADATA="${BIDTOOL_BUILD_METADATA}"
ENV BIDTOOL_DEPLOYMENT_SURFACE="${BIDTOOL_DEPLOYMENT_SURFACE}"
ENV BIDTOOL_PACKAGE_VERSION="${BIDTOOL_APP_VERSION}"

RUN bun run build

FROM node:22-alpine AS runner
WORKDIR /app

RUN apk add --no-cache tini

ENV HOSTNAME="0.0.0.0"
ENV NODE_ENV="production"
ENV PORT="3000"
ARG BIDTOOL_APP_VERSION=0.1.0
ARG BIDTOOL_BUILD_METADATA=""
ARG BIDTOOL_DEPLOYMENT_SURFACE=onprem
ENV BIDTOOL_APP_VERSION="${BIDTOOL_APP_VERSION}"
ENV BIDTOOL_BUILD_METADATA="${BIDTOOL_BUILD_METADATA}"
ENV BIDTOOL_DEPLOYMENT_SURFACE="${BIDTOOL_DEPLOYMENT_SURFACE}"
ENV BIDTOOL_PACKAGE_VERSION="${BIDTOOL_APP_VERSION}"

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/drizzle ./drizzle
COPY --from=deps /app/node_modules ./node_modules
COPY docker/entrypoint.sh ./docker/entrypoint.sh
COPY scripts/db-migrate-runtime.mjs ./scripts/db-migrate-runtime.mjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--", "/app/docker/entrypoint.sh"]
CMD ["node", "server.js"]
