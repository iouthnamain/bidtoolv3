import { notFound } from "next/navigation";

import { createPageMetadata } from "~/app/_lib/seo";
import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { materialControlSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";
import { MaterialControlRequirementsClient } from "~/app/_components/material-control/material-control-requirements-client";

type Props = { params: Promise<{ id: string }> };

export const metadata = createPageMetadata({
  title: "Nhu cầu vật tư",
  description: "Danh sách nhu cầu của một workspace dự án.",
  path: "/material-control/projects/requirements",
  keywords: ["nhu cầu vật tư"],
});

export default async function MaterialControlProjectRequirementsPage({
  params,
}: Props) {
  const { id } = await params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId) || projectId <= 0) notFound();
  return (
    <DashboardShell
      title="Nhu cầu vật tư"
      description="Theo dõi từng dòng vật tư trong workspace dự án."
      sectionNavItems={materialControlSectionNavItems}
      sectionNavTitle="Theo dõi vật tư"
    >
      <MaterialControlRequirementsClient projectId={projectId} />
    </DashboardShell>
  );
}
