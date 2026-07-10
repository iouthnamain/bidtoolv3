"use client";

import { useMemo } from "react";

import type { Permission, Role } from "~/lib/permissions";

/** Compatibility-only shape for legacy user-management components. */
type LegacyUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  tenantId: string | null;
};

export interface UsePermissionsResult {
  /** The current user's canonical role, or null when unauthenticated/unknown. */
  role: Role | null;
  /** Returns true if the current role grants the given permission. */
  can: (permission: Permission) => boolean;
  /** True for internal roles (admin/manager/staff), false for customer/none. */
  isInternal: boolean;
  /** The raw session user, or null when there is no session. */
  user: LegacyUser | null;
  /** True while the session is still loading (avoid flashing gated UI). */
  isPending: boolean;
  /** True when a development-only synthetic role is driving the UI. */
  isPreview: boolean;
  /** True when the development-only role preview control can be shown. */
  previewAvailable: boolean;
}

/**
 * BidTool is a single-user local dashboard. Keep the familiar hook shape for
 * existing UI, but do not load a browser session client or synthesize a role.
 */
export function usePermissions(): UsePermissionsResult {
  const can = useMemo(() => (_permission: Permission) => true, []);

  return {
    role: null,
    can,
    isInternal: false,
    user: null,
    isPending: false,
    isPreview: false,
    previewAvailable: false,
  };
}
