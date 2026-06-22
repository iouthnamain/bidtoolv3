import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { createLogger, traceFn } from "~/server/lib/logger";
const log = createLogger("services-excel-research-db-helpers");
import {
  excelResearchChangeLog,
  excelResearchJobRows,
  excelResearchJobs,
} from "~/server/db/schema";

async function _appendChangeLog(input: {
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

async function _recomputeJobCounters(jobId: string) {
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

export const appendChangeLog = traceFn(log, "appendChangeLog", _appendChangeLog);
export const recomputeJobCounters = traceFn(log, "recomputeJobCounters", _recomputeJobCounters);
