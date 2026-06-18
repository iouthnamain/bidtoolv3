/**
 * Single shared source of truth for role-based access control (RBAC).
 *
 * Imported by both the server (tRPC middleware) and the client (UI gating).
 * Pure TypeScript: no dependencies, no DB access, no React.
 *
 * Only mutations and runs are gated here. Reads (search, dashboard, viewing
 * materials/notifications) are open to any authenticated user and are NOT
 * represented as permissions.
 *
 * Customer tenant-isolation and portal scoping are enforced elsewhere; the
 * empty customer permission set below only reflects that customers have no
 * write/run capabilities.
 */

/** The four roles, in canonical order. */
export const ROLES = ["admin", "manager", "staff", "customer"] as const;

/** A user role. */
export type Role = (typeof ROLES)[number];

/** Every gated permission (mutations and runs only). */
export const PERMISSIONS = [
  "material:write",
  "material:delete",
  "watchlist:write",
  "excelResearch:run",
  "enrichment:run",
  "ai:run",
  "scrape:run",
  "catalog:write",
  "workflow:write",
  "settings:manage",
  "users:manage",
  "onprem:admin",
] as const;

/** A single permission string literal. */
export type Permission = (typeof PERMISSIONS)[number];

/** All operational writes and runs (staff capabilities). */
const OPERATIONAL_PERMISSIONS = [
  "material:write",
  "material:delete",
  "watchlist:write",
  "excelResearch:run",
  "enrichment:run",
  "ai:run",
  "scrape:run",
  "catalog:write",
  "workflow:write",
] as const satisfies readonly Permission[];

/**
 * Role -> permission mapping. Decided by the project owner; intentionally
 * differs from the doc's editor/viewer model.
 *
 * - admin:    all permissions.
 * - manager:  governance only (settings + users), no operational work.
 * - staff:    all operational writes/runs, no governance/onprem.
 * - customer: none (read-only).
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: [...PERMISSIONS],
  manager: ["settings:manage", "users:manage"],
  staff: [...OPERATIONAL_PERMISSIONS],
  customer: [],
};

/** Roles that get dashboard access (admin/manager/staff), vs. customer portal. */
const INTERNAL_ROLES = new Set<Role>(["admin", "manager", "staff"]);

/**
 * Returns true if the role grants the given permission. Returns false for a
 * null/undefined role (unauthenticated or unknown).
 */
export function hasPermission(
  role: Role | null | undefined,
  permission: Permission,
): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * Primary permission helper. Alias of {@link hasPermission}; this is the
 * canonical name used across server middleware and UI gating, e.g.
 * `can(currentRole, "material:write")`.
 */
export function can(
  role: Role | null | undefined,
  permission: Permission,
): boolean {
  return hasPermission(role, permission);
}

/**
 * Returns true for internal roles (admin/manager/staff) that access the
 * dashboard, and false for customer or a null/undefined role. Used to decide
 * dashboard vs. portal access.
 */
export function isInternalRole(role: Role | null | undefined): boolean {
  if (!role) return false;
  return INTERNAL_ROLES.has(role);
}
