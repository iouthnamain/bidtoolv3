import { notFound } from "next/navigation";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { WorkflowDetailPageClient } from "~/app/_components/dashboard/workflow-detail-page-client";
import { api } from "~/trpc/server";

type WorkflowDetailPageProps = {
  params: Promise<{ id: string }>;
};

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

  return (
    <DashboardShell
      title="Chi tiết workflow"
      description="Quản lý cấu hình, trạng thái kích hoạt và lịch sử chạy của workflow."
    >
      <WorkflowDetailPageClient
        workflowId={workflowId}
        initialWorkflow={initialWorkflow}
      />
    </DashboardShell>
  );
}
