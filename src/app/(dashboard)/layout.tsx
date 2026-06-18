import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { DashboardLayout } from "~/app/_components/dashboard/dashboard-layout";
import { env } from "~/env";
import { isInternalRole, type Role } from "~/lib/permissions";
import { auth } from "~/server/auth";

export const dynamic = "force-dynamic";

export default async function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Invariant: when auth is disabled this layout is a complete no-op and renders
  // exactly as before.
  if (env.AUTH_ENABLED !== "true") {
    return <DashboardLayout>{children}</DashboardLayout>;
  }

  // Real, authoritative session validation (defense in depth — middleware only
  // does an optimistic cookie check).
  const session = await auth.api.getSession({ headers: await headers() });
  const user = session?.user;

  if (!user) {
    redirect("/login");
  }

  // Customers must never render the internal dashboard; send them to the portal.
  if (!isInternalRole(user.role as Role)) {
    redirect("/portal");
  }

  return <DashboardLayout>{children}</DashboardLayout>;
}
