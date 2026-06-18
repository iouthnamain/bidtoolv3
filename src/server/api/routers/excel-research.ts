import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { FILLABLE_FIELDS } from "~/lib/materials/excel-enrich-fields";
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
  approveRow,
  bulkApproveRows,
  cancelJob,
  createJob,
  exportJobExcel,
  getJob,
  getJobStatus,
  getRowResult,
  listJobs,
  listRowResults,
  pauseJob,
  rejectRow,
  startJob,
} from "~/server/services/excel-research-jobs";
import { processJobBatchDetailed } from "~/server/services/excel-research/process-batch";
import {
  ExcelResearchJobError,
  excelResearchJobConfigSchema,
  type ExcelResearchRowStatus,
} from "~/server/services/excel-research/types";
import {
  parseWorkbookBase64,
  rebuildSheetWithHeaderRow,
  type ParsedWorkbook,
} from "~/server/services/excel-workbook";

function selectWorkbookSheet(
  workbook: ParsedWorkbook,
  sheetName: string | undefined,
) {
  const requestedSheetName = sheetName?.trim();
  if (!requestedSheetName) {
    return workbook.sheets[0] ?? null;
  }

  return (
    workbook.sheets.find((item) => item.name === requestedSheetName) ?? null
  );
}

function mapExcelResearchError(error: unknown): never {
  if (error instanceof ExcelResearchJobError) {
    const code =
      error.code === "NOT_FOUND"
        ? "NOT_FOUND"
        : error.code === "CONFLICT"
          ? "CONFLICT"
          : "BAD_REQUEST";
    throw new TRPCError({ code, message: error.message });
  }
  throw error;
}

async function withExcelResearchErrors<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    mapExcelResearchError(error);
  }
}

const jobIdInput = z.object({
  jobId: z.string().uuid(),
});

const rowNumberInput = jobIdInput.extend({
  rowNumber: z.number().int().min(1),
});

export const excelResearchRouter = createTRPCRouter({
  previewUpload: publicProcedure
    .input(
      z.object({
        fileName: z.string().min(1).default("materials.xlsx"),
        workbookBase64: z.string().min(1),
        sheetName: z.string().optional(),
        headerRowIndex: z.number().int().min(1).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const workbook = await parseWorkbookBase64(
        input.fileName,
        input.workbookBase64,
      );
      const selectedSheet = selectWorkbookSheet(workbook, input.sheetName);
      if (!selectedSheet) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Không tìm thấy trang tính hợp lệ.",
        });
      }

      return {
        selectedSheetName: selectedSheet.name,
        warnings: workbook.warnings,
        sheets: workbook.sheets.map((sheet) => {
          const active =
            sheet.name === selectedSheet.name && input.headerRowIndex
              ? rebuildSheetWithHeaderRow(sheet, input.headerRowIndex)
              : sheet;
          return {
            name: active.name,
            detectedHeaderRowIndex: active.detectedHeaderRowIndex,
            activeHeaderRowIndex: active.activeHeaderRowIndex,
            rowCount: active.rows.length,
            headers: active.headers.slice(0, 60),
            suggestedMapping: active.suggestedMapping,
            warnings: active.warnings,
            previewRows: active.previewRows.slice(0, 12).map((values, i) => ({
              key: i,
              values,
            })),
          };
        }),
      };
    }),

  createJob: requirePermission("excelResearch:run")
    .input(
      z.object({
        fileName: z.string().min(1),
        workbookBase64: z.string().min(1),
        sheetName: z.string().min(1),
        headerRowIndex: z.number().int().min(1),
        mapping: z.record(z.string(), z.string().nullable()),
        name: z.string().optional(),
        config: excelResearchJobConfigSchema.partial().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withExcelResearchErrors(() =>
        createJob({ ...input, tenantId: creatorTenantId(ctx) }),
      ),
    ),

  getJob: publicProcedure
    .input(jobIdInput)
    .query(({ ctx, input }) =>
      withExcelResearchErrors(async () => {
        const job = await getJob(input.jobId, tenantScopeValue(ctx));
        if (!job) {
          throw new ExcelResearchJobError("NOT_FOUND", "Không tìm thấy job.");
        }
        return job;
      }),
    ),

  getJobStatus: publicProcedure
    .input(jobIdInput)
    .query(({ ctx, input }) =>
      withExcelResearchErrors(() =>
        getJobStatus(input.jobId, tenantScopeValue(ctx)),
      ),
    ),

  listJobs: publicProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) =>
      withExcelResearchErrors(() =>
        listJobs(input?.limit, tenantScopeValue(ctx)),
      ),
    ),

  startJob: requirePermission("excelResearch:run")
    .input(jobIdInput)
    .mutation(({ ctx, input }) =>
      withExcelResearchErrors(() =>
        startJob(input.jobId, tenantScopeValue(ctx)),
      ),
    ),

  pauseJob: requirePermission("excelResearch:run")
    .input(jobIdInput)
    .mutation(({ ctx, input }) =>
      withExcelResearchErrors(() =>
        pauseJob(input.jobId, tenantScopeValue(ctx)),
      ),
    ),

  cancelJob: requirePermission("excelResearch:run")
    .input(jobIdInput)
    .mutation(({ ctx, input }) =>
      withExcelResearchErrors(() =>
        cancelJob(input.jobId, tenantScopeValue(ctx)),
      ),
    ),

  listRowResults: publicProcedure
    .input(
      jobIdInput.extend({
        status: z
          .enum([
            "pending",
            "processing",
            "matched",
            "needs_review",
            "approved",
            "skipped",
            "error",
          ] as [ExcelResearchRowStatus, ...ExcelResearchRowStatus[]])
          .optional(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
      }),
    )
    .query(({ ctx, input }) =>
      withExcelResearchErrors(() =>
        listRowResults(
          input.jobId,
          {
            status: input.status,
            limit: input.limit,
            offset: input.offset,
          },
          tenantScopeValue(ctx),
        ),
      ),
    ),

  getRowResult: publicProcedure
    .input(rowNumberInput)
    .query(({ ctx, input }) =>
      withExcelResearchErrors(() =>
        getRowResult(input.jobId, input.rowNumber, tenantScopeValue(ctx)),
      ),
    ),

  approveRow: requirePermission("excelResearch:run")
    .input(
      rowNumberInput.extend({
        materialId: z.number().int().positive().optional(),
        acceptedFields: z.array(z.enum(FILLABLE_FIELDS)).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withExcelResearchErrors(() =>
        approveRow({
          jobId: input.jobId,
          rowNumber: input.rowNumber,
          materialId: input.materialId,
          acceptedFields: input.acceptedFields,
          scope: tenantScopeValue(ctx),
        }),
      ),
    ),

  bulkApproveRows: requirePermission("excelResearch:run")
    .input(
      jobIdInput.extend({
        rowIds: z.array(z.string()).optional(),
        minConfidence: z.number().min(0).max(1).optional(),
        onlyStatus: z.array(z.string()).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withExcelResearchErrors(() =>
        bulkApproveRows({
          jobId: input.jobId,
          rowIds: input.rowIds,
          minConfidence: input.minConfidence,
          onlyStatus: input.onlyStatus,
          scope: tenantScopeValue(ctx),
        }),
      ),
    ),

  rejectRow: requirePermission("excelResearch:run")
    .input(
      rowNumberInput.extend({
        reason: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withExcelResearchErrors(() =>
        rejectRow({
          jobId: input.jobId,
          rowNumber: input.rowNumber,
          reason: input.reason,
          scope: tenantScopeValue(ctx),
        }),
      ),
    ),

  exportExcel: publicProcedure
    .input(jobIdInput)
    .mutation(({ ctx, input }) =>
      withExcelResearchErrors(() =>
        exportJobExcel(input.jobId, tenantScopeValue(ctx)),
      ),
    ),

  processBatch: requirePermission("excelResearch:run")
    .input(
      jobIdInput.extend({
        batchId: z.string().uuid().optional(),
      }),
    )
    .mutation(({ input }) =>
      withExcelResearchErrors(async () => {
        void input.batchId;
        return processJobBatchDetailed(input.jobId);
      }),
    ),
});
