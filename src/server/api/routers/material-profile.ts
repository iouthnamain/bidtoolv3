import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { SerializedRowDecision } from "~/lib/materials/review-decision";
import {
  createTRPCRouter,
  protectedProcedure,
  requirePermission,
} from "~/server/api/trpc";
import {
  bulkApplyMaterialProfileMatches,
  bulkAiSearchMaterialProfileItems,
  bulkUpdateMaterialProfileItems,
  createMaterialProfileWorkspace,
  deleteMaterialProfileWorkspace,
  exportMaterialProfileDownloadBundle,
  exportMaterialProfileWorkspace,
  getMaterialProfileWorkspace,
  listMaterialProfileWorkspaces,
  matchMaterialProfileWorkspace,
  MaterialProfileWorkspaceError,
  openMaterialProfileOutputFolder,
  previewMaterialProfileExportWorkbook,
  resolveDefaultDownloadsDir,
  undoLastMaterialProfileBulkApply,
  updateMaterialProfileWorkspace,
  updateMaterialProfileExportEditState,
  updateMaterialProfileItemEnrichmentDraft,
  updateMaterialProfileItem,
  updateMaterialProfileItemReviewDecision,
  batchUpdateMaterialProfileItemReviewDecisions,
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
const sheetNumberMapSchema = z.record(
  z.string(),
  z.array(z.number().int().positive()),
);
const exportEditStateSchema = z.object({
  cellEdits: cellEditsSchema.default({}),
  deletedRows: sheetNumberMapSchema.default({}),
  deletedColumns: sheetNumberMapSchema.default({}),
  updatedAt: z.string().optional(),
});

const serializedRowDecisionSchema = z.object({
  materialId: z.number().int().positive().nullable(),
  acceptedFields: z.array(z.string()),
  overwriteFields: z.array(z.string()).optional(),
  editedValues: z.record(z.string()).optional(),
  webProposedFields: z.record(z.string()).optional(),
  webEvidence: z
    .array(
      z.object({
        field: z.string(),
        snippet: z.string(),
        sourceUrl: z.string().optional(),
      }),
    )
    .optional(),
  webSearchStatus: z.enum(["idle", "pending", "done", "error"]).optional(),
  skipped: z.boolean().optional(),
});

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

  update: requirePermission("material:write")
    .input(
      workspaceIdInput.extend({
        noticeNumber: z.string().trim().min(1).max(120),
      }),
    )
    .mutation(({ ctx, input }) =>
      withMaterialProfileErrors(() =>
        updateMaterialProfileWorkspace(ctx.db, input),
      ),
    ),

  delete: requirePermission("material:write")
    .input(workspaceIdInput)
    .mutation(({ ctx, input }) =>
      withMaterialProfileErrors(() =>
        deleteMaterialProfileWorkspace(ctx.db, input.workspaceId),
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

  updateItemReviewDecision: requirePermission("material:write")
    .input(
      z.object({
        itemId: z.number().int().positive(),
        decision: serializedRowDecisionSchema,
      }),
    )
    .mutation(({ ctx, input }) =>
      withMaterialProfileErrors(() =>
        updateMaterialProfileItemReviewDecision(ctx.db, {
          itemId: input.itemId,
          decision: input.decision as SerializedRowDecision,
        }),
      ),
    ),

  batchUpdateItemReviewDecisions: requirePermission("material:write")
    .input(
      workspaceIdInput.extend({
        decisions: z
          .array(
            z.object({
              itemId: z.number().int().positive(),
              decision: serializedRowDecisionSchema,
            }),
          )
          .min(1)
          .max(500),
      }),
    )
    .mutation(({ ctx, input }) =>
      withMaterialProfileErrors(() =>
        batchUpdateMaterialProfileItemReviewDecisions(ctx.db, {
          workspaceId: input.workspaceId,
          decisions: input.decisions.map((entry) => ({
            itemId: entry.itemId,
            decision: entry.decision as SerializedRowDecision,
          })),
        }),
      ),
    ),

  updateItemEnrichmentDraft: requirePermission("material:write")
    .input(
      z.object({
        itemId: z.number().int().positive(),
        enrichmentStatus: z
          .enum([
            "idle",
            "web_searching",
            "web_done",
            "ai_searching",
            "ai_done",
            "error",
          ])
          .optional(),
        webResults: z.array(z.record(z.unknown())).optional(),
        aiFields: z.record(z.unknown()).optional(),
        aiEvidence: z.array(z.record(z.unknown())).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withMaterialProfileErrors(() =>
        updateMaterialProfileItemEnrichmentDraft(ctx.db, input),
      ),
    ),

  bulkUpdateItems: requirePermission("material:write")
    .input(
      workspaceIdInput.extend({
        itemIds: z.array(z.number().int().positive()).min(1).max(500),
        includedInExport: z.boolean().optional(),
        clearMaterialId: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withMaterialProfileErrors(() =>
        bulkUpdateMaterialProfileItems(ctx.db, input),
      ),
    ),

  bulkAiSearchItems: requirePermission("material:write")
    .input(
      workspaceIdInput.extend({
        itemIds: z.array(z.number().int().positive()).min(1).max(500),
      }),
    )
    .mutation(({ ctx, input }) =>
      withMaterialProfileErrors(() =>
        bulkAiSearchMaterialProfileItems(ctx.db, input),
      ),
    ),

  bulkApplyMatches: requirePermission("material:write")
    .input(
      workspaceIdInput.extend({
        itemIds: z.array(z.number().int().positive()).min(1).max(500),
        threshold: z.number().min(0).max(1).default(0.85),
      }),
    )
    .mutation(({ ctx, input }) =>
      withMaterialProfileErrors(() =>
        bulkApplyMaterialProfileMatches(ctx.db, input),
      ),
    ),

  undoLastBulkApply: requirePermission("material:write")
    .input(workspaceIdInput)
    .mutation(({ ctx, input }) =>
      withMaterialProfileErrors(() =>
        undoLastMaterialProfileBulkApply(ctx.db, input.workspaceId),
      ),
    ),

  updateExportEditState: requirePermission("material:write")
    .input(
      workspaceIdInput.extend({
        exportEditState: exportEditStateSchema,
      }),
    )
    .mutation(({ ctx, input }) =>
      withMaterialProfileErrors(() =>
        updateMaterialProfileExportEditState(ctx.db, input),
      ),
    ),

  export: requirePermission("material:write")
    .input(
      workspaceIdInput.extend({
        outputDirPath: z.string().trim().min(1),
      }),
    )
    .mutation(({ ctx, input }) =>
      withMaterialProfileErrors(() =>
        exportMaterialProfileWorkspace(
          ctx.db,
          input.workspaceId,
          input.outputDirPath,
        ),
      ),
    ),

  exportDownloadBundle: requirePermission("material:write")
    .input(workspaceIdInput)
    .mutation(({ ctx, input }) =>
      withMaterialProfileErrors(() =>
        exportMaterialProfileDownloadBundle(ctx.db, input.workspaceId),
      ),
    ),

  getDefaultExportDir: protectedProcedure.query(() => ({
    path: resolveDefaultDownloadsDir(),
  })),

  previewExportWorkbook: requirePermission("material:write")
    .input(workspaceIdInput)
    .mutation(({ ctx, input }) =>
      withMaterialProfileErrors(() =>
        previewMaterialProfileExportWorkbook(ctx.db, input.workspaceId),
      ),
    ),

  openOutputFolder: requirePermission("material:write")
    .input(workspaceIdInput)
    .mutation(({ ctx, input }) =>
      withMaterialProfileErrors(() =>
        openMaterialProfileOutputFolder(ctx.db, input.workspaceId),
      ),
    ),
});
