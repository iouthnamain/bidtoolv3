"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { signOut } from "~/lib/auth-client";
import { usePermissions } from "~/lib/use-permissions";
import { type Role } from "~/lib/permissions";

const ROLE_LABELS: Record<Role, string> = {
  admin: "Quản trị",
  manager: "Quản lý",
  staff: "Nhân viên",
  customer: "Khách hàng",
};

/**
 * Compact current-user control with a sign-out action, shown in the dashboard
 * sidebar footer / mobile header. Renders nothing when there is no session
 * (e.g. AUTH_ENABLED is off), so it never breaks unauthenticated rendering.
 */
export function UserControl({ collapsed = false }: { collapsed?: boolean }) {
  const router = useRouter();
  const { user, role, isPending } = usePermissions();
  const [isSigningOut, setIsSigningOut] = useState(false);

  if (isPending || !user) {
    return null;
  }

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
    } finally {
      router.replace("/login");
    }
  };

  const roleLabel = role ? ROLE_LABELS[role] : null;
  const displayName = user.name || user.email;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => void handleSignOut()}
        disabled={isSigningOut}
        aria-label="Đăng xuất"
        title={`${displayName} · Đăng xuất`}
        className="mx-auto flex h-9 w-9 items-center justify-center rounded border border-slate-400 bg-white text-slate-600 transition-colors duration-0 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-50"
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded border border-slate-400 bg-white px-2.5 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-slate-800">
          {displayName}
        </p>
        <p className="truncate text-xs text-slate-700">
          {roleLabel ? `${roleLabel} · ` : ""}
          {user.email}
        </p>
      </div>
      <button
        type="button"
        onClick={() => void handleSignOut()}
        disabled={isSigningOut}
        aria-label="Đăng xuất"
        title="Đăng xuất"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-slate-700 transition-colors duration-0 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 focus-visible:outline-none disabled:opacity-50"
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
