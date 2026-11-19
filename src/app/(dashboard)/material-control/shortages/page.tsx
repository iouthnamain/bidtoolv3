import { createPageMetadata } from "~/app/_lib/seo";
import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { materialControlSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";
import { MaterialControlShortagesClient } from "~/app/_components/material-control/material-control-shortages-client";

export const metadata = createPageMetadata({
  title: "Thiếu & chậm vật tư",
  description: "Danh sách nhu cầu còn thiếu hoặc đã quá hạn.",
  path: "/material-control/shortages",
  keywords: ["thiếu vật tư", "chậm vật tư"],
});

export default function MaterialControlShortagesPage() {
  return (
    <DashboardShell
      title="Thiếu & chậm"
      description="Ưu tiên mua và xử lý các nhu cầu đang thiếu hoặc đã quá hạn."
      sectionNavItems={materialControlSectionNavItems}
      sectionNavTitle="Theo dõi vật tư"
    >
      <MaterialControlShortagesClient />
    </DashboardShell>
  );
}
