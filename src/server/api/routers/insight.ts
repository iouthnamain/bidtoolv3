import { z } from "zod";
import { and, count, eq, gte, lte } from "drizzle-orm";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import {
  notifications,
  tenderPackages,
  workflowRuns,
  workflows,
} from "~/server/db/schema";

const dayLabel = (date: Date) => date.toISOString().slice(0, 10);

export const insightRouter = createTRPCRouter({
  getDashboardSummary: publicProcedure.query(async ({ ctx }) => {
    const [
      totalPackagesResult,
      unreadAlertsResult,
      activeWorkflowsResult,
      successfulRunsResult,
      totalRunsResult,
    ] = await Promise.all([
      ctx.db.select({ value: count() }).from(tenderPackages),
      ctx.db
        .select({ value: count() })
        .from(notifications)
        .where(eq(notifications.isRead, false)),
      ctx.db
        .select({ value: count() })
        .from(workflows)
        .where(eq(workflows.isActive, true)),
      ctx.db
        .select({ value: count() })
        .from(workflowRuns)
        .where(eq(workflowRuns.status, "success")),
      ctx.db.select({ value: count() }).from(workflowRuns),
    ]);

    const totalPackages = totalPackagesResult[0]?.value ?? 0;
    const unreadAlerts = unreadAlertsResult[0]?.value ?? 0;
    const activeWorkflows = activeWorkflowsResult[0]?.value ?? 0;
    const successfulRuns = successfulRunsResult[0]?.value ?? 0;
    const totalRuns = totalRunsResult[0]?.value ?? 0;

    const workflowSuccessRate = totalRuns
      ? Math.round((successfulRuns / totalRuns) * 100)
      : 0;

    return {
      totalPackages,
      unreadAlerts,
      activeWorkflows,
      workflowSuccessRate,
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

      const rows = Array.from({ length: input.days }).map((_, index) => {
        const date = new Date(now);
        date.setDate(now.getDate() - (input.days - 1 - index));
        const label = dayLabel(date);

        return {
          date: label,
          newPackages: byDay.get(label) ?? 0,
        };
      });

      return rows;
    }),
});
