import { createPageMetadata } from "~/app/_lib/seo";
import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { materialControlSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";
import { MaterialControlProjectsClient } from "~/app/_components/material-control/material-control-projects-client";

export const metadata = createPageMetadata({
  title: "Dự án vật tư",
  description: "Các workspace dự án và kế hoạch vật tư.",
  path: "/material-control/projects",
  keywords: ["dự án vật tư", "workspace vật tư"],
});

export default function MaterialControlProjectsPage() {
  return (
    <DashboardShell
      title="Dự án vật tư"
      description="Tách nhu cầu, ngày tháng và tài liệu theo từng dự án."
      sectionNavItems={materialControlSectionNavItems}
      sectionNavTitle="Theo dõi vật tư"
    >
      <MaterialControlProjectsClient />
    </DashboardShell>
  );
}
