import { notFound } from "next/navigation";

import { WorkflowDetailLayoutClient } from "~/app/_components/dashboard/workflow-detail-layout-client";

import {
  loadWorkflowOrNotFound,
  parseWorkflowId,
} from "./workflow-detail-shared";

type WorkflowDetailLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
};

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
