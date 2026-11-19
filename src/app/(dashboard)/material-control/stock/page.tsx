import { createPageMetadata } from "~/app/_lib/seo";
import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { materialControlSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";
import { MaterialControlStockClient } from "~/app/_components/material-control/material-control-stock-client";

export const metadata = createPageMetadata({
  title: "Tồn kho vật tư",
  description: "Tồn, giữ chỗ và khả dụng theo địa điểm.",
  path: "/material-control/stock",
  keywords: ["tồn kho", "vật tư"],
});

export default function MaterialControlStockPage() {
  return (
    <DashboardShell
      title="Tồn kho vật tư"
      description="Theo dõi tồn thực tế và phần đã giữ chỗ cho các dự án."
      sectionNavItems={materialControlSectionNavItems}
      sectionNavTitle="Theo dõi vật tư"
    >
      <MaterialControlStockClient />
    </DashboardShell>
  );
}
