import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { ENRICHABLE_FIELDS } from "~/lib/materials/material-enrichment-types";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import {
  bulkCommitMaterialEnrichment,
  cancelMaterialEnrichmentJob,
  commitMaterialEnrichmentItem,
  deleteMaterialEnrichmentJob,
  exportMaterialEnrichmentReport,
  getMaterialEnrichmentItem,
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
  startMaterialEnrichmentJob: publicProcedure
    .input(startMaterialEnrichmentJobInput)
    .mutation(({ input }) =>
      withShopJobErrors(() => startMaterialEnrichmentJob(input)),
    ),

  listMaterialEnrichmentJobs: publicProcedure
    .input(listMaterialEnrichmentJobsInput)
    .query(({ input }) => listMaterialEnrichmentJobs(input)),

  getMaterialEnrichmentJob: publicProcedure
    .input(materialEnrichmentJobInput)
    .query(async ({ input }) => {
      const job = await getMaterialEnrichmentJob(input.jobId);
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy job enrichment vật liệu.",
        });
      }
      return job;
    }),

  cancelMaterialEnrichmentJob: publicProcedure
    .input(materialEnrichmentJobInput)
    .mutation(async ({ input }) => {
      const job = await withShopJobErrors(() =>
        cancelMaterialEnrichmentJob(input.jobId),
      );
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy job enrichment vật liệu.",
        });
      }
      return job;
    }),

  deleteMaterialEnrichmentJob: publicProcedure
    .input(materialEnrichmentJobInput)
    .mutation(async ({ input }) => {
      const job = await withShopJobErrors(() =>
        deleteMaterialEnrichmentJob(input.jobId),
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
    .query(({ input }) => listMaterialEnrichmentItems(input)),

  getMaterialEnrichmentItem: publicProcedure
    .input(materialEnrichmentItemInput)
    .query(async ({ input }) => {
      const item = await getMaterialEnrichmentItem(input.itemId);
      if (!item) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy mục enrichment vật liệu.",
        });
      }
      return item;
    }),

  selectWebCandidate: publicProcedure
    .input(selectWebCandidateInput)
    .mutation(({ input }) =>
      withShopJobErrors(() =>
        selectWebCandidate(input.itemId, input.candidateId),
      ),
    ),

  commitMaterialEnrichmentItem: publicProcedure
    .input(materialEnrichmentItemInput)
    .mutation(({ input }) =>
      withShopJobErrors(() => commitMaterialEnrichmentItem(input.itemId)),
    ),

  bulkCommitMaterialEnrichment: publicProcedure
    .input(bulkCommitMaterialEnrichmentInput)
    .mutation(({ input }) =>
      withShopJobErrors(() => bulkCommitMaterialEnrichment(input)),
    ),

  rejectMaterialEnrichmentItem: publicProcedure
    .input(materialEnrichmentItemInput)
    .mutation(({ input }) =>
      withShopJobErrors(() => rejectMaterialEnrichmentItem(input.itemId)),
    ),

  exportMaterialEnrichmentReport: publicProcedure
    .input(materialEnrichmentJobInput)
    .query(({ input }) =>
      withShopJobErrors(() => exportMaterialEnrichmentReport(input.jobId)),
    ),
});
