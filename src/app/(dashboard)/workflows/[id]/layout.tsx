import { notFound } from "next/navigation";

import { WorkflowDetailLayoutClient } from "~/app/_components/dashboard/workflow-detail-layout-client";
import { api } from "~/trpc/server";

type WorkflowDetailLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
};

export function parseWorkflowId(id: string) {
  const workflowId = Number.parseInt(id, 10);
  if (!Number.isInteger(workflowId) || workflowId <= 0) {
    return null;
  }
  return workflowId;
}

export async function loadWorkflowOrNotFound(workflowId: number) {
  const workflow = await api.workflow.getById({ id: workflowId }).catch(() => null);
  if (!workflow) {
    notFound();
  }
  return workflow;
}

export default async function WorkflowDetailLayout({
  children,
  params,
}: WorkflowDetailLayoutProps) {
  const { id } = await params;
  const workflowId = parseWorkflowId(id);
  if (!workflowId) {
    notFound();
  }
  await loadWorkflowOrNotFound(workflowId);

  return <WorkflowDetailLayoutClient>{children}</WorkflowDetailLayoutClient>;
}
