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
  const [summaryResult, alertsResult] = await Promise.allSettled([
    api.insight.getDashboardSummary(),
    api.notification.list({ limit: alertLimit }),
  ]);

  const isDegraded =
    summaryResult.status === "rejected" || alertsResult.status === "rejected";

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

  return {
    summary:
      summaryResult.status === "fulfilled" ? summaryResult.value : emptySummary,
    latestAlerts: alertsResult.status === "fulfilled" ? alertsResult.value : [],
    isDegraded,
  };
}
