import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { ENRICHABLE_FIELDS } from "~/lib/materials/material-enrichment-types";
import {
  createTRPCRouter,
  publicProcedure,
  requirePermission,
} from "~/server/api/trpc";
import {
  creatorTenantId,
  tenantScopeValue,
} from "~/server/api/tenant-scope";
import {
  bulkCommitMaterialEnrichment,
  cancelMaterialEnrichmentJob,
  commitMaterialEnrichmentItem,
  deleteMaterialEnrichmentJob,
  exportMaterialEnrichmentReport,
  getMaterialEnrichmentItem,
  getMaterialEnrichmentItemCandidates,
  getMaterialEnrichmentJob,
  listMaterialEnrichmentItems,
  listMaterialEnrichmentJobs,
  rejectMaterialEnrichmentItem,
  selectWebCandidate,
  startMaterialEnrichmentJob,
} from "~/server/services/material-enrichment-jobs";
import { ShopJobServiceError } from "~/server/services/shop-job-errors";

async function withShopJobErrors<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ShopJobServiceError) {
      throw new TRPCError({
        code: error.code,
        message: error.message,
      });
    }
    throw error;
  }
}

const materialEnrichmentJobOptionsInput = z.object({
  autoCommitHighConfidence: z.boolean().optional(),
  skipWellFilled: z.boolean().optional(),
  generatePdfIfMissing: z.boolean().optional(),
  model: z.string().trim().optional(),
  maxSearchResults: z.number().int().positive().optional(),
  maxQueries: z.number().int().positive().optional(),
  fields: z.array(z.enum(ENRICHABLE_FIELDS)).optional(),
});

const startMaterialEnrichmentJobInput = z.object({
  materialIds: z.array(z.number().int().positive()).min(1).max(500),
  options: materialEnrichmentJobOptionsInput.optional(),
});

const materialEnrichmentJobInput = z.object({
  jobId: z.string().uuid(),
});

const listMaterialEnrichmentJobsInput = z
  .object({
    limit: z.number().int().min(1).max(100).default(25),
    offset: z.number().int().min(0).default(0),
  })
  .optional();

const listMaterialEnrichmentItemsInput = z.object({
  jobId: z.string().uuid(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
});

const materialEnrichmentItemInput = z.object({
  itemId: z.number().int().positive(),
});

const selectWebCandidateInput = z.object({
  itemId: z.number().int().positive(),
  candidateId: z.number().int().positive(),
});

const bulkCommitMaterialEnrichmentInput = z.object({
  jobId: z.string().uuid(),
  itemIds: z.array(z.number().int().positive()).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
});

export const materialEnrichmentRouter = createTRPCRouter({
  startMaterialEnrichmentJob: requirePermission("enrichment:run")
    .input(startMaterialEnrichmentJobInput)
    .mutation(({ ctx, input }) =>
      withShopJobErrors(() =>
        startMaterialEnrichmentJob({
          ...input,
          tenantId: creatorTenantId(ctx),
        }),
      ),
    ),

  listMaterialEnrichmentJobs: publicProcedure
    .input(listMaterialEnrichmentJobsInput)
    .query(({ ctx, input }) =>
      listMaterialEnrichmentJobs(input, tenantScopeValue(ctx)),
    ),

  getMaterialEnrichmentJob: publicProcedure
    .input(materialEnrichmentJobInput)
    .query(async ({ ctx, input }) => {
      const job = await getMaterialEnrichmentJob(
        input.jobId,
        tenantScopeValue(ctx),
      );
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy job enrichment vật liệu.",
        });
      }
      return job;
    }),

  cancelMaterialEnrichmentJob: requirePermission("enrichment:run")
    .input(materialEnrichmentJobInput)
    .mutation(async ({ ctx, input }) => {
      const job = await withShopJobErrors(() =>
        cancelMaterialEnrichmentJob(input.jobId, tenantScopeValue(ctx)),
      );
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy job enrichment vật liệu.",
        });
      }
      return job;
    }),

  deleteMaterialEnrichmentJob: requirePermission("enrichment:run")
    .input(materialEnrichmentJobInput)
    .mutation(async ({ ctx, input }) => {
      const job = await withShopJobErrors(() =>
        deleteMaterialEnrichmentJob(input.jobId, tenantScopeValue(ctx)),
      );
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy job enrichment vật liệu.",
        });
      }
      return job;
    }),

  listMaterialEnrichmentItems: publicProcedure
    .input(listMaterialEnrichmentItemsInput)
    .query(({ ctx, input }) =>
      withShopJobErrors(() =>
        listMaterialEnrichmentItems(input, tenantScopeValue(ctx)),
      ),
    ),

  getMaterialEnrichmentItem: publicProcedure
    .input(materialEnrichmentItemInput)
    .query(async ({ ctx, input }) => {
      const item = await getMaterialEnrichmentItem(
        input.itemId,
        tenantScopeValue(ctx),
      );
      if (!item) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy mục enrichment vật liệu.",
        });
      }
      return item;
    }),

  getMaterialEnrichmentItemCandidates: publicProcedure
    .input(materialEnrichmentItemInput)
    .query(({ ctx, input }) =>
      withShopJobErrors(() =>
        getMaterialEnrichmentItemCandidates(
          input.itemId,
          tenantScopeValue(ctx),
        ),
      ),
    ),

  selectWebCandidate: requirePermission("enrichment:run")
    .input(selectWebCandidateInput)
    .mutation(({ ctx, input }) =>
      withShopJobErrors(() =>
        selectWebCandidate(
          input.itemId,
          input.candidateId,
          tenantScopeValue(ctx),
        ),
      ),
    ),

  commitMaterialEnrichmentItem: requirePermission("enrichment:run")
    .input(materialEnrichmentItemInput)
    .mutation(({ ctx, input }) =>
      withShopJobErrors(() =>
        commitMaterialEnrichmentItem(input.itemId, tenantScopeValue(ctx)),
      ),
    ),

  bulkCommitMaterialEnrichment: requirePermission("enrichment:run")
    .input(bulkCommitMaterialEnrichmentInput)
    .mutation(({ ctx, input }) =>
      withShopJobErrors(() =>
        bulkCommitMaterialEnrichment(input, tenantScopeValue(ctx)),
      ),
    ),

  rejectMaterialEnrichmentItem: requirePermission("enrichment:run")
    .input(materialEnrichmentItemInput)
    .mutation(({ ctx, input }) =>
      withShopJobErrors(() =>
        rejectMaterialEnrichmentItem(input.itemId, tenantScopeValue(ctx)),
      ),
    ),

  exportMaterialEnrichmentReport: publicProcedure
    .input(materialEnrichmentJobInput)
    .query(({ ctx, input }) =>
      withShopJobErrors(() =>
        exportMaterialEnrichmentReport(input.jobId, tenantScopeValue(ctx)),
      ),
    ),
});
