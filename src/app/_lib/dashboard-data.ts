import { count, eq, sql } from "drizzle-orm";

import { db } from "~/server/db";
import {
  notifications,
  tenderPackages,
  workflowRuns,
  workflows,
} from "~/server/db/schema";
import { api } from "~/trpc/server";

const emptySummary = {
  totalPackages: 0,
  unreadAlerts: 0,
  activeWorkflows: 0,
  workflowSuccessRate: 0,
};

const describeError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

async function getUnreadAlertCount() {
  try {
    const result = await db
      .select({ value: sql<number>`count(*)::int`.as("value") })
      .from(notifications)
      .where(eq(notifications.isRead, false));

    return result[0]?.value ?? 0;
  } catch {
    return 0;
  }
}

async function getDashboardSummary() {
  const [totalPackagesResult, unreadAlerts, workflowRows, workflowRunRows] =
    await Promise.all([
      db.select({ value: count() }).from(tenderPackages),
      getUnreadAlertCount(),
      db.select({ isActive: workflows.isActive }).from(workflows),
      db.select({ status: workflowRuns.status }).from(workflowRuns),
    ]);

  const successfulRuns = workflowRunRows.filter(
    (run) => run.status === "success",
  );

  return {
    totalPackages: totalPackagesResult[0]?.value ?? 0,
    unreadAlerts,
    activeWorkflows: workflowRows.filter((workflow) => workflow.isActive)
      .length,
    workflowSuccessRate: workflowRunRows.length
      ? Math.round((successfulRuns.length / workflowRunRows.length) * 100)
      : 0,
  };
}

export async function getDashboardSnapshot(alertLimit = 3) {
  const [summaryResult, alertsResult, workflowsResult] =
    await Promise.allSettled([
      getDashboardSummary(),
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
