import { type Metadata } from "next";
import { notFound } from "next/navigation";

import { createPageMetadata } from "~/app/_lib/seo";
import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { workflowDetailSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";
import { WorkflowDetailPageClient } from "~/app/_components/dashboard/workflow-detail-page-client";
import { HydrateClient, api } from "~/trpc/server";

type WorkflowDetailPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({
  params,
}: WorkflowDetailPageProps): Promise<Metadata> {
  const { id } = await params;

  return createPageMetadata({
    title: `Chi tiết workflow #${id}`,
    description:
      "Xem cấu hình, trạng thái kích hoạt và lịch sử chạy của workflow cảnh báo đấu thầu.",
    path: `/workflows/${id}`,
    keywords: ["chi tiết workflow", "lịch sử workflow", "cảnh báo đấu thầu"],
  });
}

function prefetchWorkflowDetailPageData(workflowId: number) {
  void api.workflow.getRuns.prefetch({ workflowId });
}

export default async function WorkflowDetailPage({
  params,
}: WorkflowDetailPageProps) {
  const { id } = await params;
  const workflowId = Number.parseInt(id, 10);

  if (!Number.isInteger(workflowId) || workflowId <= 0) {
    notFound();
  }

  const initialWorkflow = await api.workflow
    .getById({ id: workflowId })
    .catch(() => null);

  if (!initialWorkflow) {
    notFound();
  }

  prefetchWorkflowDetailPageData(workflowId);

  return (
    <DashboardShell
      title="Chi tiết workflow"
      description="Quản lý cấu hình, trạng thái kích hoạt và lịch sử chạy của workflow."
      sectionNavItems={workflowDetailSectionNavItems}
      sectionNavTitle="Chi tiết workflow"
    >
      <HydrateClient>
        <WorkflowDetailPageClient
          workflowId={workflowId}
          initialWorkflow={initialWorkflow}
        />
      </HydrateClient>
    </DashboardShell>
  );
}
