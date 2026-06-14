/**
 * Client-side mirrors of `excelResearch` tRPC shapes. Replace with
 * `RouterOutputs` once the router is registered in `appRouter`.
 */

export type ExcelResearchJobStatus =
  | "draft"
  | "queued"
  | "running"
  | "paused"
  | "awaiting_review"
  | "exporting"
  | "completed"
  | "failed"
  | "cancelled";

export type ExcelResearchRowStatus =
  | "pending"
  | "processing"
  | "matched"
  | "needs_review"
  | "approved"
  | "skipped"
  | "error";

export type ExcelResearchPreviewSheet = {
  name: string;
  rowCount: number;
  activeHeaderRowIndex: number;
  suggestedMapping: Record<string, string | null>;
  headers: string[];
};

export type ExcelResearchPreview = {
  sheets: ExcelResearchPreviewSheet[];
  selectedSheetName: string;
};

export type ExcelResearchJobStatusResponse = {
  status: ExcelResearchJobStatus;
  processedRows: number;
  totalRows: number;
  matchedRows: number;
  needsReviewRows: number;
  errorRows: number;
  message: string | null;
  error: string | null;
};

export type ExcelResearchFillPlanCell = {
  field: string;
  before: string;
  after: string;
  action: "filled" | "kept" | "overwritten" | "skipped";
};

export type ExcelResearchRowSummary = {
  id: number;
  rowNumber: number;
  status: ExcelResearchRowStatus;
  productName: string;
  matchedMaterialId: number | null;
  confidenceScore: number | null;
  needsReview: boolean;
  reviewReason: string;
  fillPlan: ExcelResearchFillPlanCell[];
};

export type ExcelResearchListRowsResult = {
  items: ExcelResearchRowSummary[];
  total: number;
};

export type ExcelResearchRowEvidence = {
  id: number;
  evidenceType: string;
  provider: string;
  title: string | null;
  url: string | null;
  snippet: string | null;
  query: string | null;
};

export const ACTIVE_JOB_STATUSES: ExcelResearchJobStatus[] = [
  "queued",
  "running",
];

export const REVIEW_READY_JOB_STATUSES: ExcelResearchJobStatus[] = [
  "awaiting_review",
  "completed",
];

export function isExcelResearchJobActive(
  job: { status: ExcelResearchJobStatus } | null | undefined,
) {
  return job != null && ACTIVE_JOB_STATUSES.includes(job.status);
}

export function isExcelResearchJobReviewReady(
  job: { status: ExcelResearchJobStatus } | null | undefined,
) {
  return job != null && REVIEW_READY_JOB_STATUSES.includes(job.status);
}
