import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import {
  excelResearchChangeLog,
  excelResearchJobRows,
  excelResearchJobs,
} from "~/server/db/schema";

export async function appendChangeLog(input: {
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

export async function recomputeJobCounters(jobId: string) {
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
