import "server-only";

import type { Permission } from "~/lib/permissions";

/** Compatibility no-op retained for existing settings pages in local mode. */
export async function requirePagePermission(
  _permission: Permission,
): Promise<void> {
  return;
}

export async function requireAdminRole(): Promise<void> {
  return;
}
