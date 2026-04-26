import { and, count, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import {
  notifications,
  tenderPackages,
  workflowRuns,
  workflows,
} from "~/server/db/schema";

const dayLabel = (date: Date) => date.toISOString().slice(0, 10);

function summarizeWorkflowHealth(input: {
  workflows: Array<typeof workflows.$inferSelect>;
  runs: Array<typeof workflowRuns.$inferSelect>;
}) {
  const latestRunByWorkflowId = new Map<number, (typeof input.runs)[number]>();

  for (const run of input.runs) {
    if (!latestRunByWorkflowId.has(run.workflowId)) {
      latestRunByWorkflowId.set(run.workflowId, run);
    }
  }

  let active = 0;
  let inactive = 0;
  let neverRan = 0;
  let attention = 0;
  let healthy = 0;
  let running = 0;

  for (const workflow of input.workflows) {
    const latestRun = latestRunByWorkflowId.get(workflow.id);

    if (workflow.isActive) {
      active += 1;
    } else {
      inactive += 1;
    }

    if (!latestRun) {
      neverRan += 1;
      continue;
    }

    if (latestRun.status === "failed") {
      attention += 1;
    } else if (latestRun.status === "running") {
      running += 1;
    } else if (latestRun.status === "success") {
      healthy += 1;
    }
  }

  const successfulRuns = input.runs.filter((run) => run.status === "success");
  const successRate = input.runs.length
    ? Math.round((successfulRuns.length / input.runs.length) * 100)
    : 0;

  return {
    total: input.workflows.length,
    active,
    inactive,
    neverRan,
    attention,
    healthy,
    running,
    successRate,
  };
}

export const insightRouter = createTRPCRouter({
  getDashboardSummary: publicProcedure.query(async ({ ctx }) => {
    const [
      totalPackagesResult,
      unreadAlertsResult,
      workflowRows,
      workflowRunRows,
    ] = await Promise.all([
      ctx.db.select({ value: count() }).from(tenderPackages),
      ctx.db
        .select({ value: count() })
        .from(notifications)
        .where(eq(notifications.isRead, false)),
      ctx.db.select().from(workflows),
      ctx.db.select().from(workflowRuns),
    ]);

    const workflowHealth = summarizeWorkflowHealth({
      workflows: workflowRows,
      runs: workflowRunRows,
    });

    return {
      totalPackages: totalPackagesResult[0]?.value ?? 0,
      unreadAlerts: unreadAlertsResult[0]?.value ?? 0,
      activeWorkflows: workflowHealth.active,
      workflowSuccessRate: workflowHealth.successRate,
    };
  }),

  getMarketTrend: publicProcedure
    .input(z.object({ days: z.number().int().min(3).max(30).default(7) }))
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const start = new Date(now);
      start.setDate(now.getDate() - (input.days - 1));
      const startDate = dayLabel(start);

      const packages = await ctx.db
        .select({ publishedAt: tenderPackages.publishedAt })
        .from(tenderPackages)
        .where(
          and(
            gte(tenderPackages.publishedAt, startDate),
            lte(tenderPackages.publishedAt, dayLabel(now)),
          ),
        );

      const byDay = new Map<string, number>();
      for (const row of packages) {
        byDay.set(row.publishedAt, (byDay.get(row.publishedAt) ?? 0) + 1);
      }

      return Array.from({ length: input.days }).map((_, index) => {
        const date = new Date(now);
        date.setDate(now.getDate() - (input.days - 1 - index));
        const label = dayLabel(date);

        return {
          date: label,
          newPackages: byDay.get(label) ?? 0,
        };
      });
    }),

  getWorkflowHealth: publicProcedure.query(async ({ ctx }) => {
    const [workflowRows, workflowRunRows] = await Promise.all([
      ctx.db.select().from(workflows),
      ctx.db.select().from(workflowRuns),
    ]);

    return summarizeWorkflowHealth({
      workflows: workflowRows,
      runs: workflowRunRows,
    });
  }),

  getTopTenderSignals: publicProcedure
    .input(z.object({ limit: z.number().int().min(1).max(10).default(5) }))
    .query(async ({ ctx, input }) => {
      const packages = await ctx.db.select().from(tenderPackages);

      const inviterSummary = new Map<
        string,
        { name: string; packageCount: number; totalBudget: number }
      >();
      const categorySummary = new Map<
        string,
        { name: string; packageCount: number; totalBudget: number }
      >();

      for (const item of packages) {
        const inviter = inviterSummary.get(item.inviter) ?? {
          name: item.inviter,
          packageCount: 0,
          totalBudget: 0,
        };
        inviter.packageCount += 1;
        inviter.totalBudget += item.budget;
        inviterSummary.set(item.inviter, inviter);

        const category = categorySummary.get(item.category) ?? {
          name: item.category,
          packageCount: 0,
          totalBudget: 0,
        };
        category.packageCount += 1;
        category.totalBudget += item.budget;
        categorySummary.set(item.category, category);
      }

      const sortRows = (
        rows: Iterable<{ name: string; packageCount: number; totalBudget: number }>,
      ) =>
        Array.from(rows)
          .sort((a, b) => {
            if (b.packageCount !== a.packageCount) {
              return b.packageCount - a.packageCount;
            }

            return b.totalBudget - a.totalBudget;
          })
          .slice(0, input.limit);

      return {
        inviters: sortRows(inviterSummary.values()),
        categories: sortRows(categorySummary.values()),
      };
    }),
});
