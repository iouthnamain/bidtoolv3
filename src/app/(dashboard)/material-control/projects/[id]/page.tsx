import { notFound } from "next/navigation";

import { createPageMetadata } from "~/app/_lib/seo";
import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { materialControlSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";
import { MaterialControlProjectClient } from "~/app/_components/material-control/material-control-project-client";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  return createPageMetadata({
    title: `Workspace vật tư #${id}`,
    description: "Chi tiết workspace và kế hoạch vật tư.",
    path: `/material-control/projects/${id}`,
    keywords: ["workspace vật tư"],
  });
}

export default async function MaterialControlProjectPage({ params }: Props) {
  const { id } = await params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId) || projectId <= 0) notFound();
  return (
    <DashboardShell
      title="Workspace dự án"
      description="Nhu cầu, kế hoạch và tài liệu của một dự án vật tư."
      sectionNavItems={materialControlSectionNavItems}
      sectionNavTitle="Theo dõi vật tư"
    >
      <MaterialControlProjectClient projectId={projectId} />
    </DashboardShell>
  );
}
