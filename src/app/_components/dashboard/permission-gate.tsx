"use client";

import type { ReactNode } from "react";

import { Badge } from "~/app/_components/ui";
import type { Permission } from "~/lib/permissions";
import { ROLE_LABELS } from "~/lib/role-surfaces";
import { usePermissions } from "~/lib/use-permissions";

const permissionLabels: Record<Permission, string> = {
  "material:write": "chỉnh sửa vật tư",
  "material:delete": "xóa vật tư",
  "watchlist:write": "cập nhật watchlist",
  "excelResearch:run": "chạy nghiên cứu Excel",
  "enrichment:run": "chạy làm giàu dữ liệu",
  "ai:run": "dùng AI",
  "scrape:run": "chạy scrape",
  "catalog:write": "cập nhật catalog PDF",
  "workflow:write": "cấu hình workflow",
  "settings:manage": "quản lý cài đặt",
  "users:manage": "quản lý người dùng",
  "onprem:admin": "quản trị on-prem",
};

export function PermissionGate({
  permission,
  children,
  fallback,
}: {
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { role, can } = usePermissions();
  const allowed = can(permission);

  if (allowed || !role) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">{ROLE_LABELS[role]}</Badge>
        <span>
          Vai trò này không có quyền {permissionLabels[permission]}. Nút thao
          tác được ẩn để tránh nhầm lẫn.
        </span>
      </div>
    </div>
  );
}
