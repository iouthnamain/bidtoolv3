import { type Metadata } from "next";

import { createPageMetadata } from "~/app/_lib/seo";
import { WorkflowDetailOverviewClient } from "~/app/_components/dashboard/workflow-detail-overview-client";
import {
  loadWorkflowOrNotFound,
  parseWorkflowId,
} from "~/app/(dashboard)/workflows/[id]/workflow-detail-shared";
import { HydrateClient } from "~/trpc/server";

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

export default async function WorkflowDetailPage({
  params,
}: WorkflowDetailPageProps) {
  const { id } = await params;
  const workflowId = parseWorkflowId(id);
  if (!workflowId) {
    return null;
  }

  const initialWorkflow = await loadWorkflowOrNotFound(workflowId);

  return (
    <HydrateClient>
      <WorkflowDetailOverviewClient
        workflowId={workflowId}
        initialWorkflow={initialWorkflow}
      />
    </HydrateClient>
  );
}
