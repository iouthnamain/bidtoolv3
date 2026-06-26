"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { signOut } from "~/lib/auth-client";

/**
 * Compact current-user control with a sign-out action for the customer portal
 * top bar. The dashboard `UserControl` is styled for the sidebar footer
 * (vertical, collapsible), so the portal gets its own horizontal variant.
 *
 * Name/email come from the server session (passed as props) to avoid a loading
 * flash; only the sign-out action needs the client.
 */
export function PortalUserControl({
  name,
  email,
}: {
  name?: string | null;
  email: string;
}) {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
    } finally {
      router.replace("/login");
    }
  };

  const displayName = name && name.length > 0 ? name : email;

  return (
    <div className="flex items-center gap-1">
      <div className="hidden min-w-0 text-right sm:block">
        <p className="truncate text-xs font-semibold text-slate-800">
          {displayName}
        </p>
        <p className="truncate text-xs text-slate-700">{email}</p>
      </div>
      <button
        type="button"
        onClick={() => void handleSignOut()}
        disabled={isSigningOut}
        aria-label="Đăng xuất"
        title="Đăng xuất"
        className="inline-flex items-center gap-2 rounded border border-slate-400 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition-colors duration-0 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-50"
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">Đăng xuất</span>
      </button>
    </div>
  );
}
