import { createPageMetadata } from "~/app/_lib/seo";
import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { materialControlSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";
import { MaterialControlProjectCreateClient } from "~/app/_components/material-control/material-control-project-create-client";

export const metadata = createPageMetadata({
  title: "Tạo workspace vật tư",
  description:
    "Tạo workspace riêng cho một dự án và bắt đầu lập kế hoạch vật tư.",
  path: "/material-control/projects/new",
  keywords: ["tạo dự án vật tư"],
});

export default function NewMaterialControlProjectPage() {
  return (
    <DashboardShell
      title="Tạo workspace vật tư"
      description="Bắt đầu bằng tên dự án; mã nguồn và liên kết tender có thể bổ sung sau."
      sectionNavItems={materialControlSectionNavItems}
      sectionNavTitle="Theo dõi vật tư"
    >
      <MaterialControlProjectCreateClient />
    </DashboardShell>
  );
}
