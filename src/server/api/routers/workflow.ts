import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import {
  buildCriteriaFromLegacyPackageFields,
  DATE_ONLY_REGEX,
  normalizeSearchCriteria,
} from "~/lib/search-criteria";
import {
  normalizeWorkflowFilterConfig,
  summarizeWorkflowFilterConfig,
} from "~/lib/workflow-config";
import { type db as appDb } from "~/server/db";
import {
  createTRPCRouter,
  publicProcedure,
  requirePermission,
} from "~/server/api/trpc";
import {
  stampTenant,
  withTenant,
  type TenantScopeContext,
} from "~/server/api/tenant-scope";
import {
  notifications,
  savedFilters,
  workflowRuns,
  workflows,
} from "~/server/db/schema";
import {
  isSavedFilterSchemaDriftError,
  throwSavedFilterSchemaDriftError,
} from "~/server/lib/saved-filter-schema-errors";

type AppDb = typeof appDb;
type WorkflowRow = typeof workflows.$inferSelect;
type WorkflowRunRow = typeof workflowRuns.$inferSelect;

function optionalDateFilterSchema(message: string) {
  return z
    .string()
    .refine((value) => value === "" || DATE_ONLY_REGEX.test(value), message)
    .optional();
}

const workflowCriteriaInputSchema = z
  .object({
    keyword: z.string().optional(),
    provinces: z.array(z.string()).optional(),
    packageCategories: z.array(z.string()).optional(),
    classifyIds: z.array(z.number().int().positive()).optional(),
    planFields: z.array(z.string()).optional(),
    procurementMethods: z.array(z.string()).optional(),
    projectGroups: z.array(z.string()).optional(),
    budgetMin: z.number().nonnegative().nullable().optional(),
    budgetMax: z.number().nonnegative().nullable().optional(),
    publishedFrom: optionalDateFilterSchema(
      "Ngày từ phải theo định dạng YYYY-MM-DD.",
    ),
    publishedTo: optionalDateFilterSchema(
      "Ngày đến phải theo định dạng YYYY-MM-DD.",
    ),
    minMatchScore: z.number().min(0).max(100).optional(),
  })
  .partial();

const workflowTriggerConfigInputSchema = z
  .object({
    searchMode: z
      .enum([
        "package_keyword",
        "package_location",
        "package_area_location",
        "plan",
        "project",
      ])
      .optional(),
    criteria: workflowCriteriaInputSchema.optional(),
    savedFilterId: z.number().int().positive().nullable().optional(),
    savedFilterName: z.string().min(1).nullable().optional(),
    notificationFrequency: z.enum(["daily", "weekly"]).nullable().optional(),

    // Legacy package-only fields remain accepted for backward compatibility.
    keyword: z.string().optional(),
    provinces: z.array(z.string()).optional(),
    categories: z.array(z.string()).optional(),
    budgetMin: z.number().nonnegative().nullable().optional(),
    budgetMax: z.number().nonnegative().nullable().optional(),
    minMatchScore: z.number().min(0).max(100).optional(),
  })
  .partial();

function parseTriggerConfig(input: unknown) {
  return normalizeWorkflowFilterConfig(
    workflowTriggerConfigInputSchema.parse(input ?? {}),
  );
}

function assertBudgetRange(config: ReturnType<typeof parseTriggerConfig>) {
  if (
    config.criteria.budgetMin !== null &&
    config.criteria.budgetMax !== null &&
    config.criteria.budgetMin > config.criteria.budgetMax
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Khoảng ngân sách workflow không hợp lệ.",
    });
  }
}

function normalizeSavedFilterForWorkflow(
  row: typeof savedFilters.$inferSelect,
) {
  const legacyCriteria = buildCriteriaFromLegacyPackageFields({
    keyword: row.keyword,
    provinces: row.provinces,
    categories: row.categories,
    budgetMin: row.budgetMin,
    budgetMax: row.budgetMax,
    minMatchScore: row.minMatchScore,
  });

  const criteria = normalizeSearchCriteria({
    ...legacyCriteria,
    ...(row.criteriaJson && typeof row.criteriaJson === "object"
      ? row.criteriaJson
      : {}),
  });

  return {
    id: row.id,
    name: row.name.trim(),
    mode: row.mode ?? "package_keyword",
    criteria,
    notificationFrequency: row.notificationFrequency,
  };
}

async function getWorkflowOrThrow(
  ctx: { db: Pick<AppDb, "select"> } & TenantScopeContext,
  id: number,
) {
  // Tenant-scope the lookup: a customer requesting another tenant's workflow
  // gets NOT_FOUND, never the row (and never its runs via getRuns).
  const [workflow] = await ctx.db
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, id), withTenant(ctx, workflows.tenantId)))
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
  create: requirePermission("workflow:write")
    .input(
      z.object({
        name: z.string().min(1),
        triggerType: z.enum(["new_package", "new_search_result", "schedule"]),
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
        .values(
          stampTenant(ctx, {
            name: input.name,
            triggerType: input.triggerType,
            triggerConfig,
            actionType: input.actionType,
            actionConfig: input.actionConfig,
            isActive: true,
            createdAt: now,
            updatedAt: now,
          }),
        )
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

  createFromSavedFilter: requirePermission("workflow:write")
    .input(
      z.object({
        savedFilterId: z.number().int().positive(),
        name: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let savedFilter: typeof savedFilters.$inferSelect | undefined;

      try {
        [savedFilter] = await ctx.db
          .select()
          .from(savedFilters)
          .where(
            and(
              eq(savedFilters.id, input.savedFilterId),
              withTenant(ctx, savedFilters.tenantId),
            ),
          )
          .limit(1);
      } catch (error) {
        if (isSavedFilterSchemaDriftError(error)) {
          throwSavedFilterSchemaDriftError(error);
        }

        throw error;
      }

      if (!savedFilter) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Smart View không tồn tại.",
        });
      }

      const normalizedSavedFilter =
        normalizeSavedFilterForWorkflow(savedFilter);
      const triggerConfig = parseTriggerConfig({
        searchMode: normalizedSavedFilter.mode,
        criteria: normalizedSavedFilter.criteria,
        savedFilterId: normalizedSavedFilter.id,
        savedFilterName: normalizedSavedFilter.name,
        notificationFrequency: normalizedSavedFilter.notificationFrequency,
      });
      const now = new Date().toISOString();
      const requestedName = input.name?.trim();
      const normalizedRequestedName =
        requestedName && requestedName.length > 0 ? requestedName : null;
      const savedFilterName = normalizedSavedFilter.name || "Smart View";

      const [created] = await ctx.db
        .insert(workflows)
        .values(
          stampTenant(ctx, {
            name: normalizedRequestedName ?? `Workflow • ${savedFilterName}`,
            triggerType: "new_search_result",
            triggerConfig,
            actionType: "in_app",
            actionConfig: {
              source: "saved_filter",
              savedFilterId: normalizedSavedFilter.id,
            },
            isActive: true,
            createdAt: now,
            updatedAt: now,
          }),
        )
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

  update: requirePermission("workflow:write")
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().min(1).optional(),
        triggerType: z
          .enum(["new_package", "new_search_result", "schedule"])
          .optional(),
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

      await getWorkflowOrThrow(ctx, input.id);

      const updateData: {
        name?: string;
        triggerType?: "new_package" | "new_search_result" | "schedule";
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
        .where(
          and(eq(workflows.id, input.id), withTenant(ctx, workflows.tenantId)),
        )
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

  setActive: requirePermission("workflow:write")
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
        .where(
          and(eq(workflows.id, input.id), withTenant(ctx, workflows.tenantId)),
        )
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
      .where(withTenant(ctx, workflows.tenantId))
      .orderBy(desc(workflows.updatedAt));

    return attachWorkflowSummaries(ctx.db, workflowRows);
  }),

  getById: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const workflow = await getWorkflowOrThrow(ctx, input.id);
      const [workflowWithSummary] = await attachWorkflowSummaries(ctx.db, [
        workflow,
      ]);
      return workflowWithSummary;
    }),

  getRuns: publicProcedure
    .input(z.object({ workflowId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      // Confirm the parent workflow is in-tenant before returning its runs;
      // workflowRuns has no tenantId column, so it is scoped via its parent.
      await getWorkflowOrThrow(ctx, input.workflowId);

      return ctx.db
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.workflowId, input.workflowId))
        .orderBy(desc(workflowRuns.startedAt));
    }),

  runNow: requirePermission("workflow:write")
    .input(z.object({ workflowId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const workflow = await getWorkflowOrThrow(ctx, input.workflowId);

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
          // Attribute the notification to the workflow's own tenant so it
          // appears in the correct tenant's feed (null for internal workflows).
          tenantId: workflow.tenantId ?? null,
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
