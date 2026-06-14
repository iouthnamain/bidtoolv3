import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { env } from "~/env";
import { db } from "~/server/db";
import {
  excelResearchChangeLog,
  excelResearchJobRows,
  excelResearchJobs,
  excelResearchRowEvidence,
} from "~/server/db/schema";
import { processSingleRow } from "~/server/services/excel-research/row-research";
import {
  DEFAULT_EXCEL_RESEARCH_CONFIG,
  excelResearchJobConfigSchema,
  type ExcelResearchJobConfig,
} from "~/server/services/excel-research/types";

type ClaimedRow = typeof excelResearchJobRows.$inferSelect;

async function appendChangeLog(input: {
  jobId: string;
  jobRowId?: number;
  rowNumber?: number;
  event: string;
  actor?: string;
  field?: string;
  before?: string;
  after?: string;
  action?: string;
  payload?: Record<string, unknown>;
}) {
  await db.insert(excelResearchChangeLog).values({
    jobId: input.jobId,
    jobRowId: input.jobRowId,
    rowNumber: input.rowNumber,
    event: input.event,
    actor: input.actor ?? "system",
    field: input.field,
    before: input.before,
    after: input.after,
    action: input.action,
    payloadJson: input.payload ?? {},
  });
}

async function recomputeJobCounters(jobId: string) {
  const rows = await db
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

  await db
    .update(excelResearchJobs)
    .set({
      processedRows: processed,
      matchedRows: matched,
      needsReviewRows: needsReview,
      errorRows: errors,
      updatedAt: new Date().toISOString(),
      lastProgressAt: new Date().toISOString(),
    })
    .where(eq(excelResearchJobs.id, jobId));
}

export type ProcessBatchResult = {
  batchId: string;
  processed: number;
  remaining: number;
};

async function countPendingRows(jobId: string) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(excelResearchJobRows)
    .where(
      and(
        eq(excelResearchJobRows.jobId, jobId),
        eq(excelResearchJobRows.status, "pending"),
      ),
    );
  return row?.count ?? 0;
}

function resolveConfig(jobConfig: unknown): ExcelResearchJobConfig {
  return excelResearchJobConfigSchema.parse({
    ...DEFAULT_EXCEL_RESEARCH_CONFIG,
    ...(jobConfig && typeof jobConfig === "object" && !Array.isArray(jobConfig)
      ? jobConfig
      : {}),
  });
}

async function claimPendingRows(jobId: string, batchSize: number) {
  return db.transaction(async (tx) => {
    const pending = await tx
      .select()
      .from(excelResearchJobRows)
      .where(
        and(
          eq(excelResearchJobRows.jobId, jobId),
          eq(excelResearchJobRows.status, "pending"),
        ),
      )
      .orderBy(asc(excelResearchJobRows.rowNumber))
      .limit(batchSize)
      .for("update", { skipLocked: true });

    if (pending.length === 0) {
      return [];
    }

    const token = randomUUID();
    const now = new Date().toISOString();

    await tx
      .update(excelResearchJobRows)
      .set({
        status: "processing",
        processingToken: token,
        processingStartedAt: now,
        attemptCount: sql`${excelResearchJobRows.attemptCount} + 1`,
        updatedAt: now,
      })
      .where(
        inArray(
          excelResearchJobRows.id,
          pending.map((row) => row.id),
        ),
      );

    return pending;
  });
}

async function persistRowResult(
  jobId: string,
  row: ClaimedRow,
  config: ExcelResearchJobConfig,
  batchId: string,
) {
  const inputFields = row.inputFieldsJson ?? {};
  const productName =
    (typeof inputFields.name === "string" && inputFields.name.trim()) ||
    row.productName;

  const fields = { ...inputFields };
  delete fields.name;

  const output = await processSingleRow(
    db,
    {
      rowNumber: row.rowNumber,
      productName,
      fields,
    },
    config,
  );

  const now = new Date().toISOString();
  const actor = `batch:${batchId}`;

  await db
    .delete(excelResearchRowEvidence)
    .where(eq(excelResearchRowEvidence.jobRowId, row.id));

  const evidenceRows: Array<typeof excelResearchRowEvidence.$inferInsert> = [];

  for (const catalog of output.catalogEvidence.slice(0, config.candidateLimit)) {
    evidenceRows.push({
      jobRowId: row.id,
      evidenceType: "catalog_match",
      provider: "pg_trgm",
      query: productName,
      title: catalog.title,
      url: catalog.url || `material://${catalog.materialId}`,
      domain: "catalog",
      snippet: "",
      materialId: catalog.materialId,
      confidenceScore: Math.round(catalog.score * 100),
      matchReasonsJson: catalog.breakdown ?? [],
      isSelected: catalog.materialId === output.matchedMaterialId,
      fetchedAt: now,
    });
  }

  for (const web of output.webEvidence.slice(0, 6)) {
    evidenceRows.push({
      jobRowId: row.id,
      evidenceType: "web_search",
      provider: "searxng",
      query: productName,
      title: web.title,
      url: web.url,
      domain: web.domain,
      snippet: web.snippet,
      confidenceScore: Math.round(web.rankScore),
      matchReasonsJson: [web.sourceTier],
      isSelected:
        output.matchedMaterialId == null &&
        output.webEvidence[0]?.url === web.url,
      fetchedAt: now,
    });
  }

  if (evidenceRows.length > 0) {
    await db.insert(excelResearchRowEvidence).values(evidenceRows);
  }

  const excelUpdates = output.fillPlan
    .filter((cell) => cell.action === "filled")
    .map((cell) => ({
      field: cell.field,
      before: cell.before,
      after: cell.after,
      action: cell.action,
    }));

  await db
    .update(excelResearchJobRows)
    .set({
      status: output.rowStatus,
      matchedMaterialId: output.matchedMaterialId,
      confidenceScore: output.confidenceScore.toFixed(3),
      fillPlanJson: output.fillPlan,
      excelUpdatesJson: excelUpdates,
      resultJson: output.result,
      errorMessage:
        output.rowStatus === "error" ? output.result.review_reason : null,
      processingToken: null,
      processingStartedAt: null,
      updatedAt: now,
    })
    .where(eq(excelResearchJobRows.id, row.id));

  if (output.matchedMaterialId != null) {
    await appendChangeLog({
      jobId,
      jobRowId: row.id,
      rowNumber: row.rowNumber,
      event: "row_matched",
      actor,
      payload: {
        materialId: output.matchedMaterialId,
        score: output.confidenceScore,
        status: output.rowStatus,
      },
    });
  }

  for (const cell of output.fillPlan) {
    if (cell.action !== "filled") continue;
    await appendChangeLog({
      jobId,
      jobRowId: row.id,
      rowNumber: row.rowNumber,
      event: "cell_updated",
      actor,
      field: cell.field,
      before: cell.before,
      after: cell.after,
      action: cell.action,
      payload: { materialId: output.matchedMaterialId },
    });
  }

  if (output.rowStatus === "error") {
    await appendChangeLog({
      jobId,
      jobRowId: row.id,
      rowNumber: row.rowNumber,
      event: "row_error",
      actor,
      payload: { message: output.result.review_reason },
    });
  }
}

/**
 * Claim up to one batch of pending rows, run catalog + web research, persist
 * evidence and change log. Returns the number of rows still pending.
 */
export async function processJobBatch(jobId: string): Promise<number> {
  const [job] = await db
    .select()
    .from(excelResearchJobs)
    .where(eq(excelResearchJobs.id, jobId))
    .limit(1);

  if (job?.status !== "running") {
    return countPendingRows(jobId);
  }

  const config = resolveConfig(job.configJson);
  const batchSize = Math.min(
    config.batchSize,
    env.EXCEL_RESEARCH_BATCH_SIZE,
  );
  const batchId = randomUUID();
  const claimed = await claimPendingRows(jobId, batchSize);

  await db
    .update(excelResearchJobs)
    .set({
      currentBatchId: batchId,
      lastProgressAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(excelResearchJobs.id, jobId));

  for (const row of claimed) {
    try {
      await persistRowResult(jobId, row, config, batchId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Lỗi xử lý dòng.";
      const now = new Date().toISOString();
      await db
        .update(excelResearchJobRows)
        .set({
          status: "error",
          errorMessage: message,
          processingToken: null,
          processingStartedAt: null,
          updatedAt: now,
        })
        .where(eq(excelResearchJobRows.id, row.id));
      await appendChangeLog({
        jobId,
        jobRowId: row.id,
        rowNumber: row.rowNumber,
        event: "row_error",
        actor: `batch:${batchId}`,
        payload: { message },
      });
    }
  }

  if (claimed.length > 0) {
    await recomputeJobCounters(jobId);
  }

  return countPendingRows(jobId);
}

export async function processJobBatchDetailed(
  jobId: string,
): Promise<ProcessBatchResult> {
  const batchId = randomUUID();
  const remainingBefore = await countPendingRows(jobId);
  const remaining = await processJobBatch(jobId);
  return {
    batchId,
    processed: Math.max(0, remainingBefore - remaining),
    remaining,
  };
}

export async function resetStaleExcelResearchRows() {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  await db
    .update(excelResearchJobRows)
    .set({
      status: "pending",
      processingToken: null,
      processingStartedAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(excelResearchJobRows.status, "processing"),
        sql`${excelResearchJobRows.processingStartedAt} < ${cutoff}`,
      ),
    );
}
