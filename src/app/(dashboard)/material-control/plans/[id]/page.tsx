import { notFound } from "next/navigation";

import { createPageMetadata } from "~/app/_lib/seo";
import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { materialControlSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";
import { MaterialControlPlanClient } from "~/app/_components/material-control/material-control-plan-client";

type Props = { params: Promise<{ id: string }> };

export const metadata = createPageMetadata({
  title: "Kế hoạch vật tư",
  description: "Tổng hợp nhu cầu và tiến độ cung ứng của một kế hoạch vật tư.",
  path: "/material-control/plans",
  keywords: ["kế hoạch vật tư"],
});

export default async function MaterialControlPlanPage({ params }: Props) {
  const { id } = await params;
  const planId = Number(id);
  if (!Number.isInteger(planId) || planId <= 0) notFound();
  return (
    <DashboardShell
      title="Kế hoạch vật tư"
      description="Tổng hợp nhu cầu và tiến độ cung ứng của một kế hoạch."
      sectionNavItems={materialControlSectionNavItems}
      sectionNavTitle="Theo dõi vật tư"
    >
      <MaterialControlPlanClient planId={planId} />
    </DashboardShell>
  );
}
