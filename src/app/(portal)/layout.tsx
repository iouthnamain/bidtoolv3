import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { PortalUserControl } from "~/app/_components/portal/portal-user-control";
import { env } from "~/env";
import { isInternalRole, type Role } from "~/lib/permissions";
import { auth } from "~/server/auth";

export const dynamic = "force-dynamic";

/**
 * Customer portal route-group layout (server component, guarded).
 *
 * Auth-off behavior: the portal is an auth-only concept (it exists to give
 * tenant-isolated external customers a read-only home). With AUTH_ENABLED off
 * there is no session, no tenant, and no `customer` role to scope data to, so
 * the portal is meaningless. We `redirect("/")` rather than render an empty
 * shell — this keeps the auth-off dev experience pointing at the dashboard,
 * which is the only meaningful surface when auth is disabled.
 *
 * Auth-on guard (defense in depth; middleware only does an optimistic cookie
 * check):
 *   - no session            -> /login
 *   - internal role         -> /        (admin/manager/staff belong in the
 *                                         dashboard, never the portal)
 *   - customer              -> render the portal shell
 *
 * Together with the dashboard layout (which redirects customer -> /portal) this
 * forms a two-sided cage: internal users can only reach the dashboard, external
 * customers can only reach the portal.
 */
export default async function PortalGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (env.AUTH_ENABLED !== "true") {
    redirect("/");
  }

  const session = await auth.api.getSession({ headers: await headers() });
  const user = session?.user;

  if (!user) {
    redirect("/login");
  }

  if (isInternalRole(user.role as Role)) {
    redirect("/");
  }

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
          <div className="min-w-0">
            <p className="text-sm font-bold tracking-tight text-slate-950">
              BidTool
            </p>
            <p className="truncate text-[11px] font-medium text-slate-500">
              Cổng khách hàng
            </p>
          </div>
          <PortalUserControl name={user.name} email={user.email} />
        </div>
      </header>

      <main
        id="main-content"
        className="mx-auto w-full max-w-5xl flex-1 px-4 pt-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
      >
        {children}
      </main>
    </div>
  );
}
