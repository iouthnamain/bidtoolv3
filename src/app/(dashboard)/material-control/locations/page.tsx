import { createPageMetadata } from "~/app/_lib/seo";
import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { materialControlSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";
import { MaterialControlLocationsClient } from "~/app/_components/material-control/material-control-locations-client";

export const metadata = createPageMetadata({
  title: "Địa điểm vật tư",
  description: "Kho dùng chung, công trường, khu vực và các vị trí ảo.",
  path: "/material-control/locations",
  keywords: ["địa điểm vật tư", "kho vật tư"],
});

export default function MaterialControlLocationsPage() {
  return (
    <DashboardShell
      title="Địa điểm vật tư"
      description="Tổ chức cây địa điểm để tồn kho và phát sinh luôn có vị trí rõ ràng."
      sectionNavItems={materialControlSectionNavItems}
      sectionNavTitle="Theo dõi vật tư"
    >
      <MaterialControlLocationsClient />
    </DashboardShell>
  );
}
