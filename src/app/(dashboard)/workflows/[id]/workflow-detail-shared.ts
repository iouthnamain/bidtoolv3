import { notFound } from "next/navigation";

import { api } from "~/trpc/server";

/**
 * Parse a workflow id from a route param. Returns null when the value is not a
 * positive integer.
 *
 * Lives in a shared module (not the layout) because Next.js layout files may
 * only export a default component and a fixed set of special fields — sibling
 * pages import these helpers from here.
 */
export function parseWorkflowId(id: string) {
  const workflowId = Number.parseInt(id, 10);
  if (!Number.isInteger(workflowId) || workflowId <= 0) {
    return null;
  }
  return workflowId;
}

export async function loadWorkflowOrNotFound(workflowId: number) {
  const workflow = await api.workflow
    .getById({ id: workflowId })
    .catch(() => null);
  if (!workflow) {
    notFound();
  }
  return workflow;
}
