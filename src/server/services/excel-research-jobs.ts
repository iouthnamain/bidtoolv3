import { randomUUID } from "node:crypto";

import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";

import type { FillPlanCell } from "~/lib/materials/excel-enrich-fields";
import { env } from "~/env";
import { db } from "~/server/db";
import {
  excelResearchFileArtifacts,
  excelResearchJobRows,
  excelResearchJobs,
  excelResearchRowEvidence,
  materials,
} from "~/server/db/schema";
import {
  bufferToDataUrl,
  readExcelResearchFile,
  saveExcelResearchFile,
} from "~/server/services/excel-research-storage";
import {
  appendChangeLog,
  recomputeJobCounters,
} from "~/server/services/excel-research/db-helpers";
import { processJobBatch } from "~/server/services/excel-research/process-batch";
import {
  DEFAULT_EXCEL_RESEARCH_CONFIG,
  ExcelResearchJobError,
  MAX_EXCEL_RESEARCH_ROWS,
  type ExcelResearchJobConfig,
  type ExcelResearchJobStatus,
  type ExcelResearchRowStatus,
  excelResearchJobConfigSchema,
} from "~/server/services/excel-research/types";
import { extractRowFields } from "~/server/services/excel-enrich";
import {
  parseWorkbookBase64,
  rebuildSheetWithHeaderRow,
  type ColumnMapping,
  type ParsedWorkbook,
} from "~/server/services/excel-workbook";
import { writeEnrichedWorkbook } from "~/server/services/excel-enrich";
import type { FillableField } from "~/lib/materials/excel-enrich-fields";

const activeResearchRuns = new Map<string, AbortController>();

function decodeBase64(workbookBase64: string): Buffer {
  const base64 = workbookBase64.includes(",")
    ? workbookBase64.split(",").pop()!
    : workbookBase64;
  return Buffer.from(base64, "base64");
}

function requireRow<T>(row: T | null | undefined): T {
  if (row == null) {
    throw new ExcelResearchJobError("NOT_FOUND", "Không tìm thấy job.");
  }
  return row;
}

function selectWorkbookSheet(workbook: ParsedWorkbook, sheetName: string) {
  const requestedSheetName = sheetName.trim();
  const sheet = workbook.sheets.find((item) => item.name === requestedSheetName);
  if (!sheet) {
    throw new ExcelResearchJobError(
      "BAD_REQUEST",
      `Không tìm thấy sheet "${requestedSheetName}".`,
    );
  }
  return sheet;
}

function ttlExpiresAt() {
  const days = env.EXCEL_RESEARCH_JOB_TTL_DAYS;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

export async function createJob(input: {
  fileName: string;
  workbookBase64: string;
  sheetName: string;
  headerRowIndex: number;
  mapping: Record<string, string | null>;
  name?: string;
  config?: Partial<ExcelResearchJobConfig>;
}) {
  const config = excelResearchJobConfigSchema.parse({
    ...DEFAULT_EXCEL_RESEARCH_CONFIG,
    ...input.config,
  });

  const workbook = await parseWorkbookBase64(input.fileName, input.workbookBase64);
  const baseSheet = selectWorkbookSheet(workbook, input.sheetName);
  if (!baseSheet) {
    throw new ExcelResearchJobError(
      "BAD_REQUEST",
      "Không tìm thấy trang tính hợp lệ.",
    );
  }

  const sheet = rebuildSheetWithHeaderRow(baseSheet, input.headerRowIndex);
  const rows = extractRowFields(sheet, input.mapping as ColumnMapping);
  if (rows.length === 0) {
    throw new ExcelResearchJobError(
      "BAD_REQUEST",
      "Không có dòng dữ liệu với tên vật tư.",
    );
  }
  if (rows.length > MAX_EXCEL_RESEARCH_ROWS) {
    throw new ExcelResearchJobError(
      "BAD_REQUEST",
      `Tối đa ${MAX_EXCEL_RESEARCH_ROWS} dòng mỗi job.`,
    );
  }

  const jobId = randomUUID();
  const now = new Date().toISOString();
  const buffer = decodeBase64(input.workbookBase64);
  const stored = await saveExcelResearchFile(
    jobId,
    "original",
    input.fileName,
    buffer,
  );

  await db.insert(excelResearchJobs).values({
    id: jobId,
    name: input.name?.trim() ? input.name.trim() : input.fileName,
    status: "draft",
    sourceFileName: input.fileName,
    sheetName: sheet.name,
    headerRowIndex: input.headerRowIndex,
    columnMappingJson: input.mapping,
    configJson: config,
    totalRows: rows.length,
    message: "Đã tải lên — sẵn sàng nghiên cứu.",
    expiresAt: ttlExpiresAt(),
    createdAt: now,
    updatedAt: now,
  });

  const [artifact] = await db
    .insert(excelResearchFileArtifacts)
    .values({
      jobId,
      kind: "original_xlsx",
      localFilePath: stored.localFilePath,
      fileName: stored.fileName,
      fileSize: stored.fileSize,
      mimeType: stored.mimeType,
      checksum: stored.checksum,
    })
    .returning({ id: excelResearchFileArtifacts.id });

  await db.insert(excelResearchJobRows).values(
    rows.map((row) => ({
      jobId,
      rowNumber: row.originalRowIndex,
      status: "pending" as const,
      productName: row.name,
      inputFieldsJson: {
        ...row.fields,
        name: row.name,
      },
      originalCellsJson: {},
    })),
  );

  await appendChangeLog({
    jobId,
    event: "job_created",
    payload: {
      totalRows: rows.length,
      fileName: input.fileName,
      artifactId: artifact?.id,
    },
  });

  return { jobId, totalRows: rows.length, artifactId: artifact?.id ?? null };
}

export async function getJob(jobId: string) {
  const [job] = await db
    .select()
    .from(excelResearchJobs)
    .where(eq(excelResearchJobs.id, jobId))
    .limit(1);
  return job ? toJobSnapshot(job) : null;
}

export async function getJobStatus(jobId: string) {
  const job = await getJob(jobId);
  if (!job) {
    throw new ExcelResearchJobError("NOT_FOUND", "Không tìm thấy job.");
  }
  return {
    status: job.status,
    processedRows: job.processedRows,
    totalRows: job.totalRows,
    matchedRows: job.matchedRows,
    needsReviewRows: job.needsReviewRows,
    errorRows: job.errorRows,
    pdfsFoundCount: job.pdfsFoundCount,
    pdfsGeneratedCount: job.pdfsGeneratedCount,
    message: job.message,
    lastProgressAt: job.lastProgressAt,
    error: job.error,
  };
}

export async function listJobs(limit = 25) {
  const rows = await db
    .select()
    .from(excelResearchJobs)
    .orderBy(desc(excelResearchJobs.updatedAt))
    .limit(limit);
  return rows.map(toJobSnapshot);
}

export async function startJob(jobId: string) {
  const [job] = await db
    .select()
    .from(excelResearchJobs)
    .where(eq(excelResearchJobs.id, jobId))
    .limit(1);
  const row = requireRow(job);

  if (!["draft", "paused", "queued"].includes(row.status)) {
    throw new ExcelResearchJobError(
      "BAD_REQUEST",
      `Không thể chạy job ở trạng thái ${row.status}.`,
    );
  }

  const [activeCount] = await db
    .select({ count: count() })
    .from(excelResearchJobs)
    .where(
      and(
        eq(excelResearchJobs.status, "running"),
        sql`${excelResearchJobs.id} <> ${jobId}`,
      ),
    );
  if ((activeCount?.count ?? 0) >= env.EXCEL_RESEARCH_MAX_CONCURRENT_JOBS) {
    throw new ExcelResearchJobError(
      "CONFLICT",
      `Đã đạt giới hạn ${env.EXCEL_RESEARCH_MAX_CONCURRENT_JOBS} job nghiên cứu chạy đồng thời.`,
    );
  }

  const now = new Date().toISOString();
  await db
    .update(excelResearchJobs)
    .set({
      status: "running",
      startedAt: row.startedAt ?? now,
      message: "Đang nghiên cứu sản phẩm…",
      updatedAt: now,
      lastProgressAt: now,
    })
    .where(eq(excelResearchJobs.id, jobId));

  const controller = new AbortController();
  activeResearchRuns.set(jobId, controller);
  void runResearchLoop(jobId, controller.signal);

  return getJob(jobId);
}

async function runResearchLoop(jobId: string, signal: AbortSignal) {
  try {
    while (!signal.aborted) {
      const job = await getJob(jobId);
      if (job?.status !== "running") break;

      const remaining = await processJobBatch(jobId);
      if (remaining === 0) {
        const now = new Date().toISOString();
        const nextStatus =
          job.needsReviewRows > 0 ? "awaiting_review" : "completed";
        await db
          .update(excelResearchJobs)
          .set({
            status: nextStatus,
            finishedAt: now,
            message:
              nextStatus === "awaiting_review"
                ? "Hoàn tất — còn dòng cần duyệt."
                : "Hoàn tất nghiên cứu.",
            updatedAt: now,
            lastProgressAt: now,
          })
          .where(eq(excelResearchJobs.id, jobId));
        break;
      }
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Lỗi không xác định.";
    await db
      .update(excelResearchJobs)
      .set({
        status: "failed",
        error: message,
        message: "Job thất bại.",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(excelResearchJobs.id, jobId));
  } finally {
    activeResearchRuns.delete(jobId);
  }
}

export async function pauseJob(jobId: string) {
  activeResearchRuns.get(jobId)?.abort();
  const now = new Date().toISOString();
  await db
    .update(excelResearchJobs)
    .set({ status: "paused", message: "Đã tạm dừng.", updatedAt: now })
    .where(eq(excelResearchJobs.id, jobId));
  return getJob(jobId);
}

export async function cancelJob(jobId: string) {
  activeResearchRuns.get(jobId)?.abort();
  const now = new Date().toISOString();
  await db
    .update(excelResearchJobs)
    .set({
      status: "cancelled",
      message: "Đã hủy.",
      finishedAt: now,
      updatedAt: now,
    })
    .where(eq(excelResearchJobs.id, jobId));
  return getJob(jobId);
}

export async function listRowResults(
  jobId: string,
  opts: { status?: ExcelResearchRowStatus; limit?: number; offset?: number } = {},
) {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const conditions = [eq(excelResearchJobRows.jobId, jobId)];
  if (opts.status) {
    conditions.push(eq(excelResearchJobRows.status, opts.status));
  }

  const rows = await db
    .select()
    .from(excelResearchJobRows)
    .where(and(...conditions))
    .orderBy(asc(excelResearchJobRows.rowNumber))
    .limit(limit)
    .offset(offset);

  const [totalRow] = await db
    .select({ count: count() })
    .from(excelResearchJobRows)
    .where(and(...conditions));

  return { items: rows.map(toRowSummary), total: totalRow?.count ?? 0 };
}

export async function getRowResult(jobId: string, rowNumber: number) {
  const [row] = await db
    .select()
    .from(excelResearchJobRows)
    .where(
      and(
        eq(excelResearchJobRows.jobId, jobId),
        eq(excelResearchJobRows.rowNumber, rowNumber),
      ),
    )
    .limit(1);
  if (!row) {
    throw new ExcelResearchJobError("NOT_FOUND", "Không tìm thấy dòng.");
  }

  const evidence = await db
    .select()
    .from(excelResearchRowEvidence)
    .where(eq(excelResearchRowEvidence.jobRowId, row.id));

  return { row, evidence };
}

export async function approveRow(input: {
  jobId: string;
  rowNumber: number;
  materialId?: number;
  acceptedFields?: FillableField[];
}) {
  const [row] = await db
    .select()
    .from(excelResearchJobRows)
    .where(
      and(
        eq(excelResearchJobRows.jobId, input.jobId),
        eq(excelResearchJobRows.rowNumber, input.rowNumber),
      ),
    )
    .limit(1);
  if (!row) {
    throw new ExcelResearchJobError("NOT_FOUND", "Không tìm thấy dòng.");
  }

  const result = row.resultJson ?? {};
  const accepted =
    input.acceptedFields ??
    ((result.accepted_fields as FillableField[] | undefined) ?? []);

  const now = new Date().toISOString();
  await db
    .update(excelResearchJobRows)
    .set({
      status: "approved",
      matchedMaterialId: input.materialId ?? row.matchedMaterialId,
      reviewedAt: now,
      updatedAt: now,
      resultJson: {
        ...result,
        accepted_fields: accepted,
        needs_review: false,
      },
    })
    .where(eq(excelResearchJobRows.id, row.id));

  await recomputeJobCounters(input.jobId);
  await appendChangeLog({
    jobId: input.jobId,
    jobRowId: row.id,
    rowNumber: input.rowNumber,
    event: "row_approved",
    actor: "user",
    payload: { materialId: input.materialId, acceptedFields: accepted },
  });

  return getRowResult(input.jobId, input.rowNumber);
}

export async function rejectRow(input: {
  jobId: string;
  rowNumber: number;
  reason?: string;
}) {
  const [row] = await db
    .select()
    .from(excelResearchJobRows)
    .where(
      and(
        eq(excelResearchJobRows.jobId, input.jobId),
        eq(excelResearchJobRows.rowNumber, input.rowNumber),
      ),
    )
    .limit(1);
  if (!row) {
    throw new ExcelResearchJobError("NOT_FOUND", "Không tìm thấy dòng.");
  }

  const now = new Date().toISOString();
  await db
    .update(excelResearchJobRows)
    .set({
      status: "skipped",
      reviewedAt: now,
      updatedAt: now,
    })
    .where(eq(excelResearchJobRows.id, row.id));

  await recomputeJobCounters(input.jobId);
  await appendChangeLog({
    jobId: input.jobId,
    jobRowId: row.id,
    rowNumber: input.rowNumber,
    event: "row_rejected",
    actor: "user",
    payload: { reason: input.reason },
  });

  return getRowResult(input.jobId, input.rowNumber);
}

export async function exportJobExcel(jobId: string) {
  const job = requireRow(await getJob(jobId));
  const [artifact] = await db
    .select()
    .from(excelResearchFileArtifacts)
    .where(
      and(
        eq(excelResearchFileArtifacts.jobId, jobId),
        eq(excelResearchFileArtifacts.kind, "original_xlsx"),
      ),
    )
    .limit(1);
  if (!artifact) {
    throw new ExcelResearchJobError("NOT_FOUND", "Không tìm thấy file gốc.");
  }

  const exportRows = await db
    .select()
    .from(excelResearchJobRows)
    .where(
      and(
        eq(excelResearchJobRows.jobId, jobId),
        inArray(excelResearchJobRows.status, ["matched", "approved"]),
      ),
    );

  const materialIds = exportRows
    .map((r) => r.matchedMaterialId)
    .filter((id): id is number => id != null);

  const materialRows =
    materialIds.length > 0
      ? await db
          .select()
          .from(materials)
          .where(inArray(materials.id, materialIds))
      : [];

  const materialsById = new Map(materialRows.map((m) => [m.id, m]));
  const originalBuffer = await readExcelResearchFile(artifact.localFilePath);

  const decisions = exportRows
    .map((row) => {
      const result = row.resultJson as { accepted_fields?: FillableField[] };
      const fields = result.accepted_fields ?? [];
      if (!row.matchedMaterialId || fields.length === 0) return null;
      return {
        originalRowIndex: row.rowNumber,
        materialId: row.matchedMaterialId,
        fields,
      };
    })
    .filter((d): d is NonNullable<typeof d> => d != null);

  const enriched = await writeEnrichedWorkbook({
    mode: "preserve",
    workbookBase64: bufferToDataUrl(originalBuffer),
    sheetName: job.sheetName,
    headerRowIndex: job.headerRowIndex,
    mapping: job.columnMappingJson,
    decisions,
    materialsById,
  });

  const stored = await saveExcelResearchFile(
    jobId,
    "enriched",
    job.sourceFileName.replace(/\.xlsx$/i, "") + "-enriched.xlsx",
    enriched,
  );

  await db.insert(excelResearchFileArtifacts).values({
    jobId,
    kind: "enriched_xlsx",
    localFilePath: stored.localFilePath,
    fileName: stored.fileName,
    fileSize: stored.fileSize,
    mimeType: stored.mimeType,
    checksum: stored.checksum,
  });

  await appendChangeLog({
    jobId,
    event: "export_written",
    payload: { fileName: stored.fileName },
  });

  return {
    fileName: stored.fileName,
    workbookBase64: enriched.toString("base64"),
  };
}

function toJobSnapshot(row: typeof excelResearchJobs.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    status: row.status as ExcelResearchJobStatus,
    sourceFileName: row.sourceFileName,
    sheetName: row.sheetName,
    headerRowIndex: row.headerRowIndex,
    columnMappingJson: row.columnMappingJson,
    configJson: row.configJson as ExcelResearchJobConfig,
    totalRows: row.totalRows,
    processedRows: row.processedRows,
    matchedRows: row.matchedRows,
    needsReviewRows: row.needsReviewRows,
    errorRows: row.errorRows,
    pdfsFoundCount: row.pdfsFoundCount,
    pdfsGeneratedCount: row.pdfsGeneratedCount,
    message: row.message,
    error: row.error,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    lastProgressAt: row.lastProgressAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRowSummary(row: typeof excelResearchJobRows.$inferSelect) {
  const result = row.resultJson as {
    needs_review?: boolean;
    review_reason?: string;
  };
  return {
    id: row.id,
    rowNumber: row.rowNumber,
    status: row.status,
    productName: row.productName,
    matchedMaterialId: row.matchedMaterialId,
    confidenceScore: row.confidenceScore
      ? Number(row.confidenceScore)
      : null,
    needsReview: result.needs_review ?? row.status === "needs_review",
    reviewReason: result.review_reason ?? "",
    fillPlan: row.fillPlanJson as FillPlanCell[],
  };
}
