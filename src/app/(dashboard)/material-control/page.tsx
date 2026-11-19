import { createPageMetadata } from "~/app/_lib/seo";
import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { materialControlSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";
import { MaterialControlDashboardClient } from "~/app/_components/material-control/material-control-dashboard-client";

export const metadata = createPageMetadata({
  title: "Theo dõi vật tư",
  description:
    "Theo dõi nhu cầu, mua hàng, tồn kho, vận chuyển và lắp đặt theo từng dự án.",
  path: "/material-control",
  keywords: ["tồn kho vật tư", "theo dõi vật tư", "quản lý dự án"],
});

export default function MaterialControlPage() {
  return (
    <DashboardShell
      title="Theo dõi vật tư"
      description="Một workspace cho từng dự án, một sổ phát sinh để giải thích mọi thay đổi tồn kho."
      sectionNavItems={materialControlSectionNavItems}
      sectionNavTitle="Luồng vật tư"
    >
      <MaterialControlDashboardClient />
    </DashboardShell>
  );
}
