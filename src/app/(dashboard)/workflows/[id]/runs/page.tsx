import { type Metadata } from "next";

import { createPageMetadata } from "~/app/_lib/seo";
import { WorkflowDetailRunsClient } from "~/app/_components/dashboard/workflow-detail-runs-client";
import {
  loadWorkflowOrNotFound,
  parseWorkflowId,
} from "~/app/(dashboard)/workflows/[id]/layout";
import { HydrateClient, api } from "~/trpc/server";

type WorkflowRunsPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({
  params,
}: WorkflowRunsPageProps): Promise<Metadata> {
  const { id } = await params;

  return createPageMetadata({
    title: `Lịch sử workflow #${id}`,
    description: "Xem log chạy, kết quả và thông điệp lỗi của workflow.",
    path: `/workflows/${id}/runs`,
    keywords: ["lịch sử workflow", "log workflow"],
  });
}

export default async function WorkflowRunsPage({
  params,
}: WorkflowRunsPageProps) {
  const { id } = await params;
  const workflowId = parseWorkflowId(id);
  if (!workflowId) {
    return null;
  }

  await loadWorkflowOrNotFound(workflowId);
  void api.workflow.getRuns.prefetch({ workflowId });

  return (
    <HydrateClient>
      <WorkflowDetailRunsClient workflowId={workflowId} />
    </HydrateClient>
  );
}
