import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  createTRPCRouter,
  protectedProcedure,
  requirePermission,
} from "~/server/api/trpc";
import {
  createMaterialProfileWorkspace,
  exportMaterialProfileWorkspace,
  getMaterialProfileWorkspace,
  listMaterialProfileWorkspaces,
  matchMaterialProfileWorkspace,
  MaterialProfileWorkspaceError,
  updateMaterialProfileItem,
  updateMaterialProfileWorkspaceState,
  uploadMaterialProfileWorkbook,
} from "~/server/services/material-profile-workspaces";

function mapMaterialProfileError(error: unknown): never {
  if (error instanceof MaterialProfileWorkspaceError) {
    throw new TRPCError({
      code:
        error.code === "NOT_FOUND"
          ? "NOT_FOUND"
          : error.code === "CONFLICT"
            ? "CONFLICT"
            : "BAD_REQUEST",
      message: error.message,
    });
  }
  throw error;
}

async function withMaterialProfileErrors<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    mapMaterialProfileError(error);
  }
}

const workspaceIdInput = z.object({
  workspaceId: z.number().int().positive(),
});

const cellEditsSchema = z.record(z.string(), z.record(z.string(), z.string()));

export const materialProfileRouter = createTRPCRouter({
  create: requirePermission("material:write")
    .input(
      z.object({
        noticeNumber: z.string().trim().min(1).max(120),
      }),
    )
    .mutation(({ ctx, input }) =>
      withMaterialProfileErrors(() =>
        createMaterialProfileWorkspace(ctx.db, input),
      ),
    ),

  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .optional(),
    )
    .query(({ ctx, input }) =>
      listMaterialProfileWorkspaces(ctx.db, input ?? undefined),
    ),

  get: protectedProcedure
    .input(workspaceIdInput)
    .query(({ ctx, input }) =>
      withMaterialProfileErrors(() =>
        getMaterialProfileWorkspace(ctx.db, input.workspaceId),
      ),
    ),

  uploadWorkbook: requirePermission("material:write")
    .input(
      workspaceIdInput.extend({
        fileName: z.string().trim().min(1).max(240),
        workbookBase64: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) =>
      withMaterialProfileErrors(() =>
        uploadMaterialProfileWorkbook(ctx.db, input),
      ),
    ),

  updateState: requirePermission("material:write")
    .input(
      workspaceIdInput.extend({
        sheetName: z.string().trim().min(1).optional(),
        headerRowIndex: z.number().int().min(1).optional(),
        mapping: z.record(z.string(), z.string().nullable()).optional(),
        editState: cellEditsSchema.optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withMaterialProfileErrors(() =>
        updateMaterialProfileWorkspaceState(ctx.db, input),
      ),
    ),

  match: requirePermission("material:write")
    .input(
      workspaceIdInput.extend({
        sheetName: z.string().trim().min(1).optional(),
        headerRowIndex: z.number().int().min(1).optional(),
        mapping: z.record(z.string(), z.string().nullable()).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withMaterialProfileErrors(() =>
        matchMaterialProfileWorkspace(ctx.db, input),
      ),
    ),

  updateItem: requirePermission("material:write")
    .input(
      z.object({
        itemId: z.number().int().positive(),
        materialId: z.number().int().positive().nullable().optional(),
        includedInExport: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withMaterialProfileErrors(() => updateMaterialProfileItem(ctx.db, input)),
    ),

  export: requirePermission("material:write")
    .input(workspaceIdInput)
    .mutation(({ ctx, input }) =>
      withMaterialProfileErrors(() =>
        exportMaterialProfileWorkspace(ctx.db, input.workspaceId),
      ),
    ),
});
