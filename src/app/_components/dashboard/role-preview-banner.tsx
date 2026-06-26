"use client";

import { useRouter } from "next/navigation";

import { Badge } from "~/app/_components/ui";
import { ROLES, type Role } from "~/lib/permissions";
import {
  getRoleLandingPath,
  ROLE_CAPABILITIES,
  ROLE_LABELS,
} from "~/lib/role-surfaces";
import { usePermissions } from "~/lib/use-permissions";
import { useRolePreview } from "~/lib/use-role-preview";

export function RolePreviewBanner() {
  const router = useRouter();
  const preview = useRolePreview();
  const { user, isPreview } = usePermissions();

  if (!preview.available || (user && !isPreview)) {
    return null;
  }

  const activeRole = preview.role;

  const handleRoleChange = (value: string) => {
    const nextRole = value === "off" ? null : (value as Role);
    preview.setRole(nextRole);
    if (nextRole) {
      router.replace(getRoleLandingPath(nextRole));
    }
  };

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-amber-950">
      <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge tone={activeRole ? "warning" : "neutral"}>Xem trước dev</Badge>
          <span className="font-semibold">
            {activeRole
              ? `Đang xem với vai trò: ${ROLE_LABELS[activeRole]}`
              : "Role preview đang tắt"}
          </span>
          {activeRole ? (
            <span className="text-amber-800">
              {ROLE_CAPABILITIES[activeRole].summary}
            </span>
          ) : (
            <span className="text-amber-800">
              Chọn vai trò để kiểm tra nav, layout và redirect mà không bật auth.
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="role-preview-select">
            Chọn vai trò preview
          </label>
          <select
            id="role-preview-select"
            value={activeRole ?? "off"}
            onChange={(event) => handleRoleChange(event.target.value)}
            className="h-8 rounded border border-amber-300 bg-white px-2 text-xs font-semibold text-amber-950 shadow-sm focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none"
          >
            <option value="off">Tắt preview</option>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
          {activeRole ? (
            <button
              type="button"
              onClick={() => preview.clear()}
              className="rounded px-2 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none"
            >
              Tắt
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
