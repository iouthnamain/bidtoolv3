import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { MaintenancePageClient } from "~/app/_components/dashboard/maintenance-page-client";
import { HydrateClient, api } from "~/trpc/server";

export const dynamic = "force-dynamic";

function prefetchMaintenancePageData() {
  void api.maintenance.status.prefetch(undefined);
}

export default function MaintenancePage() {
  prefetchMaintenancePageData();

  return (
    <DashboardShell
      title="Bảo trì cục bộ"
      description="Chạy lại setup, đồng bộ với git pull, hoặc áp pending migrations ngay từ trình duyệt"
    >
      <HydrateClient>
        <MaintenancePageClient />
      </HydrateClient>
    </DashboardShell>
  );
}
