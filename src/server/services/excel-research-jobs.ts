import { randomUUID } from "node:crypto";

import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "~/server/db";
import {
  tenantConditionForValue,
  type TenantScopeValue,
} from "~/server/api/tenant-scope";
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
  resolveExcelResearchJobTtlDays,
  resolveExcelResearchMaxConcurrentJobs,
} from "~/server/services/app-settings";
import {
  parseWorkbookBase64,
  rebuildSheetWithHeaderRow,
  type ColumnMapping,
  type ParsedWorkbook,
} from "~/server/services/excel-workbook";
import { writeEnrichedWorkbook } from "~/server/services/excel-enrich";
import type { FillableField } from "~/lib/materials/excel-enrich-fields";
import { createLogger, traceFn } from "~/server/lib/logger";
const log = createLogger("services-excel-research-jobs");

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

async function ttlExpiresAt() {
  const days = await resolveExcelResearchJobTtlDays();
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

async function _createJob(input: {
  fileName: string;
  workbookBase64: string;
  sheetName: string;
  headerRowIndex: number;
  mapping: Record<string, string | null>;
  rowNumbers?: number[];
  name?: string;
  config?: Partial<ExcelResearchJobConfig>;
  // Tenant attribution for the created job (creator's tenant; null for internal
  // users). Threaded down from the router so the row is correctly owned.
  tenantId?: string | null;
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
  const requestedRows =
    input.rowNumbers && input.rowNumbers.length > 0
      ? new Set(input.rowNumbers)
      : null;
  const rows = extractRowFields(sheet, input.mapping as ColumnMapping).filter(
    (row) => !requestedRows || requestedRows.has(row.originalRowIndex),
  );
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
    expiresAt: await ttlExpiresAt(),
    tenantId: input.tenantId ?? null,
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

async function _getJob(jobId: string, scope?: TenantScopeValue) {
  const [job] = await db
    .select()
    .from(excelResearchJobs)
    .where(
      and(
        eq(excelResearchJobs.id, jobId),
        tenantConditionForValue(scope, excelResearchJobs.tenantId),
      ),
    )
    .limit(1);
  return job ? toJobSnapshot(job) : null;
}

/**
 * Fail-closed guard: throw NOT_FOUND if the job is not within the caller's
 * tenant scope. Used by row-level and mutation functions to ensure a customer
 * can never touch another tenant's job (or its child rows/evidence).
 */
async function _assertJobInScope(jobId: string, scope: TenantScopeValue) {
  const job = await getJob(jobId, scope);
  if (!job) {
    throw new ExcelResearchJobError("NOT_FOUND", "Không tìm thấy job.");
  }
  return job;
}

async function _getJobStatus(jobId: string, scope?: TenantScopeValue) {
  const job = await getJob(jobId, scope);
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

async function _listJobs(limit = 25, scope?: TenantScopeValue) {
  const rows = await db
    .select()
    .from(excelResearchJobs)
    .where(tenantConditionForValue(scope, excelResearchJobs.tenantId))
    .orderBy(desc(excelResearchJobs.updatedAt))
    .limit(limit);
  return rows.map(toJobSnapshot);
}

async function _startJob(jobId: string, scope?: TenantScopeValue) {
  await assertJobInScope(jobId, scope);
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
  const maxConcurrent = await resolveExcelResearchMaxConcurrentJobs();
  if ((activeCount?.count ?? 0) >= maxConcurrent) {
    throw new ExcelResearchJobError(
      "CONFLICT",
      `Đã đạt giới hạn ${maxConcurrent} job nghiên cứu chạy đồng thời.`,
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

  // The job scheduler (started on boot) claims any row with status="running"
  // within ~1s and drives the batch loop. It is the sole, durable processor —
  // no in-process loop is spawned here.
  return getJob(jobId);
}

async function _pauseJob(jobId: string, scope?: TenantScopeValue) {
  await assertJobInScope(jobId, scope);
  const now = new Date().toISOString();
  await db
    .update(excelResearchJobs)
    .set({ status: "paused", message: "Đã tạm dừng.", updatedAt: now })
    .where(eq(excelResearchJobs.id, jobId));
  return getJob(jobId);
}

async function _cancelJob(jobId: string, scope?: TenantScopeValue) {
  await assertJobInScope(jobId, scope);
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

/**
 * Resume a job that ended in `failed` or `cancelled`. Completed work is kept:
 * only the rows that never finished (`error`, plus rows left stuck in
 * `processing` when the run aborted mid-batch) are requeued to `pending`, the
 * job's failure state is cleared back to `draft`, and the normal `startJob`
 * path takes over. The batch processor only ever claims `pending` rows, so
 * already `matched`/`approved`/`needs_review`/`skipped` rows are untouched.
 */
async function _restartJob(jobId: string, scope?: TenantScopeValue) {
  await assertJobInScope(jobId, scope);
  const [job] = await db
    .select()
    .from(excelResearchJobs)
    .where(eq(excelResearchJobs.id, jobId))
    .limit(1);
  const row = requireRow(job);

  if (!["failed", "cancelled"].includes(row.status)) {
    throw new ExcelResearchJobError(
      "BAD_REQUEST",
      `Chỉ có thể chạy lại job đã lỗi hoặc đã hủy (hiện tại: ${row.status}).`,
    );
  }

  const now = new Date().toISOString();
  // Requeue rows that never reached a terminal-good state + reset the job, then
  // recompute the job counters from the post-requeue row statuses — all in one
  // transaction so the job is never observed with stale counters. Rows stuck in
  // `processing` belong to a batch that was aborted, so reset them too and clear
  // their processing lease.
  await db.transaction(async (tx) => {
    await tx
      .update(excelResearchJobRows)
      .set({
        status: "pending",
        processingToken: null,
        processingStartedAt: null,
        errorMessage: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(excelResearchJobRows.jobId, jobId),
          inArray(excelResearchJobRows.status, ["error", "processing"]),
        ),
      );

    // Clear the job's failure state so startJob accepts it.
    await tx
      .update(excelResearchJobs)
      .set({
        status: "draft",
        error: null,
        finishedAt: null,
        message: "Chuẩn bị chạy lại…",
        updatedAt: now,
      })
      .where(eq(excelResearchJobs.id, jobId));

    // Recompute counters from the actual (post-requeue) row statuses so they are
    // correct immediately — requeued rows now count toward neither processed nor
    // error; surviving terminal-good rows are preserved.
    const rows = await tx
      .select({ status: excelResearchJobRows.status })
      .from(excelResearchJobRows)
      .where(eq(excelResearchJobRows.jobId, jobId));

    const terminal = new Set([
      "matched",
      "needs_review",
      "approved",
      "skipped",
      "error",
    ]);
    const processed = rows.filter((r) => terminal.has(r.status)).length;
    const matched = rows.filter(
      (r) => r.status === "matched" || r.status === "approved",
    ).length;
    const needsReview = rows.filter((r) => r.status === "needs_review").length;
    const errors = rows.filter((r) => r.status === "error").length;

    await tx
      .update(excelResearchJobs)
      .set({
        processedRows: processed,
        matchedRows: matched,
        needsReviewRows: needsReview,
        errorRows: errors,
        updatedAt: now,
        lastProgressAt: now,
      })
      .where(eq(excelResearchJobs.id, jobId));
  });

  // startJob does its own status update + maxConcurrent guard. If it throws
  // (e.g. CONFLICT), the job is still a valid draft with correct counters.
  return startJob(jobId, scope);
}

async function _listRowResults(
  jobId: string,
  opts: { status?: ExcelResearchRowStatus; limit?: number; offset?: number } = {},
  scope?: TenantScopeValue,
) {
  // Confirm the parent job is in-tenant before returning its rows; the rows
  // table has no tenantId column, so it is scoped via the parent.
  await assertJobInScope(jobId, scope);
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

  // Per-status counts across ALL rows of the job (ignoring the status filter
  // and pagination) so the review UI can render stable filter-chip counts.
  // Deriving these from the filtered/paginated `rows` above would collapse
  // them to 0 (or the filtered subtotal) whenever a status filter is active.
  const statusCountRows = await db
    .select({
      status: excelResearchJobRows.status,
      count: count(),
    })
    .from(excelResearchJobRows)
    .where(eq(excelResearchJobRows.jobId, jobId))
    .groupBy(excelResearchJobRows.status);

  const statusCounts: Record<ExcelResearchRowStatus, number> = {
    pending: 0,
    processing: 0,
    matched: 0,
    needs_review: 0,
    approved: 0,
    skipped: 0,
    error: 0,
  };
  let totalRows = 0;
  for (const entry of statusCountRows) {
    const status = entry.status as ExcelResearchRowStatus;
    if (status in statusCounts) statusCounts[status] = entry.count;
    totalRows += entry.count;
  }

  return {
    items: rows.map(toRowSummary),
    total: totalRow?.count ?? 0,
    totalRows,
    statusCounts,
  };
}

async function _getRowResult(
  jobId: string,
  rowNumber: number,
  scope?: TenantScopeValue,
) {
  await assertJobInScope(jobId, scope);
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

  const result = (row.resultJson ?? {}) as {
    matched_fields?: Partial<Record<FillableField, string>>;
    accepted_fields?: FillableField[];
    overwrite_fields?: FillableField[];
    edited_fields?: Partial<Record<FillableField, string>>;
  };

  // Derived compare block so the review UI gets a step-2-style side-by-side
  // (sheet values vs. found values) plus the persisted per-field decision,
  // without reverse-engineering it from resultJson on the client.
  const compare = {
    sheetFields: (row.inputFieldsJson ?? {}) as Partial<
      Record<FillableField, string>
    >,
    foundFields: result.matched_fields ?? {},
    acceptedFields: result.accepted_fields ?? [],
    overwriteFields: result.overwrite_fields ?? [],
    editedFields: result.edited_fields ?? {},
    matchedMaterialId: row.matchedMaterialId,
  };

  return { row, evidence, compare };
}

async function _approveRow(input: {
  jobId: string;
  rowNumber: number;
  materialId?: number;
  acceptedFields?: FillableField[];
  overwriteFields?: FillableField[];
  editedValues?: Partial<Record<FillableField, string>>;
  scope?: TenantScopeValue;
}) {
  await assertJobInScope(input.jobId, input.scope);
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
  const overwrite =
    input.overwriteFields ??
    ((result.overwrite_fields as FillableField[] | undefined) ?? []);
  const edited =
    input.editedValues ??
    ((result.edited_fields as
      | Partial<Record<FillableField, string>>
      | undefined) ?? {});

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
        overwrite_fields: overwrite,
        edited_fields: edited,
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

const BULK_APPROVABLE_STATUSES: ExcelResearchRowStatus[] = [
  "needs_review",
  "matched",
];

async function _bulkApproveRows(input: {
  jobId: string;
  rowIds?: string[];
  minConfidence?: number;
  onlyStatus?: string[];
  scope?: TenantScopeValue;
}) {
  await assertJobInScope(input.jobId, input.scope);
  // Resolve which rows to approve: either an explicit id list, or all rows in
  // an approvable state (optionally narrowed by status / confidence).
  const explicitIds = (input.rowIds ?? [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id));

  const conditions = [eq(excelResearchJobRows.jobId, input.jobId)];
  if (explicitIds.length > 0) {
    conditions.push(inArray(excelResearchJobRows.id, explicitIds));
  } else {
    const statuses = (
      input.onlyStatus && input.onlyStatus.length > 0
        ? input.onlyStatus
        : BULK_APPROVABLE_STATUSES
    ) as ExcelResearchRowStatus[];
    conditions.push(inArray(excelResearchJobRows.status, statuses));
  }

  const candidateRows = await db
    .select()
    .from(excelResearchJobRows)
    .where(and(...conditions));

  const now = new Date().toISOString();
  let approved = 0;
  let failed = 0;

  for (const row of candidateRows) {
    // When approving by explicit id we still skip rows that are not in an
    // approvable state to avoid re-approving skipped/error rows by accident.
    if (
      explicitIds.length > 0 &&
      !BULK_APPROVABLE_STATUSES.includes(row.status as ExcelResearchRowStatus)
    ) {
      continue;
    }

    if (input.minConfidence != null) {
      const score = row.confidenceScore != null ? Number(row.confidenceScore) : null;
      if (score == null || score < input.minConfidence) {
        continue;
      }
    }

    const result = row.resultJson ?? {};
    const accepted =
      (result.accepted_fields as FillableField[] | undefined) ?? [];

    try {
      await db
        .update(excelResearchJobRows)
        .set({
          status: "approved",
          reviewedAt: now,
          updatedAt: now,
          resultJson: {
            ...result,
            accepted_fields: accepted,
            needs_review: false,
          },
        })
        .where(eq(excelResearchJobRows.id, row.id));

      await appendChangeLog({
        jobId: input.jobId,
        jobRowId: row.id,
        rowNumber: row.rowNumber,
        event: "row_approved",
        actor: "user",
        payload: { bulk: true, acceptedFields: accepted },
      });
      approved += 1;
    } catch {
      failed += 1;
    }
  }

  // Recompute counters once at the end rather than per row.
  await recomputeJobCounters(input.jobId);

  return { approved, failed };
}

async function _rejectRow(input: {
  jobId: string;
  rowNumber: number;
  reason?: string;
  scope?: TenantScopeValue;
}) {
  await assertJobInScope(input.jobId, input.scope);
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

async function _exportJobExcel(jobId: string, scope?: TenantScopeValue) {
  const job = requireRow(await getJob(jobId, scope));
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
      const result = row.resultJson as {
        accepted_fields?: FillableField[];
        overwrite_fields?: FillableField[];
        matched_fields?: Partial<Record<FillableField, string>>;
        edited_fields?: Partial<Record<FillableField, string>>;
      };
      const fields = result.accepted_fields ?? [];
      if (fields.length === 0) return null;
      // Found (web/catalog) values plus any inline edits become value
      // overrides, so web-only rows (no catalog match) still export and edited
      // values win over the matched material. Edits take precedence.
      const valueOverrides: Partial<Record<FillableField, string>> = {
        ...(result.matched_fields ?? {}),
        ...(result.edited_fields ?? {}),
      };
      // Drop the web-only-row guard: a row with no catalog match can still
      // export as long as its accepted fields are covered by overrides.
      if (!row.matchedMaterialId) {
        const covered = fields.every(
          (f) => (valueOverrides[f] ?? "").trim().length > 0,
        );
        if (!covered) return null;
      }
      return {
        originalRowIndex: row.rowNumber,
        materialId: row.matchedMaterialId,
        fields,
        overwriteFields: result.overwrite_fields ?? [],
        valueOverrides,
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
    confidenceScore: row.confidenceScore != null
      ? Number(row.confidenceScore)
      : null,
    needsReview: result.needs_review ?? row.status === "needs_review",
    reviewReason: result.review_reason ?? "",
    // `fillPlan` is intentionally NOT included: it is heavy (before→after per
    // field) and the list can return up to 200 rows. The compare UI fetches the
    // full plan per selected row via getRowResult instead.
    hasMatch: row.matchedMaterialId != null,
  };
}

export const createJob = traceFn(log, "createJob", _createJob);
export const getJob = traceFn(log, "getJob", _getJob);
export const assertJobInScope = traceFn(log, "assertJobInScope", _assertJobInScope);
export const getJobStatus = traceFn(log, "getJobStatus", _getJobStatus);
export const listJobs = traceFn(log, "listJobs", _listJobs);
export const startJob = traceFn(log, "startJob", _startJob);
export const pauseJob = traceFn(log, "pauseJob", _pauseJob);
export const cancelJob = traceFn(log, "cancelJob", _cancelJob);
export const restartJob = traceFn(log, "restartJob", _restartJob);
export const listRowResults = traceFn(log, "listRowResults", _listRowResults);
export const getRowResult = traceFn(log, "getRowResult", _getRowResult);
export const approveRow = traceFn(log, "approveRow", _approveRow);
export const bulkApproveRows = traceFn(log, "bulkApproveRows", _bulkApproveRows);
export const rejectRow = traceFn(log, "rejectRow", _rejectRow);
export const exportJobExcel = traceFn(log, "exportJobExcel", _exportJobExcel);
