import { TRPCError } from "@trpc/server";
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import {
  normalizeWorkflowFilterConfig,
  summarizeWorkflowFilterConfig,
} from "~/lib/workflow-config";
import { type db as appDb } from "~/server/db";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import {
  notifications,
  savedFilters,
  workflowRuns,
  workflows,
} from "~/server/db/schema";

type AppDb = typeof appDb;
type WorkflowRow = typeof workflows.$inferSelect;
type WorkflowRunRow = typeof workflowRuns.$inferSelect;

const workflowTriggerConfigInputSchema = z
  .object({
    savedFilterId: z.number().int().positive().nullable().optional(),
    savedFilterName: z.string().min(1).nullable().optional(),
    keyword: z.string().optional(),
    provinces: z.array(z.string()).optional(),
    categories: z.array(z.string()).optional(),
    budgetMin: z.number().nonnegative().nullable().optional(),
    budgetMax: z.number().nonnegative().nullable().optional(),
    minMatchScore: z.number().min(0).max(100).optional(),
    notificationFrequency: z.enum(["daily", "weekly"]).nullable().optional(),
  })
  .partial();

function parseTriggerConfig(input: unknown) {
  return normalizeWorkflowFilterConfig(
    workflowTriggerConfigInputSchema.parse(input ?? {}),
  );
}

function assertBudgetRange(config: ReturnType<typeof parseTriggerConfig>) {
  if (
    config.budgetMin !== null &&
    config.budgetMax !== null &&
    config.budgetMin > config.budgetMax
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Khoảng ngân sách workflow không hợp lệ.",
    });
  }
}

async function getWorkflowOrThrow(db: Pick<AppDb, "select">, id: number) {
  const [workflow] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.id, id))
    .limit(1);

  if (!workflow) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Workflow không tồn tại.",
    });
  }

  return workflow;
}

async function attachWorkflowSummaries(
  db: Pick<AppDb, "select">,
  workflowRows: WorkflowRow[],
) {
  if (workflowRows.length === 0) {
    return [];
  }

  const workflowIds = workflowRows.map((row) => row.id);
  const runs = await db
    .select()
    .from(workflowRuns)
    .where(inArray(workflowRuns.workflowId, workflowIds))
    .orderBy(desc(workflowRuns.startedAt));

  const latestRunByWorkflowId = new Map<number, WorkflowRunRow>();
  const runCountByWorkflowId = new Map<number, number>();

  for (const run of runs) {
    runCountByWorkflowId.set(
      run.workflowId,
      (runCountByWorkflowId.get(run.workflowId) ?? 0) + 1,
    );

    if (!latestRunByWorkflowId.has(run.workflowId)) {
      latestRunByWorkflowId.set(run.workflowId, run);
    }
  }

  return workflowRows.map((row) => {
    const triggerConfig = parseTriggerConfig(row.triggerConfig);

    return {
      ...row,
      triggerConfig,
      triggerSummary: summarizeWorkflowFilterConfig(triggerConfig),
      latestRun: latestRunByWorkflowId.get(row.id) ?? null,
      runCount: runCountByWorkflowId.get(row.id) ?? 0,
    };
  });
}

export const workflowRouter = createTRPCRouter({
  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        triggerType: z.enum(["new_package", "schedule"]),
        triggerConfig: workflowTriggerConfigInputSchema.default({}),
        actionType: z.enum(["in_app", "email"]),
        actionConfig: z.record(z.unknown()).default({}),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const triggerConfig = parseTriggerConfig(input.triggerConfig);
      assertBudgetRange(triggerConfig);

      const now = new Date().toISOString();
      const [newWorkflow] = await ctx.db
        .insert(workflows)
        .values({
          name: input.name,
          triggerType: input.triggerType,
          triggerConfig,
          actionType: input.actionType,
          actionConfig: input.actionConfig,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!newWorkflow) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Không tạo được workflow.",
        });
      }

      const [workflow] = await attachWorkflowSummaries(ctx.db, [newWorkflow]);
      return workflow;
    }),

  createFromSavedFilter: publicProcedure
    .input(
      z.object({
        savedFilterId: z.number().int().positive(),
        name: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [savedFilter] = await ctx.db
        .select()
        .from(savedFilters)
        .where(eq(savedFilters.id, input.savedFilterId))
        .limit(1);

      if (!savedFilter) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Smart View không tồn tại.",
        });
      }

      const triggerConfig = parseTriggerConfig({
        savedFilterId: savedFilter.id,
        savedFilterName: savedFilter.name,
        keyword: savedFilter.keyword,
        provinces: savedFilter.provinces,
        categories: savedFilter.categories,
        budgetMin: savedFilter.budgetMin,
        budgetMax: savedFilter.budgetMax,
        minMatchScore: savedFilter.minMatchScore,
        notificationFrequency: savedFilter.notificationFrequency,
      });
      const now = new Date().toISOString();
      const requestedName = input.name?.trim();
      const normalizedRequestedName =
        requestedName && requestedName.length > 0 ? requestedName : null;
      const savedFilterName = savedFilter.name.trim() || "Smart View";

      const [created] = await ctx.db
        .insert(workflows)
        .values({
          name: normalizedRequestedName ?? `Workflow • ${savedFilterName}`,
          triggerType: "new_package",
          triggerConfig,
          actionType: "in_app",
          actionConfig: {
            source: "saved_filter",
            savedFilterId: savedFilter.id,
          },
          isActive: true,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Không tạo được workflow từ Smart View.",
        });
      }

      const [workflow] = await attachWorkflowSummaries(ctx.db, [created]);
      return workflow;
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().min(1).optional(),
        triggerType: z.enum(["new_package", "schedule"]).optional(),
        triggerConfig: workflowTriggerConfigInputSchema.optional(),
        actionConfig: z.record(z.unknown()).optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (
        input.name === undefined &&
        input.triggerType === undefined &&
        input.triggerConfig === undefined &&
        input.actionConfig === undefined &&
        input.isActive === undefined
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cần cập nhật ít nhất một trường cho workflow.",
        });
      }

      await getWorkflowOrThrow(ctx.db, input.id);

      const updateData: {
        name?: string;
        triggerType?: "new_package" | "schedule";
        triggerConfig?: Record<string, unknown>;
        actionConfig?: Record<string, unknown>;
        isActive?: boolean;
        updatedAt: string;
      } = {
        updatedAt: new Date().toISOString(),
      };

      if (input.name !== undefined) {
        updateData.name = input.name;
      }

      if (input.triggerType !== undefined) {
        updateData.triggerType = input.triggerType;
      }

      if (input.triggerConfig !== undefined) {
        const triggerConfig = parseTriggerConfig(input.triggerConfig);
        assertBudgetRange(triggerConfig);
        updateData.triggerConfig = triggerConfig;
      }

      if (input.actionConfig !== undefined) {
        updateData.actionConfig = input.actionConfig;
      }

      if (input.isActive !== undefined) {
        updateData.isActive = input.isActive;
      }

      const [workflow] = await ctx.db
        .update(workflows)
        .set(updateData)
        .where(eq(workflows.id, input.id))
        .returning();

      if (!workflow) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workflow không tồn tại.",
        });
      }

      const [workflowWithSummary] = await attachWorkflowSummaries(ctx.db, [
        workflow,
      ]);
      return workflowWithSummary;
    }),

  setActive: publicProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        isActive: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [workflow] = await ctx.db
        .update(workflows)
        .set({
          isActive: input.isActive,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(workflows.id, input.id))
        .returning();

      if (!workflow) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workflow không tồn tại.",
        });
      }

      const [workflowWithSummary] = await attachWorkflowSummaries(ctx.db, [
        workflow,
      ]);
      return workflowWithSummary;
    }),

  list: publicProcedure.query(async ({ ctx }) => {
    const workflowRows = await ctx.db
      .select()
      .from(workflows)
      .orderBy(desc(workflows.updatedAt));

    return attachWorkflowSummaries(ctx.db, workflowRows);
  }),

  getById: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const workflow = await getWorkflowOrThrow(ctx.db, input.id);
      const [workflowWithSummary] = await attachWorkflowSummaries(ctx.db, [
        workflow,
      ]);
      return workflowWithSummary;
    }),

  getRuns: publicProcedure
    .input(z.object({ workflowId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await getWorkflowOrThrow(ctx.db, input.workflowId);

      return ctx.db
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.workflowId, input.workflowId))
        .orderBy(desc(workflowRuns.startedAt));
    }),

  runNow: publicProcedure
    .input(z.object({ workflowId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const workflow = await getWorkflowOrThrow(ctx.db, input.workflowId);

      if (!workflow.isActive) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Workflow đang tắt, vui lòng bật trước khi chạy.",
        });
      }

      const startedAt = new Date().toISOString();
      const finishedAt = new Date().toISOString();
      const triggerConfig = parseTriggerConfig(workflow.triggerConfig);
      const filterSummary = summarizeWorkflowFilterConfig(triggerConfig);
      const status = "success";
      const message = filterSummary[0]
        ? `Workflow chạy thành công với điều kiện: ${filterSummary[0]}.`
        : "Workflow chạy thành công và đã tạo thông báo.";

      const run = await ctx.db.transaction(async (tx) => {
        const [createdRun] = await tx
          .insert(workflowRuns)
          .values({
            workflowId: workflow.id,
            status,
            startedAt,
            finishedAt,
            message,
          })
          .returning();

        await tx
          .update(workflows)
          .set({ updatedAt: finishedAt })
          .where(eq(workflows.id, workflow.id));

        await tx.insert(notifications).values({
          channel: workflow.actionType,
          title: `Workflow ${workflow.name} vừa chạy`,
          body: message,
          severity: "medium",
          isRead: false,
          createdAt: finishedAt,
        });

        if (!createdRun) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Không tạo được lịch sử chạy workflow.",
          });
        }

        return createdRun;
      });

      return run;
    }),
});
