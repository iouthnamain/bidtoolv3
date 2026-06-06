import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { MaintenancePageClient } from "~/app/_components/dashboard/maintenance-page-client";
import { maintenanceSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";

export const dynamic = "force-dynamic";

export default function MaintenancePage() {
  return (
    <DashboardShell
      title="Bảo trì cục bộ"
      description="Chạy lại setup, đồng bộ với git pull, hoặc áp pending migrations ngay từ trình duyệt"
      sectionNavItems={maintenanceSectionNavItems}
      sectionNavTitle="Khu vực bảo trì"
    >
      <MaintenancePageClient />
    </DashboardShell>
  );
}
