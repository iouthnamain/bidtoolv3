import { api } from "~/trpc/server";

const emptySummary = {
  totalPackages: 0,
  unreadAlerts: 0,
  activeWorkflows: 0,
  workflowSuccessRate: 0,
};

const describeError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export async function getDashboardSnapshot(alertLimit = 3) {
  const [summaryResult, alertsResult, workflowsResult] = await Promise.allSettled([
    api.insight.getDashboardSummary(),
    api.notification.list({ limit: alertLimit }),
    api.workflow.list(),
  ]);

  const isDegraded =
    summaryResult.status === "rejected" ||
    alertsResult.status === "rejected" ||
    workflowsResult.status === "rejected";

  if (summaryResult.status === "rejected") {
    console.warn(
      `Failed to load dashboard summary: ${describeError(summaryResult.reason)}`,
    );
  }

  if (alertsResult.status === "rejected") {
    console.warn(
      `Failed to load latest alerts: ${describeError(alertsResult.reason)}`,
    );
  }

  if (workflowsResult.status === "rejected") {
    console.warn(
      `Failed to load workflows: ${describeError(workflowsResult.reason)}`,
    );
  }

  const recentWorkflowRuns =
    workflowsResult.status === "fulfilled"
      ? workflowsResult.value
          .filter((workflow) => workflow.latestRun)
          .sort((a, b) => {
            const aTime = new Date(a.latestRun?.startedAt ?? 0).getTime();
            const bTime = new Date(b.latestRun?.startedAt ?? 0).getTime();
            return bTime - aTime;
          })
          .slice(0, 4)
      : [];

  return {
    summary:
      summaryResult.status === "fulfilled" ? summaryResult.value : emptySummary,
    latestAlerts: alertsResult.status === "fulfilled" ? alertsResult.value : [],
    recentWorkflowRuns,
    isDegraded,
  };
}
