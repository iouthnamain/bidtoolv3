import "server-only";

import { eq, sql } from "drizzle-orm";

import { env } from "~/env";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { tenant, user } from "~/server/db/schema";

/**
 * Desktop auto-admin bootstrap (Phase 7, Task B).
 *
 * On the desktop-bundled surface the app is a single-user local tool running on
 * http://localhost. When AUTH_ENABLED flips on, a solo desktop user would
 * otherwise be locked out behind a sign-in wall with no account. This module
 * seeds a local admin (and signs nothing — it just creates the account) so the
 * desktop user is never blocked.
 *
 * Intended call site: the Next.js `instrumentation.ts` `register()` hook (already
 * present in this repo, used to start the job scheduler). It runs once per
 * Node.js server boot. Wire it there guarded by surface — `ensureDesktopAdmin()`
 * is itself surface-guarded and idempotent, so the call is cheap and safe on
 * every boot. It never throws (errors are caught + logged) so it cannot crash
 * app startup.
 *
 * Security tradeoff: the desktop-bundled surface already relaxes secure cookies
 * (see src/server/auth.ts advanced.useSecureCookies) because it is localhost
 * only and not network-exposed. The auto-admin uses a deterministic local
 * credential (desktop-admin@localhost). This is acceptable ONLY for the local
 * single-user bundle — anyone with local machine access already controls the
 * app and its database. This path is gated to surface === "desktop-bundled" and
 * must never run on web/onprem, where real credentials are required via the
 * one-time /api/setup bootstrap instead.
 */

type DeploymentSurface = "web" | "onprem" | "desktop-bundled";

// Mirror src/server/auth.ts resolveSurface(): explicit env wins, then Vercel →
// web, otherwise default to on-prem. The function there is not exported, so the
// logic is duplicated rather than imported.
function resolveSurface(): DeploymentSurface {
  const configured = process.env.BIDTOOL_DEPLOYMENT_SURFACE?.trim();
  if (
    configured === "web" ||
    configured === "onprem" ||
    configured === "desktop-bundled"
  ) {
    return configured;
  }

  if (process.env.VERCEL === "1") {
    return "web";
  }

  return "onprem";
}

// Deterministic local credential for the single-user desktop bundle. See the
// security tradeoff note in the module header.
const DESKTOP_ADMIN_EMAIL = "desktop-admin@localhost";
const DESKTOP_ADMIN_NAME = "Desktop Admin";
const DESKTOP_ADMIN_PASSWORD = "desktop-local-admin";

const HOST_TENANT_SLUG = "host";
const HOST_TENANT_NAME = "Host Organization";

/**
 * Ensure the single host tenant exists and return its id. Idempotent via the
 * unique slug index. This duplicates the tiny helper in scripts/auth-backfill.ts
 * intentionally: that script uses a standalone postgres-js client while this
 * server module uses the app's Drizzle `db`, and cross-importing a script into a
 * server-only module is awkward.
 */
async function ensureHostTenant(): Promise<string> {
  await db
    .insert(tenant)
    .values({ name: HOST_TENANT_NAME, slug: HOST_TENANT_SLUG })
    .onConflictDoNothing({ target: tenant.slug });

  const rows = await db
    .select({ id: tenant.id })
    .from(tenant)
    .where(eq(tenant.slug, HOST_TENANT_SLUG))
    .limit(1);

  const hostTenant = rows[0];
  if (!hostTenant) {
    throw new Error("Failed to ensure host tenant: no row returned after upsert.");
  }
  return hostTenant.id;
}

/**
 * Create + promote a local admin on the desktop bundle if no user exists yet.
 * Safe to call on every boot:
 *   - no-op unless surface === "desktop-bundled" and both auth flags are "true"
 *   - no-op if ANY user already exists
 *   - never throws (catches + logs)
 */
export async function ensureDesktopAdmin(): Promise<void> {
  try {
    if (resolveSurface() !== "desktop-bundled") {
      return;
    }
    if (env.AUTH_ENABLED !== "true" || env.AUTH_DESKTOP_AUTO_ADMIN !== "true") {
      return;
    }

    // If any user exists, bootstrap has already happened — nothing to do.
    const existing = await db.select({ id: user.id }).from(user).limit(1);
    if (existing.length > 0) {
      return;
    }

    // Ensure the host tenant exists so the data model is coherent and the admin
    // can be attributed to it.
    const hostTenantId = await ensureHostTenant();

    // Create the user via Better Auth (hashes the password, creates the account
    // row). Mirrors src/app/api/setup/route.ts.
    await auth.api.signUpEmail({
      body: {
        name: DESKTOP_ADMIN_NAME,
        email: DESKTOP_ADMIN_EMAIL,
        password: DESKTOP_ADMIN_PASSWORD,
      },
    });

    // Promote to admin: signUpEmail can't set a role, and the admin set-role
    // endpoint requires an existing admin caller — so for the literal first user
    // we update the role column directly (same approach as /api/setup). Also
    // attribute the desktop admin to the host tenant and mark email verified so
    // the local user is never blocked by a verification wall.
    await db
      .update(user)
      .set({
        role: "admin",
        emailVerified: true,
        tenantId: sql`NULL`,
        updatedAt: new Date(),
      })
      .where(eq(user.email, DESKTOP_ADMIN_EMAIL));

    // Internal users (admin/manager/staff) are intentionally NOT tenant-scoped,
    // so the desktop admin keeps tenantId NULL; hostTenantId is ensured purely
    // so owned data has a coherent tenant to attribute to.
    void hostTenantId;

    console.log(
      `[auth-bootstrap] Created local desktop admin (${DESKTOP_ADMIN_EMAIL}).`,
    );
  } catch (error) {
    // Never crash startup: log and continue.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[auth-bootstrap] ensureDesktopAdmin failed: ${message}`);
  }
}
