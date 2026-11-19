import { notFound } from "next/navigation";

import { createPageMetadata } from "~/app/_lib/seo";
import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { materialControlSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";
import { MaterialControlProjectOperationsClient } from "~/app/_components/material-control/material-control-project-operations-client";

type Props = { params: Promise<{ id: string }> };
export const metadata = createPageMetadata({
  title: "Vận chuyển vật tư",
  description: "Theo dõi chuyến hàng và nhận từng phần.",
  path: "/material-control/projects/shipments",
  keywords: ["vận chuyển vật tư"],
});

export default async function MaterialControlProjectShipmentsPage({
  params,
}: Props) {
  const { id } = await params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId) || projectId <= 0) notFound();
  return (
    <DashboardShell
      title="Vận chuyển"
      description="Theo dõi trạng thái chuyến hàng và số lượng đã nhận."
      sectionNavItems={materialControlSectionNavItems}
      sectionNavTitle="Theo dõi vật tư"
    >
      <MaterialControlProjectOperationsClient
        projectId={projectId}
        mode="shipments"
      />
    </DashboardShell>
  );
}
