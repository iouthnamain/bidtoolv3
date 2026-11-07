import { notFound } from "next/navigation";

import { createPageMetadata } from "~/app/_lib/seo";
import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { materialControlSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";
import { MaterialControlProjectOperationsClient } from "~/app/_components/material-control/material-control-project-operations-client";

type Props = { params: Promise<{ id: string }> };
export const metadata = createPageMetadata({
  title: "Lắp đặt vật tư",
  description: "Các phát sinh lắp đặt và tiêu thụ tại công trường.",
  path: "/material-control/projects/installation",
  keywords: ["lắp đặt vật tư"],
});

export default async function MaterialControlProjectInstallationPage({
  params,
}: Props) {
  const { id } = await params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId) || projectId <= 0) notFound();
  return (
    <DashboardShell
      title="Lắp đặt"
      description="Theo dõi lượng vật tư đã tiêu thụ vào vị trí lắp đặt."
      sectionNavItems={materialControlSectionNavItems}
      sectionNavTitle="Theo dõi vật tư"
    >
      <MaterialControlProjectOperationsClient
        projectId={projectId}
        mode="installation"
      />
    </DashboardShell>
  );
}
