import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { env } from "~/env";
import { can, type Permission, type Role } from "~/lib/permissions";
import { auth } from "~/server/auth";

/**
 * Server-side (RSC) permission guard for settings sub-pages.
 *
 * The dashboard layout already guarantees an internal user (admin/manager/staff)
 * when auth is on. This adds the finer-grained check: a page requiring a specific
 * permission (e.g. `users:manage`) redirects users who lack it back to the
 * settings root, rather than relying only on the client component to hide its
 * contents. No-op when auth is disabled, matching the app-wide invariant.
 */
export async function requirePagePermission(
  permission: Permission,
): Promise<void> {
  if (env.AUTH_ENABLED !== "true") {
    return;
  }

  const session = await auth.api.getSession({ headers: await headers() });
  const role = session?.user?.role as Role | undefined;

  if (!can(role, permission)) {
    redirect("/settings");
  }
}
