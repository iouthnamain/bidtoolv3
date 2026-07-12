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
  previewMaterialProfileCleanExport,
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
import {
  cancelMaterialProfileSearchJob,
  getMaterialProfileSearchJob,
  listMaterialProfileSearchJobs,
  listMaterialProfileSearchRuns,
  MaterialProfileSearchJobError,
  setCurrentMaterialProfileSearchRun,
  startMaterialProfileSearchJob,
} from "~/server/services/material-profile-search-jobs";
import {
  attachMaterialProfileCatalogPdfSource,
  activateMaterialProfileScrapedProduct,
  cancelMaterialProfileScrapeJob,
  getActiveMaterialProfileScrapeJob,
  getMaterialProfileScrapeJob,
  getMaterialProfileScrapeHistory,
  listMaterialProfileScrapeRuns,
  MaterialProfileScrapeJobError,
  retryMaterialProfileScrapeRuns,
  removeMaterialProfileScrapedProduct,
  selectMaterialProfileScrapedProduct,
  startMaterialProfileScrapeJob,
} from "~/server/services/material-profile-scrape-jobs";
import {
  cancelMaterialProfileSaveBatch,
  commitMaterialProfileSaveBatch,
  createMaterialProfileSavePreview,
  getMaterialProfileSaveBatch,
  listMaterialProfileSaveBatches,
  MaterialProfileMaterialBatchError,
  undoMaterialProfileSaveBatch,
  updateMaterialProfileSavePreviewRow,
} from "~/server/services/material-profile-material-batches";
import {
  rejectMaterialSearchResult,
  restoreMaterialSearchResult,
} from "~/server/services/material-search-feedback";

function mapMaterialProfileError(error: unknown): never {
  if (error instanceof MaterialProfileMaterialBatchError) {
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
  if (error instanceof MaterialProfileScrapeJobError) {
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
  if (error instanceof MaterialProfileSearchJobError) {
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

const searchJobIdInput = z.object({
  jobId: z.string().uuid(),
});

const searchModeInput = z.enum(["web", "ai", "auto"]);

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

const webSearchStatusSchema = z.enum(["idle", "pending", "done", "error"]);

const materialEnrichmentEvidenceSchema = z.object({
  field: z.string(),
  value: z.string().optional(),
  snippet: z.string(),
  sourceUrl: z.string().optional(),
});

const webLinkResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  domain: z.string(),
  snippet: z.string(),
  query: z.string().optional(),
  rankScore: z.number().optional(),
  relevanceDecision: z
    .object({
      url: z.string(),
      verdict: z.enum(["relevant", "irrelevant", "uncertain"]),
      confidence: z.number(),
      productFamilyMatch: z.boolean(),
      matchedIdentifiers: z.array(z.string()),
      conflictingIdentifiers: z.array(z.string()),
      numericSpecMatch: z.boolean().nullable(),
      reasons: z.array(z.string()),
      evidence: z.array(
        z.object({ sourceUrl: z.string(), snippet: z.string() }),
      ),
    })
    .optional(),
  baseRankScore: z.number().optional(),
  rrfScore: z.number().optional(),
  fetchStatus: z.enum(["verified", "unverified", "failed"]).optional(),
  matchedQueries: z
    .array(
      z.object({
        query: z.string(),
        intent: z.string(),
        rank: z.number().int().positive(),
      }),
    )
    .optional(),
  assessment: z.record(z.unknown()).optional(),
  aiDecision: z.record(z.unknown()).optional(),
});

const aiSearchStoredResultSchema = z.object({
  fields: z.record(z.string()),
  sourceUrls: z.array(z.string()),
  evidence: z.array(materialEnrichmentEvidenceSchema),
  catalogPdfUrls: z.array(z.string()).optional(),
  fieldConfidences: z.record(z.number()).optional(),
  title: z.string().optional(),
  url: z.string().optional(),
  snippet: z.string().optional(),
  rankScore: z.number().optional(),
});

const profileScrapedProductSchema = z.object({
  name: z.string(),
  unit: z.string().nullable(),
  category: z.string().nullable(),
  specText: z.string(),
  manufacturer: z.string().nullable(),
  originCountry: z.string().nullable(),
  price: z.number().nullable(),
  priceText: z.string().nullable(),
  currency: z.string(),
  sourceUrl: z.string(),
  imageUrl: z.string().nullish(),
  sku: z.string().nullable(),
  model: z.string().nullable(),
  shopCategory: z.string().nullable(),
  catalogPdfUrls: z.array(z.string()),
});

const scrapedProductStoredResultSchema = z.object({
  productKey: z.string(),
  jobId: z.string(),
  shopScrapeJobId: z.string().nullable(),
  sourceCandidateKey: z.string(),
  sourceUrl: z.string(),
  sourceScore: z.number().nullable(),
  product: profileScrapedProductSchema,
  fields: z.record(z.string()),
  name: z.string(),
  imageUrl: z.string().optional(),
  evidence: z.array(materialEnrichmentEvidenceSchema),
  catalogPdfUrls: z.array(z.string()),
  productMatchScore: z.number().nullable(),
  reviewDraft: z
    .object({
      acceptedFields: z.array(z.string()),
      overwriteFields: z.array(z.string()).optional(),
      editedValues: z.record(z.string()).optional(),
      acceptedProfileFields: z.array(z.enum(["name", "imageUrl"])).optional(),
      editedProfileValues: z
        .object({
          name: z.string().optional(),
          imageUrl: z.string().optional(),
        })
        .optional(),
      catalogPdfUrls: z.array(z.string()).optional(),
    })
    .optional(),
});

const serializedRowDecisionSchema = z.object({
  materialId: z.number().int().positive().nullable(),
  acceptedFields: z.array(z.string()),
  overwriteFields: z.array(z.string()).optional(),
  editedValues: z.record(z.string()).optional(),
  webProposedFields: z.record(z.string()).optional(),
  webEvidence: z.array(materialEnrichmentEvidenceSchema).optional(),
  webSearchStatus: webSearchStatusSchema.optional(),
  webLinkResults: z.array(webLinkResultSchema).optional(),
  webLinksStatus: webSearchStatusSchema.optional(),
  aiSearchResult: aiSearchStoredResultSchema.optional(),
  aiSearchCandidates: z.array(aiSearchStoredResultSchema).optional(),
  scrapeResults: z.array(scrapedProductStoredResultSchema).optional(),
  acceptedProfileFields: z.array(z.enum(["name", "imageUrl"])).optional(),
  editedProfileValues: z
    .object({ name: z.string().optional(), imageUrl: z.string().optional() })
    .optional(),
  aiSearchStatus: webSearchStatusSchema.optional(),
  selectedSource: z.enum(["catalog", "web", "ai"]).optional(),
  selectedSearchCandidateKey: z.string().optional(),
  selectedScrapeProductKey: z.string().nullable().optional(),
  catalogPdfUrls: z.array(z.string()).optional(),
  skipped: z.boolean().optional(),
});

export const materialProfileRouter = createTRPCRouter({
  rejectSearchResult: requirePermission("material:write")
    .input(
      z.object({
        itemId: z.number().int().positive(),
        url: z.string().url().max(2000),
        title: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(({ input }) => rejectMaterialSearchResult(input)),

  restoreSearchResult: requirePermission("material:write")
    .input(z.object({ feedbackId: z.number().int().positive() }))
    .mutation(({ input }) => restoreMaterialSearchResult(input.feedbackId)),

  create: requirePermission("material:write")
    .input(
      z.object({
        name: z.string().trim().max(160).optional(),
        noticeNumber: z.string().trim().max(120).optional(),
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
        name: z.string().trim().max(160).optional(),
        noticeNumber: z.string().trim().max(120).nullable().optional(),
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

  startSearchJob: requirePermission("material:write")
    .input(
      workspaceIdInput.extend({
        itemIds: z.array(z.number().int().positive()).min(1).max(5_000),
        mode: searchModeInput,
      }),
    )
    .mutation(({ input }) =>
      withMaterialProfileErrors(() =>
        startMaterialProfileSearchJob({
          workspaceId: input.workspaceId,
          itemIds: input.itemIds,
          mode: input.mode,
        }),
      ),
    ),

  startScrapeJob: requirePermission("material:write")
    .input(
      workspaceIdInput.extend({
        itemIds: z.array(z.number().int().positive()).min(1).max(500),
        interactive: z.boolean().default(false),
        sourceUrl: z.string().url().optional(),
        sourceCandidateKey: z.string().optional(),
      }),
    )
    .mutation(({ input }) =>
      withMaterialProfileErrors(() => startMaterialProfileScrapeJob(input)),
    ),

  getScrapeJob: requirePermission("material:write")
    .input(workspaceIdInput.extend({ jobId: z.string().uuid() }))
    .query(({ input }) =>
      withMaterialProfileErrors(() =>
        getMaterialProfileScrapeJob(input.jobId, input.workspaceId),
      ),
    ),

  getScrapeJobProgress: requirePermission("material:write")
    .input(workspaceIdInput.extend({ jobId: z.string().uuid() }))
    .query(({ input }) =>
      withMaterialProfileErrors(() =>
        getMaterialProfileScrapeJob(input.jobId, input.workspaceId),
      ),
    ),

  getActiveScrapeJob: requirePermission("material:write")
    .input(workspaceIdInput)
    .query(({ input }) =>
      withMaterialProfileErrors(() =>
        getActiveMaterialProfileScrapeJob(input.workspaceId),
      ),
    ),

  listScrapeRuns: requirePermission("material:write")
    .input(workspaceIdInput.extend({ jobId: z.string().uuid() }))
    .query(({ input }) =>
      withMaterialProfileErrors(() =>
        listMaterialProfileScrapeRuns(input.jobId, input.workspaceId),
      ),
    ),

  getScrapeHistory: requirePermission("material:write")
    .input(workspaceIdInput.extend({ itemId: z.number().int().positive() }))
    .query(({ input }) =>
      withMaterialProfileErrors(() => getMaterialProfileScrapeHistory(input)),
    ),

  selectScrapedProduct: requirePermission("material:write")
    .input(
      workspaceIdInput.extend({
        runId: z.string().uuid(),
        productIndex: z.number().int().min(0).max(7),
      }),
    )
    .mutation(({ input }) =>
      withMaterialProfileErrors(() =>
        selectMaterialProfileScrapedProduct(input),
      ),
    ),

  activateScrapedProduct: requirePermission("material:write")
    .input(
      workspaceIdInput.extend({
        itemId: z.number().int().positive(),
        productKey: z.string().trim().min(1).max(200),
      }),
    )
    .mutation(({ input }) =>
      withMaterialProfileErrors(() =>
        activateMaterialProfileScrapedProduct(input),
      ),
    ),

  removeScrapedProduct: requirePermission("material:write")
    .input(
      workspaceIdInput.extend({
        itemId: z.number().int().positive(),
        productKey: z.string().trim().min(1).max(200),
      }),
    )
    .mutation(({ input }) =>
      withMaterialProfileErrors(() =>
        removeMaterialProfileScrapedProduct(input),
      ),
    ),

  retryScrapeRuns: requirePermission("material:write")
    .input(
      workspaceIdInput.extend({
        jobId: z.string().uuid(),
        runIds: z.array(z.string().uuid()).max(500).optional(),
      }),
    )
    .mutation(({ input }) =>
      withMaterialProfileErrors(() => retryMaterialProfileScrapeRuns(input)),
    ),

  cancelScrapeJob: requirePermission("material:write")
    .input(workspaceIdInput.extend({ jobId: z.string().uuid() }))
    .mutation(({ input }) =>
      withMaterialProfileErrors(() =>
        cancelMaterialProfileScrapeJob(input.jobId, input.workspaceId),
      ),
    ),

  attachCatalogPdfSource: requirePermission("material:write")
    .input(
      workspaceIdInput.extend({
        itemId: z.number().int().positive(),
        sourceUrl: z.string().url(),
        sourceCandidateKey: z.string().optional(),
      }),
    )
    .mutation(({ input }) =>
      withMaterialProfileErrors(() =>
        attachMaterialProfileCatalogPdfSource(input),
      ),
    ),

  createMaterialSavePreview: requirePermission("material:write")
    .input(
      workspaceIdInput.extend({
        itemIds: z.array(z.number().int().positive()).min(1).max(500),
        sourceScrapeJobId: z.string().uuid().optional(),
        single: z.boolean().default(false),
      }),
    )
    .mutation(({ input }) =>
      withMaterialProfileErrors(() => createMaterialProfileSavePreview(input)),
    ),

  getMaterialSaveBatch: requirePermission("material:write")
    .input(workspaceIdInput.extend({ batchId: z.string().uuid() }))
    .query(({ input }) =>
      withMaterialProfileErrors(() =>
        getMaterialProfileSaveBatch(input.batchId, input.workspaceId),
      ),
    ),

  updateMaterialSavePreviewRow: requirePermission("material:write")
    .input(
      workspaceIdInput.extend({
        batchId: z.string().uuid(),
        rowId: z.string().uuid(),
        included: z.boolean().optional(),
        targetMaterialId: z.number().int().positive().nullable().optional(),
      }),
    )
    .mutation(({ input }) =>
      withMaterialProfileErrors(() =>
        updateMaterialProfileSavePreviewRow(input),
      ),
    ),

  commitMaterialSaveBatch: requirePermission("material:write")
    .input(workspaceIdInput.extend({ batchId: z.string().uuid() }))
    .mutation(({ input }) =>
      withMaterialProfileErrors(() =>
        commitMaterialProfileSaveBatch(input.batchId, input.workspaceId),
      ),
    ),

  cancelMaterialSaveBatch: requirePermission("material:write")
    .input(workspaceIdInput.extend({ batchId: z.string().uuid() }))
    .mutation(({ input }) =>
      withMaterialProfileErrors(() =>
        cancelMaterialProfileSaveBatch(input.batchId, input.workspaceId),
      ),
    ),

  listMaterialSaveBatches: requirePermission("material:write")
    .input(
      workspaceIdInput.extend({
        limit: z.number().int().min(1).max(100).optional(),
      }),
    )
    .query(({ input }) =>
      withMaterialProfileErrors(() =>
        listMaterialProfileSaveBatches(input.workspaceId, input.limit),
      ),
    ),

  undoMaterialSaveBatch: requirePermission("material:write")
    .input(workspaceIdInput.extend({ batchId: z.string().uuid() }))
    .mutation(({ input }) =>
      withMaterialProfileErrors(() =>
        undoMaterialProfileSaveBatch(input.batchId, input.workspaceId),
      ),
    ),

  getSearchJob: protectedProcedure.input(searchJobIdInput).query(({ input }) =>
    withMaterialProfileErrors(async () => {
      const job = await getMaterialProfileSearchJob(input.jobId);
      if (!job) {
        throw new MaterialProfileSearchJobError(
          "NOT_FOUND",
          "Không tìm thấy job tìm kiếm.",
        );
      }
      return job;
    }),
  ),

  listSearchJobs: protectedProcedure
    .input(
      workspaceIdInput.extend({
        limit: z.number().int().min(1).max(50).optional(),
      }),
    )
    .query(({ input }) =>
      withMaterialProfileErrors(() =>
        listMaterialProfileSearchJobs({
          workspaceId: input.workspaceId,
          limit: input.limit,
        }),
      ),
    ),

  listSearchRuns: protectedProcedure
    .input(
      z.object({
        workspaceId: z.number().int().positive().optional(),
        jobId: z.string().uuid().optional(),
        itemId: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }),
    )
    .query(({ input }) =>
      withMaterialProfileErrors(() => listMaterialProfileSearchRuns(input)),
    ),

  cancelSearchJob: requirePermission("material:write")
    .input(searchJobIdInput)
    .mutation(({ input }) =>
      withMaterialProfileErrors(() =>
        cancelMaterialProfileSearchJob(input.jobId),
      ),
    ),

  setCurrentSearchRun: requirePermission("material:write")
    .input(
      z.object({
        runId: z.number().int().positive(),
      }),
    )
    .mutation(({ input }) =>
      withMaterialProfileErrors(() =>
        setCurrentMaterialProfileSearchRun(input.runId),
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

  previewCleanExport: requirePermission("material:write")
    .input(workspaceIdInput)
    .query(({ ctx, input }) =>
      withMaterialProfileErrors(() =>
        previewMaterialProfileCleanExport(ctx.db, input.workspaceId),
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
