import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { notifications, workflowRuns, workflows } from "~/server/db/schema";

export const workflowRouter = createTRPCRouter({
  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        triggerType: z.enum(["new_package", "schedule"]),
        triggerConfig: z.record(z.unknown()).default({}),
        actionType: z.enum(["in_app", "email"]),
        actionConfig: z.record(z.unknown()).default({}),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date().toISOString();
      const [newWorkflow] = await ctx.db
        .insert(workflows)
        .values({
          name: input.name,
          triggerType: input.triggerType,
          triggerConfig: input.triggerConfig,
          actionType: input.actionType,
          actionConfig: input.actionConfig,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      return newWorkflow;
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().min(1).optional(),
        triggerConfig: z.record(z.unknown()).optional(),
        actionConfig: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.name && !input.triggerConfig && !input.actionConfig) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Can cap nhat it nhat mot truong cho workflow.",
        });
      }

      const [existingWorkflow] = await ctx.db
        .select({ id: workflows.id })
        .from(workflows)
        .where(eq(workflows.id, input.id))
        .limit(1);

      if (!existingWorkflow) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workflow khong ton tai",
        });
      }

      const updateData: {
        name?: string;
        triggerConfig?: Record<string, unknown>;
        actionConfig?: Record<string, unknown>;
        updatedAt: string;
      } = {
        updatedAt: new Date().toISOString(),
      };

      if (input.name) updateData.name = input.name;
      if (input.triggerConfig) updateData.triggerConfig = input.triggerConfig;
      if (input.actionConfig) updateData.actionConfig = input.actionConfig;

      const [workflow] = await ctx.db
        .update(workflows)
        .set(updateData)
        .where(eq(workflows.id, input.id))
        .returning();

      return workflow;
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
          message: "Workflow khong ton tai",
        });
      }

      return workflow;
    }),

  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(workflows).orderBy(desc(workflows.updatedAt));
  }),

  getRuns: publicProcedure
    .input(z.object({ workflowId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.workflowId, input.workflowId))
        .orderBy(desc(workflowRuns.startedAt));
    }),

  runNow: publicProcedure
    .input(z.object({ workflowId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const [workflow] = await ctx.db
        .select()
        .from(workflows)
        .where(eq(workflows.id, input.workflowId))
        .limit(1);

      if (!workflow) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workflow khong ton tai",
        });
      }

      if (!workflow.isActive) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Workflow dang tat, vui long bat workflow truoc khi chay.",
        });
      }

      const startedAt = new Date().toISOString();
      const status = "success";
      const message = "Workflow chay thanh cong, da tao thong bao";

      const run = await ctx.db.transaction(async (tx) => {
        const [createdRun] = await tx
          .insert(workflowRuns)
          .values({
            workflowId: workflow.id,
            status,
            startedAt,
            finishedAt: new Date().toISOString(),
            message,
          })
          .returning();

        await tx.insert(notifications).values({
          channel: workflow.actionType,
          title:
            status === "success"
              ? `Workflow ${workflow.name} da chay`
              : `Workflow ${workflow.name} chay that bai`,
          body: message,
          severity: status === "success" ? "medium" : "high",
          isRead: false,
          createdAt: new Date().toISOString(),
        });

        return createdRun;
      });

      return run;
    }),
});
