"use client";

import type { ReactNode } from "react";

import type { Permission } from "~/lib/permissions";

export function PermissionGate({
  children,
}: {
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  // Local BidTool is intentionally a single-user application. Preserve this
  // component's API so existing material/workflow controls stay compatible,
  // but never hide an in-scope action behind a retired role gate.
  return <>{children}</>;
}
