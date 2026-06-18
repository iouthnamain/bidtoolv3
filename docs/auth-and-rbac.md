# Authentication & RBAC Plan

Plan for adding authentication and role-based access control (RBAC) to BidTool
v3. Today the app ships with **no authentication by design** — it is treated as
a single-user / single-tenant tool, with network isolation handled by Caddy and
host ports rather than in-app auth. This document describes the move from that
model to **multiple users with differentiated permissions** across all three
deployment surfaces.

> Status: **planned, not yet implemented.** This is the agreed design; code
> lands in the phased rollout described at the end.

---

## Decisions (locked)

| Decision | Choice |
| --- | --- |
| Scope | Full RBAC — multiple users with differentiated roles |
| Roles | `admin` / `editor` / `viewer` (start with three; expandable) |
| Surfaces enforcing auth | All three (`web`, `onprem`, `desktop-bundled`) |
| Library | [Better Auth](https://better-auth.com) — self-hosted, Drizzle adapter, `admin` plugin |
| Auth method | Email + password, sessions in HTTP-only cookies |

**Why Better Auth:** it is TypeScript-native, runs entirely self-hosted (no
third-party calls, so it works in an air-gapped on-prem Docker stack), has a
first-class Drizzle adapter, and ships an `admin` plugin with role management
and access-control primitives that map cleanly onto our routers.

---

## Current state (review)

- **No authentication anywhere.** `src/server/api/trpc.ts` exposes a single
  `publicProcedure` (rate-limit + timing middleware only). The tRPC context is
  just `{ db, headers }` — no session, no user.
- **No `src/middleware.ts`**, no route guards. The `(dashboard)` route group
  renders for anyone who can reach the server.
- **No user/role concept in the schema.** The closest thing is an `actor` text
  column (default `"system"`) on audit tables (`excel_workspace_events`,
  `excel_research_change_log`, `material_enrichment_events`) — useful later for
  attributing actions to a real user.
- **File downloads are unguarded** — `src/app/api/catalog-pdfs/[id]/file/route.ts`
  serves files with no check.
- **Rate limiting is one global token bucket**, not per-user.
- **Three deployment surfaces** from one codebase, selected by
  `BIDTOOL_DEPLOYMENT_SURFACE` (`web` | `onprem` | `desktop-bundled`).

---

## The core design tension

RBAC only matters where there is more than one human:

- **On-prem (single-tenant)** — one customer org, several employees → admin vs
  editor vs viewer. This is the real RBAC target.
- **Web (hosted internal)** — your team → same role model applies.
- **Desktop-bundled local** — one person on their machine → auth is friction
  with little value, so the login gate stays but the first run auto-bootstraps a
  local admin.

Auth is therefore **surface-aware**, gated on `BIDTOOL_DEPLOYMENT_SURFACE` plus
an `AUTH_ENABLED` flag, rather than unconditionally on.

---

## 1. Dependencies & environment

- Add the `better-auth` dependency.
- New env vars in `src/env.js`:

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `BETTER_AUTH_SECRET` | yes (when auth on) | — | Min 32 chars. Generate: `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | recommended | derive from `APP_BASE_URL` | Base URL for auth callbacks |
| `AUTH_ENABLED` | no | `false` | Master switch; off during early rollout |
| `AUTH_BOOTSTRAP_TOKEN` | no | — | One-time token to create the first admin (web/on-prem) |
| `AUTH_DESKTOP_AUTO_ADMIN` | no | `true` | Desktop: auto-create + sign in a local admin on first run |

---

## 2. Schema (new Drizzle migration)

Generate Better Auth's tables with `npx @better-auth/cli@latest generate`
(Drizzle mode) so they match the adapter exactly, then wire them into
`src/server/db/schema.ts` and produce a migration via the existing
`bun run db:generate` / `db:migrate` flow.

- `user` — id, email, name, emailVerified, image, `role`
  (`admin|editor|viewer`, default `viewer`), `banned`, `banReason`, timestamps
- `session` — id, userId, token, expiresAt, ipAddress, userAgent
- `account` — credentials (hashed password lives here), provider linkage
- `verification` — tokens

Going forward, backfill the existing `actor` audit columns with the acting
`user.id`.

---

## 3. Auth core (new files)

- `src/server/auth.ts` — `betterAuth({ database: drizzleAdapter(db),
  emailAndPassword: { enabled: true }, plugins: [admin({ defaultRole: "viewer",
  adminRoles: ["admin"] })], advanced: { useSecureCookies: surface !==
  "desktop-bundled" } })`.
- `src/app/api/auth/[...all]/route.ts` — mount the Better Auth handler.
- `src/lib/auth-client.ts` — `createAuthClient` with the `adminClient` plugin
  for the React side.

---

## 4. RBAC permission model

One shared source of truth, read by both server and client:

- `src/lib/permissions.ts` — an access-control statement set plus a
  `role → permissions` map. Permissions:
  `material:write`, `material:delete`, `watchlist:write`, `excelResearch:run`,
  `enrichment:run`, `ai:run`, `scrape:run`, `catalog:write`, `workflow:write`,
  `settings:manage`, `users:manage`, `onprem:admin`.

Role mapping:

- `viewer` = read-only everywhere
- `editor` = all `*:write` / `*:run` except `settings:manage`, `users:manage`,
  `onprem:admin`
- `admin` = everything

| Router area | viewer | editor | admin |
| --- | --- | --- | --- |
| search, dashboard, read materials/notifications | ✓ | ✓ | ✓ |
| material / watchlist / catalog / workflow writes | | ✓ | ✓ |
| excelResearch, enrichment, AI, scrape jobs | | ✓ | ✓ |
| settings (API keys), user mgmt, on-prem admin, updates | | | ✓ |

---

## 5. tRPC integration (`src/server/api/trpc.ts`)

- Extend `createTRPCContext` to resolve the session via
  `auth.api.getSession({ headers })` → attach `{ user, session }` (or `null`).
- New procedures layered on the existing rate-limit + timing chain:
  - `protectedProcedure` — throws `UNAUTHORIZED` when no user.
  - `requirePermission(perm)` — middleware checking the permission map, throws
    `FORBIDDEN`.
- Migrate each router: reads stay open to any authenticated user; mutations move
  to `requirePermission(...)`. Keep `version` and `/api/health` public.
- Make the rate-limit bucket keyed **per user** once sessions exist (today it is
  one global bucket).

---

## 6. Route / RSC / file guards

- `src/middleware.ts` — redirect unauthenticated requests to `/login`; allow
  `/login`, `/api/auth/*`, health/version, and static assets. No-op when auth is
  disabled for the surface.
- Guard the `(dashboard)` layout **server-side** as well (RSC defense in depth;
  middleware alone is not sufficient).
- Protect `src/app/api/catalog-pdfs/[id]/file/route.ts` (currently unguarded).
- New `src/app/login/page.tsx` and a minimal account / `/setup` page.

---

## 7. Surface-aware behavior

Gate on `BIDTOOL_DEPLOYMENT_SURFACE`:

- **web / on-prem** — auth required. First admin created via a seed script or a
  one-time `/setup` page gated by `AUTH_BOOTSTRAP_TOKEN`.
- **desktop-bundled** — auth still on, but when `AUTH_DESKTOP_AUTO_ADMIN=true`
  and the DB has no users, bootstrap a local admin and establish a session
  automatically so the solo user is not blocked. When the desktop client points
  at a remote on-prem server (`BIDTOOL_SERVER_URL`), that server enforces auth
  normally.

---

## 8. UI

- User-management screen under `/settings` (list, invite/create, set role,
  deactivate) — admin only, via the admin plugin client methods.
- Hide/disable action buttons by permission using a `useSession`-derived
  `can(permission)` helper backed by the same `src/lib/permissions.ts` map.
- Header shows the current user + sign-out.

---

## 9. Rollout (each step independently shippable)

1. Add Better Auth + schema + login page + handler. Auth **disabled** by default
   (`AUTH_ENABLED=false`) — zero behavior change.
2. tRPC context resolves user; add `protectedProcedure`; add middleware behind
   the flag.
3. Add role enum + `permissions.ts` + `requirePermission` on all mutating
   routers.
4. UI: permission-gated actions, user-management screen, seed / bootstrap admin.
5. Flip `AUTH_ENABLED=true` for web + on-prem, enable desktop auto-admin;
   backfill `actor` with real user ids.

---

## Risks & things to watch

- **Migration ordering.** The new auth tables must migrate **before**
  `AUTH_ENABLED=true` flips, or existing deployments lock out. The on-prem
  entrypoint already runs `db-migrate-runtime.mjs` on boot, so sequence each
  release as "ship migrations, then flip the flag."
- **No SMTP on-prem.** Air-gapped installs have no outbound email. Default
  `requireEmailVerification: false` and let admins reset passwords directly (the
  admin plugin supports this) rather than depending on verification email.
- **Secure cookies.** Force HTTPS cookies on web/on-prem; relax only for
  `desktop-bundled` local (`http://localhost`).
- **Deployment doc update.** `docs/deployment.md` currently states "The app does
  not have authentication by design." Update that section when auth ships.

---

## References

- [Better Auth docs](https://better-auth.com/docs)
- [Better Auth admin plugin](https://better-auth.com/docs/plugins/admin)
- `docs/deployment.md` — deployment surfaces and env var reference
