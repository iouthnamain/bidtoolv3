import { type Metadata } from "next";

import { createPageMetadata } from "~/app/_lib/seo";
import { WorkflowDetailEditClient } from "~/app/_components/dashboard/workflow-detail-edit-client";
import {
  loadWorkflowOrNotFound,
  parseWorkflowId,
} from "~/app/(dashboard)/workflows/[id]/layout";
import { HydrateClient } from "~/trpc/server";

type WorkflowEditPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({
  params,
}: WorkflowEditPageProps): Promise<Metadata> {
  const { id } = await params;

  return createPageMetadata({
    title: `Cấu hình workflow #${id}`,
    description: "Sửa trigger, criteria và trạng thái hoạt động của workflow.",
    path: `/workflows/${id}/edit`,
    keywords: ["cấu hình workflow", "trigger workflow"],
  });
}

export default async function WorkflowEditPage({
  params,
}: WorkflowEditPageProps) {
  const { id } = await params;
  const workflowId = parseWorkflowId(id);
  if (!workflowId) {
    return null;
  }

  const initialWorkflow = await loadWorkflowOrNotFound(workflowId);

  return (
    <HydrateClient>
      <WorkflowDetailEditClient
        workflowId={workflowId}
        initialWorkflow={initialWorkflow}
      />
    </HydrateClient>
  );
}
