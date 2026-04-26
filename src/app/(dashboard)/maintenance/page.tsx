import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { MaintenancePageClient } from "~/app/_components/dashboard/maintenance-page-client";

export const dynamic = "force-dynamic";

export default function MaintenancePage() {
  return (
    <DashboardShell
      title="Bảo trì cục bộ"
      description="Chạy lại setup, đồng bộ với git pull, hoặc áp pending migrations ngay từ trình duyệt"
    >
      <MaintenancePageClient />
    </DashboardShell>
  );
}
