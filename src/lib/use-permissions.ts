"use client";

import { useMemo } from "react";

import { useSession } from "~/lib/auth-client";
import {
  can as canPure,
  isInternalRole,
  ROLES,
  type Permission,
  type Role,
} from "~/lib/permissions";

/**
 * Narrow an unknown role string from the session into our canonical {@link Role}
 * union, or null if it is missing/unrecognized.
 */
function normalizeRole(role: string | null | undefined): Role | null {
  if (role && (ROLES as readonly string[]).includes(role)) {
    return role as Role;
  }
  return null;
}

/** The session user payload (includes the custom `tenantId` field). */
type SessionUser = NonNullable<
  ReturnType<typeof useSession>["data"]
>["user"];

export interface UsePermissionsResult {
  /** The current user's canonical role, or null when unauthenticated/unknown. */
  role: Role | null;
  /** Returns true if the current role grants the given permission. */
  can: (permission: Permission) => boolean;
  /** True for internal roles (admin/manager/staff), false for customer/none. */
  isInternal: boolean;
  /** The raw session user, or null when there is no session. */
  user: SessionUser | null;
  /** True while the session is still loading (avoid flashing gated UI). */
  isPending: boolean;
}

/**
 * Client hook deriving role-based permissions from the Better Auth session.
 *
 * Pure RBAC logic lives in `~/lib/permissions`; this hook only wires the live
 * session into those pure helpers so UI can hide/disable actions. It is safe
 * when auth is disabled or there is no session: role is null and `can()`
 * returns false for everything.
 */
export function usePermissions(): UsePermissionsResult {
  const { data, isPending } = useSession();
  const user = data?.user ?? null;
  const role = normalizeRole(user?.role);

  const can = useMemo(() => {
    return (permission: Permission) => canPure(role, permission);
  }, [role]);

  return {
    role,
    can,
    isInternal: isInternalRole(role),
    user,
    isPending,
  };
}
