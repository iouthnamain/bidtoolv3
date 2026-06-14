import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { FILLABLE_FIELDS } from "~/lib/materials/excel-enrich-fields";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import {
  approveRow,
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

  createJob: publicProcedure
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
    .mutation(({ input }) =>
      withExcelResearchErrors(() => createJob(input)),
    ),

  getJob: publicProcedure
    .input(jobIdInput)
    .query(({ input }) =>
      withExcelResearchErrors(async () => {
        const job = await getJob(input.jobId);
        if (!job) {
          throw new ExcelResearchJobError("NOT_FOUND", "Không tìm thấy job.");
        }
        return job;
      }),
    ),

  getJobStatus: publicProcedure
    .input(jobIdInput)
    .query(({ input }) =>
      withExcelResearchErrors(() => getJobStatus(input.jobId)),
    ),

  listJobs: publicProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).optional(),
        })
        .optional(),
    )
    .query(({ input }) =>
      withExcelResearchErrors(() => listJobs(input?.limit)),
    ),

  startJob: publicProcedure
    .input(jobIdInput)
    .mutation(({ input }) =>
      withExcelResearchErrors(() => startJob(input.jobId)),
    ),

  pauseJob: publicProcedure
    .input(jobIdInput)
    .mutation(({ input }) =>
      withExcelResearchErrors(() => pauseJob(input.jobId)),
    ),

  cancelJob: publicProcedure
    .input(jobIdInput)
    .mutation(({ input }) =>
      withExcelResearchErrors(() => cancelJob(input.jobId)),
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
    .query(({ input }) =>
      withExcelResearchErrors(() =>
        listRowResults(input.jobId, {
          status: input.status,
          limit: input.limit,
          offset: input.offset,
        }),
      ),
    ),

  getRowResult: publicProcedure
    .input(rowNumberInput)
    .query(({ input }) =>
      withExcelResearchErrors(() =>
        getRowResult(input.jobId, input.rowNumber),
      ),
    ),

  approveRow: publicProcedure
    .input(
      rowNumberInput.extend({
        materialId: z.number().int().positive().optional(),
        acceptedFields: z.array(z.enum(FILLABLE_FIELDS)).optional(),
      }),
    )
    .mutation(({ input }) =>
      withExcelResearchErrors(() =>
        approveRow({
          jobId: input.jobId,
          rowNumber: input.rowNumber,
          materialId: input.materialId,
          acceptedFields: input.acceptedFields,
        }),
      ),
    ),

  rejectRow: publicProcedure
    .input(
      rowNumberInput.extend({
        reason: z.string().optional(),
      }),
    )
    .mutation(({ input }) =>
      withExcelResearchErrors(() =>
        rejectRow({
          jobId: input.jobId,
          rowNumber: input.rowNumber,
          reason: input.reason,
        }),
      ),
    ),

  exportExcel: publicProcedure
    .input(jobIdInput)
    .mutation(({ input }) =>
      withExcelResearchErrors(() => exportJobExcel(input.jobId)),
    ),

  processBatch: publicProcedure
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
