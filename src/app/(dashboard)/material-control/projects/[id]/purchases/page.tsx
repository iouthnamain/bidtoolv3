import { notFound } from "next/navigation";

import { createPageMetadata } from "~/app/_lib/seo";
import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { materialControlSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";
import { MaterialControlProjectOperationsClient } from "~/app/_components/material-control/material-control-project-operations-client";

type Props = { params: Promise<{ id: string }> };
export const metadata = createPageMetadata({
  title: "Mua hàng vật tư",
  description: "Cam kết mua và các dòng vật tư của dự án.",
  path: "/material-control/projects/purchases",
  keywords: ["mua hàng vật tư"],
});

export default async function MaterialControlProjectPurchasesPage({
  params,
}: Props) {
  const { id } = await params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId) || projectId <= 0) notFound();
  return (
    <DashboardShell
      title="Mua hàng"
      description="Theo dõi cam kết mua riêng với tồn kho thực tế."
      sectionNavItems={materialControlSectionNavItems}
      sectionNavTitle="Theo dõi vật tư"
    >
      <MaterialControlProjectOperationsClient
        projectId={projectId}
        mode="purchases"
      />
    </DashboardShell>
  );
}
