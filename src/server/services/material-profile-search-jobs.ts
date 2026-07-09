import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, ne, sql, type SQL } from "drizzle-orm";

import type {
  AiSearchStoredResult,
  WebLinkResult,
} from "~/lib/materials/enrich-gap-fill";
import { searchResultDecisionForRow } from "~/lib/materials/profile-review-bulk-apply";
import {
  deriveMatchStatus,
  deserializeRowDecision,
  serializeRowDecision,
  type WebSearchStatus,
} from "~/lib/materials/review-decision";
import {
  RELIABLE_SEARCH_MATCH_THRESHOLD,
  scoreAiCandidateCompletion,
  webLinkMatchChips,
} from "~/lib/materials/search-candidate-match";
import {
  snapshotStatusFromItem,
  topCandidateMaterialIdFromItem,
  workspaceItemToReviewRow,
} from "~/lib/materials/workspace-review-row";
import { db } from "~/server/db";
import {
  excelWorkspaceItems,
  excelWorkspaces,
  materialProfileSearchJobs,
  materialProfileSearchRuns,
} from "~/server/db/schema";
import type { EnrichWebRowInput } from "~/server/services/enrich-web-row";
import { runWithConcurrency } from "~/server/services/concurrency";
import {
  extractProfileRowAiCandidates,
  searchProfileRowWebLinks,
} from "~/server/services/enrich-profile-row-search";
import { abortMaterialProfileSearchJob } from "~/server/services/job-scheduler";
import { createLogger, traceFn } from "~/server/lib/logger";

const log = createLogger("services-material-profile-search-jobs");

export type MaterialProfileSearchMode = "web" | "ai";
export type MaterialProfileSearchJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";
export type MaterialProfileSearchRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "skipped"
  | "cancelled";

export type MaterialProfileSearchRunSnapshot = {
  id: number;
  jobId: string;
  workspaceId: number;
  itemId: number;
  originalRowIndex: number;
  sortOrder: number;
  mode: MaterialProfileSearchMode;
  status: MaterialProfileSearchRunStatus;
  isCurrent: boolean;
  sourceWebRunId: number | null;
  inputSnapshot: Record<string, unknown>;
  queries: string[];
  webLinksStatus: WebSearchStatus;
  aiSearchStatus: WebSearchStatus;
  webLinkResults: WebLinkResult[];
  aiSearchCandidates: AiSearchStoredResult[];
  recommendedCandidateKey: string | null;
  warnings: string[];
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MaterialProfileSearchJobSnapshot = {
  id: string;
  workspaceId: number;
  status: MaterialProfileSearchJobStatus;
  mode: MaterialProfileSearchMode;
  requestedItemIds: number[];
  total: number;
  processed: number;
  found: number;
  partial: number;
  failed: number;
  skipped: number;
  currentItemId: number | null;
  currentRowIndex: number | null;
  currentProductName: string | null;
  message: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastProgressAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MaterialProfileSearchJobProgress = Pick<
  MaterialProfileSearchJobSnapshot,
  | "processed"
  | "total"
  | "found"
  | "partial"
  | "failed"
  | "skipped"
  | "currentItemId"
  | "currentRowIndex"
  | "currentProductName"
  | "message"
>;

export class MaterialProfileSearchJobError extends Error {
  constructor(
    public readonly code: "BAD_REQUEST" | "CONFLICT" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "MaterialProfileSearchJobError";
  }
}

type JobRow = typeof materialProfileSearchJobs.$inferSelect;
type RunRow = typeof materialProfileSearchRuns.$inferSelect;
type WorkspaceItemRow = typeof excelWorkspaceItems.$inferSelect;
type JobCounterDelta = {
  processed: number;
  found: number;
  partial: number;
  failed: number;
  skipped: number;
};

const MAX_JOB_ITEMS = 500;
const ROW_CONCURRENCY = 3;
const MAX_STORED_TEXT_LENGTH = 4_000;
const ACTIVE_JOB_STATUSES: MaterialProfileSearchJobStatus[] = [
  "queued",
  "running",
];
const DONE_RUN_STATUSES = new Set<MaterialProfileSearchRunStatus>([
  "completed",
  "partial",
  "failed",
  "skipped",
  "cancelled",
]);

function isMode(value: string): value is MaterialProfileSearchMode {
  return value === "web" || value === "ai";
}

function toMode(value: string): MaterialProfileSearchMode {
  return isMode(value) ? value : "web";
}

function isJobStatus(value: string): value is MaterialProfileSearchJobStatus {
  return (
    value === "queued" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  );
}

function toJobStatus(value: string): MaterialProfileSearchJobStatus {
  return isJobStatus(value) ? value : "failed";
}

function isRunStatus(value: string): value is MaterialProfileSearchRunStatus {
  return (
    value === "queued" ||
    value === "running" ||
    value === "completed" ||
    value === "partial" ||
    value === "failed" ||
    value === "skipped" ||
    value === "cancelled"
  );
}

function toRunStatus(value: string): MaterialProfileSearchRunStatus {
  return isRunStatus(value) ? value : "failed";
}

function toSearchStatus(value: string): WebSearchStatus {
  if (
    value === "idle" ||
    value === "pending" ||
    value === "done" ||
    value === "error"
  ) {
    return value;
  }
  return "idle";
}

function parseNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is number => typeof item === "number" && Number.isFinite(item),
  );
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function sanitizeStoredText(value: string, maxLength = MAX_STORED_TEXT_LENGTH) {
  return value
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .slice(0, maxLength);
}

function sanitizeStoredJson(value: unknown): unknown {
  if (typeof value === "string") return sanitizeStoredText(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean" || value == null) return value;
  if (Array.isArray(value)) return value.map(sanitizeStoredJson);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        sanitizeStoredJson(entry),
      ]),
    );
  }
  return null;
}

function parseRunDecision(row: RunRow) {
  return deserializeRowDecision({
    materialId: null,
    acceptedFields: [],
    webLinkResults: row.webLinkResultsJson,
    webLinksStatus: row.webLinksStatus,
    aiSearchCandidates: row.aiSearchCandidatesJson,
    aiSearchStatus: row.aiSearchStatus,
    selectedSearchCandidateKey: row.recommendedCandidateKey ?? undefined,
    selectedSource:
      row.recommendedCandidateKey?.startsWith("ai:") === true
        ? "ai"
        : undefined,
  });
}

function toRunSnapshot(row: RunRow): MaterialProfileSearchRunSnapshot {
  const decision = parseRunDecision(row);
  return {
    id: row.id,
    jobId: row.jobId,
    workspaceId: row.workspaceId,
    itemId: row.itemId,
    originalRowIndex: row.originalRowIndex,
    sortOrder: row.sortOrder,
    mode: toMode(row.mode),
    status: toRunStatus(row.status),
    isCurrent: row.isCurrent,
    sourceWebRunId: row.sourceWebRunId,
    inputSnapshot: asRecord(row.inputSnapshotJson),
    queries: parseStringArray(row.queriesJson),
    webLinksStatus: toSearchStatus(row.webLinksStatus),
    aiSearchStatus: toSearchStatus(row.aiSearchStatus),
    webLinkResults: decision?.webLinkResults ?? [],
    aiSearchCandidates: decision?.aiSearchCandidates ?? [],
    recommendedCandidateKey: row.recommendedCandidateKey,
    warnings: parseStringArray(row.warningsJson),
    errorMessage: row.errorMessage,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toJobSnapshot(row: JobRow): MaterialProfileSearchJobSnapshot {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    status: toJobStatus(row.status),
    mode: toMode(row.mode),
    requestedItemIds: parseNumberArray(row.requestedItemIds),
    total: row.total,
    processed: row.processed,
    found: row.found,
    partial: row.partial,
    failed: row.failed,
    skipped: row.skipped,
    currentItemId: row.currentItemId,
    currentRowIndex: row.currentRowIndex,
    currentProductName: row.currentProductName,
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

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new Error("Job tìm kiếm hồ sơ vật tư đã bị hủy.");
  }
}

function textField(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function inputFromWorkspaceItem(item: WorkspaceItemRow): EnrichWebRowInput {
  const original = asRecord(item.originalDataJson);
  return {
    name: item.productName,
    code: textField(original.code),
    manufacturer: textField(original.manufacturer) || (item.vendorHint ?? ""),
    specText: textField(original.specText) || item.specText,
    unit: textField(original.unit) || item.unit,
    category: textField(original.category),
    originCountry: textField(original.originCountry) || (item.originHint ?? ""),
  };
}

function inputSnapshot(item: WorkspaceItemRow): Record<string, unknown> {
  const input = inputFromWorkspaceItem(item);
  return {
    ...input,
    itemId: item.id,
    workspaceId: item.workspaceId,
    originalRowIndex: item.originalRowIndex,
  };
}

function inputFromSnapshot(
  snapshot: Record<string, unknown>,
): EnrichWebRowInput {
  const sheetFields = sheetFieldsFromSnapshot(snapshot);
  return {
    name: textField(snapshot.name),
    code: sheetFields.code,
    manufacturer: sheetFields.manufacturer,
    specText: sheetFields.specText,
    unit: sheetFields.unit,
    category: sheetFields.category,
    originCountry: sheetFields.originCountry,
  };
}

function sheetFieldsFromSnapshot(snapshot: Record<string, unknown>) {
  return {
    code: textField(snapshot.code),
    manufacturer: textField(snapshot.manufacturer),
    unit: textField(snapshot.unit),
    category: textField(snapshot.category),
    specText: textField(snapshot.specText),
    originCountry: textField(snapshot.originCountry),
  };
}

function runHasReliableResult(
  run: Pick<
    RunRow,
    | "inputSnapshotJson"
    | "webLinkResultsJson"
    | "aiSearchCandidatesJson"
    | "recommendedCandidateKey"
  >,
) {
  if (run.recommendedCandidateKey) return true;

  const snapshot = asRecord(run.inputSnapshotJson);
  const rowName = textField(snapshot.name);
  const sheetFields = sheetFieldsFromSnapshot(snapshot);
  const decision = parseRunDecision(run as RunRow);

  const webReliable = (decision?.webLinkResults ?? []).some(
    (link) =>
      webLinkMatchChips(link, rowName, sheetFields).score >=
      RELIABLE_SEARCH_MATCH_THRESHOLD,
  );
  if (webReliable) return true;

  return (decision?.aiSearchCandidates ?? []).some(
    (candidate) =>
      scoreAiCandidateCompletion(candidate, sheetFields, rowName) >=
      RELIABLE_SEARCH_MATCH_THRESHOLD,
  );
}

function zeroJobCounterDelta(): JobCounterDelta {
  return { processed: 0, found: 0, partial: 0, failed: 0, skipped: 0 };
}

function deltaForRunResult(input: {
  run: RunRow;
  status: MaterialProfileSearchRunStatus;
  webLinkResults: WebLinkResult[];
  aiSearchCandidates: AiSearchStoredResult[];
  recommendedCandidateKey?: string;
}): JobCounterDelta {
  const delta = zeroJobCounterDelta();
  if (DONE_RUN_STATUSES.has(input.status)) delta.processed = 1;
  if (input.status === "partial") delta.partial = 1;
  if (input.status === "failed") delta.failed = 1;
  if (input.status === "skipped") delta.skipped = 1;
  if (
    runHasReliableResult({
      inputSnapshotJson: input.run.inputSnapshotJson,
      webLinkResultsJson: input.webLinkResults as unknown as Record<
        string,
        unknown
      >[],
      aiSearchCandidatesJson: input.aiSearchCandidates as unknown as Record<
        string,
        unknown
      >[],
      recommendedCandidateKey: input.recommendedCandidateKey ?? null,
    })
  ) {
    delta.found = 1;
  }
  return delta;
}

async function markRunCurrent(runId: number, itemId: number) {
  await db.transaction(async (tx) => {
    await tx
      .update(materialProfileSearchRuns)
      .set({ isCurrent: false, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(materialProfileSearchRuns.itemId, itemId),
          ne(materialProfileSearchRuns.id, runId),
        ),
      );
    await tx
      .update(materialProfileSearchRuns)
      .set({ isCurrent: true, updatedAt: new Date().toISOString() })
      .where(eq(materialProfileSearchRuns.id, runId));
  });
}

async function loadCurrentRunForItem(itemId: number) {
  const [row] = await db
    .select()
    .from(materialProfileSearchRuns)
    .where(
      and(
        eq(materialProfileSearchRuns.itemId, itemId),
        eq(materialProfileSearchRuns.isCurrent, true),
      ),
    )
    .orderBy(desc(materialProfileSearchRuns.updatedAt))
    .limit(1);
  return row ?? null;
}

async function getJobRow(jobId: string) {
  const [job] = await db
    .select()
    .from(materialProfileSearchJobs)
    .where(eq(materialProfileSearchJobs.id, jobId))
    .limit(1);
  return job ?? null;
}

async function refreshJobCounters(jobId: string) {
  const runs = await db
    .select({
      status: materialProfileSearchRuns.status,
      inputSnapshotJson: materialProfileSearchRuns.inputSnapshotJson,
      webLinkResultsJson: materialProfileSearchRuns.webLinkResultsJson,
      aiSearchCandidatesJson: materialProfileSearchRuns.aiSearchCandidatesJson,
      recommendedCandidateKey:
        materialProfileSearchRuns.recommendedCandidateKey,
    })
    .from(materialProfileSearchRuns)
    .where(eq(materialProfileSearchRuns.jobId, jobId));

  let processed = 0;
  let found = 0;
  let partial = 0;
  let failed = 0;
  let skipped = 0;

  for (const run of runs) {
    const status = toRunStatus(run.status);
    if (DONE_RUN_STATUSES.has(status)) processed += 1;
    if (status === "partial") partial += 1;
    if (status === "failed") failed += 1;
    if (status === "skipped") skipped += 1;
    if (runHasReliableResult(run as RunRow)) {
      found += 1;
    }
  }

  const now = new Date().toISOString();
  await db
    .update(materialProfileSearchJobs)
    .set({
      processed,
      found,
      partial,
      failed,
      skipped,
      lastProgressAt: now,
      updatedAt: now,
    })
    .where(eq(materialProfileSearchJobs.id, jobId));
}

async function incrementJobCounters(jobId: string, delta: JobCounterDelta) {
  const now = new Date().toISOString();
  await db
    .update(materialProfileSearchJobs)
    .set({
      processed: sql<number>`${materialProfileSearchJobs.processed} + ${delta.processed}`,
      found: sql<number>`${materialProfileSearchJobs.found} + ${delta.found}`,
      partial: sql<number>`${materialProfileSearchJobs.partial} + ${delta.partial}`,
      failed: sql<number>`${materialProfileSearchJobs.failed} + ${delta.failed}`,
      skipped: sql<number>`${materialProfileSearchJobs.skipped} + ${delta.skipped}`,
      lastProgressAt: now,
      updatedAt: now,
    })
    .where(eq(materialProfileSearchJobs.id, jobId));
}

async function loadJobProgress(
  jobId: string,
): Promise<MaterialProfileSearchJobProgress> {
  const job = await getJobRow(jobId);
  return {
    processed: job?.processed ?? 0,
    total: job?.total ?? 0,
    found: job?.found ?? 0,
    partial: job?.partial ?? 0,
    failed: job?.failed ?? 0,
    skipped: job?.skipped ?? 0,
    currentItemId: job?.currentItemId ?? null,
    currentRowIndex: job?.currentRowIndex ?? null,
    currentProductName: job?.currentProductName ?? null,
    message: job?.message ?? null,
  };
}

async function _startMaterialProfileSearchJob(input: {
  workspaceId: number;
  itemIds: number[];
  mode: MaterialProfileSearchMode;
}) {
  const itemIds = [
    ...new Set(input.itemIds.map((id) => Math.trunc(id))),
  ].filter((id) => id > 0);
  if (itemIds.length === 0) {
    throw new MaterialProfileSearchJobError(
      "BAD_REQUEST",
      "Chọn ít nhất một dòng để tìm kiếm.",
    );
  }
  if (itemIds.length > MAX_JOB_ITEMS) {
    throw new MaterialProfileSearchJobError(
      "BAD_REQUEST",
      `Tối đa ${MAX_JOB_ITEMS} dòng mỗi job tìm kiếm.`,
    );
  }

  const [workspace] = await db
    .select({ id: excelWorkspaces.id })
    .from(excelWorkspaces)
    .where(eq(excelWorkspaces.id, input.workspaceId))
    .limit(1);
  if (!workspace) {
    throw new MaterialProfileSearchJobError(
      "NOT_FOUND",
      "Không tìm thấy hồ sơ vật tư.",
    );
  }

  const [active] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(materialProfileSearchJobs)
    .where(
      and(
        eq(materialProfileSearchJobs.workspaceId, input.workspaceId),
        inArray(materialProfileSearchJobs.status, ACTIVE_JOB_STATUSES),
      ),
    );
  if ((active?.count ?? 0) > 0) {
    throw new MaterialProfileSearchJobError(
      "CONFLICT",
      "Hồ sơ này đang có job tìm kiếm. Chờ job xong hoặc hủy job trước.",
    );
  }

  const items = await db
    .select()
    .from(excelWorkspaceItems)
    .where(
      and(
        eq(excelWorkspaceItems.workspaceId, input.workspaceId),
        inArray(excelWorkspaceItems.id, itemIds),
      ),
    )
    .orderBy(asc(excelWorkspaceItems.sortOrder));
  if (items.length === 0) {
    throw new MaterialProfileSearchJobError(
      "BAD_REQUEST",
      "Không có dòng hợp lệ để tìm kiếm.",
    );
  }

  const now = new Date().toISOString();
  const jobId = randomUUID();
  const job = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(materialProfileSearchJobs)
      .values({
        id: jobId,
        workspaceId: input.workspaceId,
        status: "queued",
        mode: input.mode,
        requestedItemIds: items.map((item) => item.id),
        total: items.length,
        message:
          input.mode === "web"
            ? "Đang xếp hàng tìm web."
            : "Đang xếp hàng tìm AI.",
        startedAt: now,
        lastProgressAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await tx.insert(materialProfileSearchRuns).values(
      items.map((item, index) => ({
        jobId,
        workspaceId: item.workspaceId,
        itemId: item.id,
        originalRowIndex: item.originalRowIndex,
        sortOrder: index,
        mode: input.mode,
        status: "queued",
        inputSnapshotJson: inputSnapshot(item),
        createdAt: now,
        updatedAt: now,
      })),
    );

    return created;
  });

  return toJobSnapshot(job!);
}

async function _getMaterialProfileSearchJob(jobId: string) {
  const job = await getJobRow(jobId);
  return job ? toJobSnapshot(job) : null;
}

async function _listMaterialProfileSearchJobs(input: {
  workspaceId: number;
  limit?: number;
}) {
  const rows = await db
    .select()
    .from(materialProfileSearchJobs)
    .where(eq(materialProfileSearchJobs.workspaceId, input.workspaceId))
    .orderBy(desc(materialProfileSearchJobs.updatedAt))
    .limit(Math.min(Math.max(input.limit ?? 10, 1), 50));
  return rows.map(toJobSnapshot);
}

async function _listMaterialProfileSearchRuns(input: {
  workspaceId?: number;
  jobId?: string;
  itemId?: number;
  limit?: number;
}) {
  const conditions: SQL[] = [];
  if (input.workspaceId != null) {
    conditions.push(
      eq(materialProfileSearchRuns.workspaceId, input.workspaceId),
    );
  }
  if (input.jobId) {
    conditions.push(eq(materialProfileSearchRuns.jobId, input.jobId));
  }
  if (input.itemId != null) {
    conditions.push(eq(materialProfileSearchRuns.itemId, input.itemId));
  }
  if (conditions.length === 0) {
    throw new MaterialProfileSearchJobError(
      "BAD_REQUEST",
      "Thiếu điều kiện lọc lịch sử tìm kiếm.",
    );
  }

  const rows = await db
    .select()
    .from(materialProfileSearchRuns)
    .where(and(...conditions))
    .orderBy(desc(materialProfileSearchRuns.updatedAt))
    .limit(Math.min(Math.max(input.limit ?? 10, 1), MAX_JOB_ITEMS));
  return rows.map(toRunSnapshot);
}

async function _cancelMaterialProfileSearchJob(jobId: string) {
  const job = await getJobRow(jobId);
  if (!job) {
    throw new MaterialProfileSearchJobError(
      "NOT_FOUND",
      "Không tìm thấy job tìm kiếm.",
    );
  }
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx
      .update(materialProfileSearchJobs)
      .set({
        status: "cancelled",
        currentItemId: null,
        currentRowIndex: null,
        currentProductName: null,
        message: "Đã hủy job tìm kiếm.",
        finishedAt: now,
        lastProgressAt: now,
        updatedAt: now,
      })
      .where(eq(materialProfileSearchJobs.id, jobId));
    await tx
      .update(materialProfileSearchRuns)
      .set({
        status: "cancelled",
        errorMessage: "Đã hủy.",
        finishedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(materialProfileSearchRuns.jobId, jobId),
          inArray(materialProfileSearchRuns.status, ["queued", "running"]),
        ),
      );
  });
  abortMaterialProfileSearchJob(jobId);
  return getMaterialProfileSearchJob(jobId);
}

async function _setCurrentMaterialProfileSearchRun(runId: number) {
  const [run] = await db
    .select()
    .from(materialProfileSearchRuns)
    .where(eq(materialProfileSearchRuns.id, runId))
    .limit(1);
  if (!run) {
    throw new MaterialProfileSearchJobError(
      "NOT_FOUND",
      "Không tìm thấy lần tìm kiếm.",
    );
  }
  if (
    run.status === "queued" ||
    run.status === "running" ||
    run.status === "cancelled"
  ) {
    throw new MaterialProfileSearchJobError(
      "BAD_REQUEST",
      "Chỉ có thể dùng lại lần tìm kiếm đã kết thúc.",
    );
  }

  await markRunCurrent(run.id, run.itemId);
  const [updated] = await db
    .select()
    .from(materialProfileSearchRuns)
    .where(eq(materialProfileSearchRuns.id, run.id))
    .limit(1);
  return toRunSnapshot(updated ?? run);
}

async function updateRunWithResult(input: {
  run: RunRow;
  status: MaterialProfileSearchRunStatus;
  webLinksStatus: WebSearchStatus;
  aiSearchStatus: WebSearchStatus;
  webLinkResults: WebLinkResult[];
  aiSearchCandidates: AiSearchStoredResult[];
  queries: string[];
  recommendedCandidateKey?: string;
  warnings: string[];
  errorMessage?: string | null;
  sourceWebRunId?: number | null;
}): Promise<JobCounterDelta> {
  const now = new Date().toISOString();
  const webLinkResults = sanitizeStoredJson(
    input.webLinkResults,
  ) as WebLinkResult[];
  const aiSearchCandidates = sanitizeStoredJson(
    input.aiSearchCandidates,
  ) as AiSearchStoredResult[];
  const queries = input.queries.map((query) => sanitizeStoredText(query, 500));
  const warnings = input.warnings.map((warning) =>
    sanitizeStoredText(warning, 1_000),
  );
  const errorMessage =
    input.errorMessage == null
      ? null
      : sanitizeStoredText(input.errorMessage, 1_000);

  await db
    .update(materialProfileSearchRuns)
    .set({
      status: input.status,
      sourceWebRunId: input.sourceWebRunId ?? input.run.sourceWebRunId,
      queriesJson: queries,
      webLinksStatus: input.webLinksStatus,
      aiSearchStatus: input.aiSearchStatus,
      webLinkResultsJson: webLinkResults as unknown as Record<
        string,
        unknown
      >[],
      aiSearchCandidatesJson: aiSearchCandidates as unknown as Record<
        string,
        unknown
      >[],
      recommendedCandidateKey: input.recommendedCandidateKey ?? null,
      warningsJson: warnings,
      errorMessage,
      finishedAt: now,
      updatedAt: now,
    })
    .where(eq(materialProfileSearchRuns.id, input.run.id));

  if (input.status !== "cancelled" && input.status !== "skipped") {
    await markRunCurrent(input.run.id, input.run.itemId);
  }

  return deltaForRunResult({
    run: input.run,
    status: input.status,
    webLinkResults,
    aiSearchCandidates,
    recommendedCandidateKey: input.recommendedCandidateKey,
  });
}

async function processRun(job: JobRow, run: RunRow, signal?: AbortSignal) {
  throwIfAborted(signal);
  const now = new Date().toISOString();
  const input = inputFromSnapshot(asRecord(run.inputSnapshotJson));

  await db
    .update(materialProfileSearchJobs)
    .set({
      currentItemId: run.itemId,
      currentRowIndex: run.originalRowIndex,
      currentProductName: input.name || null,
      message:
        job.mode === "web"
          ? "Đang tìm liên kết web."
          : "Đang trích xuất AI từ nguồn web.",
      lastProgressAt: now,
      updatedAt: now,
    })
    .where(eq(materialProfileSearchJobs.id, job.id));

  await db
    .update(materialProfileSearchRuns)
    .set({ status: "running", startedAt: now, updatedAt: now })
    .where(eq(materialProfileSearchRuns.id, run.id));

  if (!input.name.trim()) {
    return updateRunWithResult({
      run,
      status: "skipped",
      webLinksStatus: "idle",
      aiSearchStatus: "idle",
      webLinkResults: [],
      aiSearchCandidates: [],
      queries: [],
      warnings: ["Tên vật tư trống."],
      errorMessage: "Tên vật tư trống.",
    });
  }

  try {
    if (job.mode === "web") {
      const web = await searchProfileRowWebLinks(input, signal);
      const status: MaterialProfileSearchRunStatus =
        web.webLinkResults.length > 0 ? "completed" : "failed";
      return updateRunWithResult({
        run,
        status,
        webLinksStatus: web.webLinkResults.length > 0 ? "done" : "error",
        aiSearchStatus: "idle",
        webLinkResults: web.webLinkResults,
        aiSearchCandidates: [],
        queries: web.queries,
        warnings: web.warnings,
        errorMessage:
          status === "failed"
            ? (web.warnings.find((warning) => warning.trim()) ??
              "Không tìm thấy liên kết web.")
            : null,
      });
    }

    const currentRun = await loadCurrentRunForItem(run.itemId);
    const currentDecision = currentRun ? parseRunDecision(currentRun) : null;
    let webLinkResults = currentDecision?.webLinkResults ?? [];
    let queries = parseStringArray(currentRun?.queriesJson);
    const warnings: string[] = [];
    const sourceWebRunId: number | null =
      webLinkResults.length > 0 ? (currentRun?.id ?? null) : null;

    if (webLinkResults.length === 0) {
      const web = await searchProfileRowWebLinks(input, signal);
      webLinkResults = web.webLinkResults;
      queries = web.queries;
      warnings.push(...web.warnings);
    }

    if (webLinkResults.length === 0) {
      return updateRunWithResult({
        run,
        status: "failed",
        webLinksStatus: "error",
        aiSearchStatus: "error",
        webLinkResults,
        aiSearchCandidates: [],
        queries,
        warnings,
        errorMessage:
          warnings.find((warning) => warning.trim()) ??
          "Không có nguồn web để trích xuất AI.",
        sourceWebRunId,
      });
    }

    try {
      const ai = await extractProfileRowAiCandidates(
        input,
        webLinkResults,
        signal,
      );
      warnings.push(...ai.warnings);
      const hasCandidates = ai.aiSearchCandidates.length > 0;
      return updateRunWithResult({
        run,
        status: hasCandidates ? "completed" : "partial",
        webLinksStatus: "done",
        aiSearchStatus: hasCandidates ? "done" : "error",
        webLinkResults,
        aiSearchCandidates: ai.aiSearchCandidates,
        queries,
        recommendedCandidateKey: ai.recommendedCandidateKey,
        warnings,
        errorMessage: hasCandidates
          ? null
          : "AI không trích xuất được ứng viên nào.",
        sourceWebRunId,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Không cấu hình AI enrichment.";
      warnings.push(message);
      return updateRunWithResult({
        run,
        status: "partial",
        webLinksStatus: "done",
        aiSearchStatus: "error",
        webLinkResults,
        aiSearchCandidates: [],
        queries,
        warnings,
        errorMessage: message,
        sourceWebRunId,
      });
    }
  } catch (error) {
    if (
      signal?.aborted === true ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      await db
        .update(materialProfileSearchRuns)
        .set({
          status: "cancelled",
          errorMessage: "Đã hủy.",
          finishedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(materialProfileSearchRuns.id, run.id));
      throw error;
    }

    const message =
      error instanceof Error
        ? error.message
        : "Tìm kiếm hồ sơ vật tư thất bại.";
    return updateRunWithResult({
      run,
      status: "failed",
      webLinksStatus: "error",
      aiSearchStatus: job.mode === "ai" ? "error" : "idle",
      webLinkResults: [],
      aiSearchCandidates: [],
      queries: [],
      warnings: [message],
      errorMessage: message,
    });
  }
}

async function _processMaterialProfileSearchJob(
  jobId: string,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: MaterialProfileSearchJobProgress) => void;
  } = {},
) {
  const signal = options.signal;
  throwIfAborted(signal);
  const job = await getJobRow(jobId);
  if (!job) {
    throw new Error("Không tìm thấy job tìm kiếm hồ sơ vật tư.");
  }

  const now = new Date().toISOString();
  await db
    .update(materialProfileSearchJobs)
    .set({
      status: "running",
      message:
        job.mode === "web"
          ? "Đang tìm web cho hồ sơ vật tư."
          : "Đang tìm AI cho hồ sơ vật tư.",
      lastProgressAt: now,
      updatedAt: now,
    })
    .where(eq(materialProfileSearchJobs.id, jobId));

  options.onProgress?.(await loadJobProgress(jobId));

  const pendingRuns = await db
    .select()
    .from(materialProfileSearchRuns)
    .where(
      and(
        eq(materialProfileSearchRuns.jobId, jobId),
        inArray(materialProfileSearchRuns.status, ["queued", "running"]),
      ),
    )
    .orderBy(asc(materialProfileSearchRuns.sortOrder));

  await runWithConcurrency(pendingRuns, ROW_CONCURRENCY, async (run) => {
    throwIfAborted(signal);
    const [currentJob] = await db
      .select({ status: materialProfileSearchJobs.status })
      .from(materialProfileSearchJobs)
      .where(eq(materialProfileSearchJobs.id, jobId))
      .limit(1);
    if (currentJob?.status === "cancelled") {
      throw new Error("Job tìm kiếm đã bị hủy.");
    }

    const delta = await processRun(job, run, signal);
    await incrementJobCounters(jobId, delta);
    options.onProgress?.(await loadJobProgress(jobId));
  });
}

/**
 * After a reliable search run completes, merge into reviewDecisionJson without
 * blocking the UI. Uses searchResultDecisionForRow + RELIABLE_SEARCH_MATCH_THRESHOLD.
 */
async function autoApplyReliableSearchRunToItem(run: RunRow) {
  if (
    !shouldAttemptAutoApplyReliableSearchRun({
      status: run.status,
      hasReliableResult: runHasReliableResult(run),
    })
  ) {
    return false;
  }

  const [item] = await db
    .select()
    .from(excelWorkspaceItems)
    .where(eq(excelWorkspaceItems.id, run.itemId))
    .limit(1);
  if (!item) return false;

  const runDecision = parseRunDecision(run);
  if (!runDecision) return false;

  const existing = deserializeRowDecision(item.reviewDecisionJson);
  // Do not overwrite an already-exportable user/catalog decision.
  if (
    existing &&
    existing.acceptedFields.size > 0 &&
    (existing.materialId != null ||
      existing.selectedSource === "catalog" ||
      existing.selectedSource === "ai" ||
      existing.selectedSource === "web")
  ) {
    if (
      shouldSkipAutoApplyOverwrite({
        hasExistingExportableDecision: true,
      })
    ) {
      // Still refresh search candidate payloads onto the stored decision.
      const mergedSearch = {
        ...existing,
        webLinkResults: runDecision.webLinkResults ?? existing.webLinkResults,
        webLinksStatus: runDecision.webLinksStatus ?? existing.webLinksStatus,
        aiSearchCandidates:
          runDecision.aiSearchCandidates ?? existing.aiSearchCandidates,
        aiSearchResult: runDecision.aiSearchResult ?? existing.aiSearchResult,
        aiSearchStatus: runDecision.aiSearchStatus ?? existing.aiSearchStatus,
        catalogPdfUrls: existing.catalogPdfUrls ?? runDecision.catalogPdfUrls,
      };
      await db
        .update(excelWorkspaceItems)
        .set({
          reviewDecisionJson: serializeRowDecision(mergedSearch),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(excelWorkspaceItems.id, item.id));
      return false;
    }
  }

  const reviewRow = workspaceItemToReviewRow(item);
  const decisionWithSearch = {
    materialId: existing?.materialId ?? item.materialId,
    acceptedFields: existing?.acceptedFields ?? new Set(),
    overwriteFields: existing?.overwriteFields ?? new Set(),
    editedValues: existing?.editedValues,
    webProposedFields: existing?.webProposedFields,
    webEvidence: existing?.webEvidence,
    webSearchStatus: existing?.webSearchStatus,
    webLinkResults: runDecision.webLinkResults,
    webLinksStatus: runDecision.webLinksStatus,
    aiSearchResult: runDecision.aiSearchResult,
    aiSearchCandidates: runDecision.aiSearchCandidates,
    aiSearchStatus: runDecision.aiSearchStatus,
    selectedSource: existing?.selectedSource,
    selectedSearchCandidateKey:
      existing?.selectedSearchCandidateKey ??
      run.recommendedCandidateKey ??
      undefined,
    catalogPdfUrls:
      existing?.catalogPdfUrls ?? runDecision.catalogPdfUrls,
    skipped: existing?.skipped,
  };

  const applied = searchResultDecisionForRow(
    reviewRow,
    decisionWithSearch,
    RELIABLE_SEARCH_MATCH_THRESHOLD,
  );
  if (!applied) {
    // Persist search payloads even when below auto-apply threshold.
    await db
      .update(excelWorkspaceItems)
      .set({
        reviewDecisionJson: serializeRowDecision(decisionWithSearch),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(excelWorkspaceItems.id, item.id));
    return false;
  }

  const snapshotStatus = snapshotStatusFromItem(item);
  const topCandidateMaterialId = topCandidateMaterialIdFromItem(item);
  const matchStatus = deriveMatchStatus(
    applied,
    snapshotStatus,
    topCandidateMaterialId,
  );
  const now = new Date().toISOString();
  await db
    .update(excelWorkspaceItems)
    .set({
      reviewDecisionJson: serializeRowDecision(applied),
      materialId: applied.materialId ?? item.materialId,
      matchStatus,
      updatedAt: now,
    })
    .where(eq(excelWorkspaceItems.id, item.id));
  return true;
}

async function autoApplyReliableSearchResultsForJob(jobId: string) {
  const runs = await db
    .select()
    .from(materialProfileSearchRuns)
    .where(
      and(
        eq(materialProfileSearchRuns.jobId, jobId),
        eq(materialProfileSearchRuns.isCurrent, true),
      ),
    );
  let applied = 0;
  for (const run of runs) {
    try {
      if (await autoApplyReliableSearchRunToItem(run)) {
        applied += 1;
      }
    } catch (error) {
      log.warn("auto_apply_search_run_failed", {
        jobId,
        runId: run.id,
        itemId: run.itemId,
        error,
      });
    }
  }
  return applied;
}

/** Exported for unit tests / manual re-apply after job completion. */
export async function autoApplyReliableMaterialProfileSearchResults(
  jobId: string,
) {
  return autoApplyReliableSearchResultsForJob(jobId);
}

async function _completeMaterialProfileSearchJob(jobId: string) {
  await refreshJobCounters(jobId);
  const now = new Date().toISOString();
  const job = await getJobRow(jobId);
  if (!job || job.status === "cancelled") {
    return;
  }

  let autoApplied = 0;
  try {
    autoApplied = await autoApplyReliableSearchResultsForJob(jobId);
  } catch (error) {
    log.warn("auto_apply_on_complete_failed", { jobId, error });
  }

  await db
    .update(materialProfileSearchJobs)
    .set({
      status: "completed",
      currentItemId: null,
      currentRowIndex: null,
      currentProductName: null,
      message:
        autoApplied > 0
          ? `Job tìm kiếm hoàn tất. Đã tự điền ${autoApplied.toLocaleString("vi-VN")} dòng đáng tin cậy.`
          : "Job tìm kiếm hồ sơ vật tư đã hoàn tất.",
      error: null,
      finishedAt: now,
      lastProgressAt: now,
      updatedAt: now,
    })
    .where(eq(materialProfileSearchJobs.id, jobId));
}

async function _failMaterialProfileSearchJob(jobId: string, error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : "Job tìm kiếm hồ sơ vật tư thất bại.";
  const now = new Date().toISOString();
  await db
    .update(materialProfileSearchJobs)
    .set({
      status: "failed",
      currentItemId: null,
      currentRowIndex: null,
      currentProductName: null,
      message,
      error: message,
      finishedAt: now,
      lastProgressAt: now,
      updatedAt: now,
    })
    .where(eq(materialProfileSearchJobs.id, jobId));
}

export const startMaterialProfileSearchJob = traceFn(
  log,
  "startMaterialProfileSearchJob",
  _startMaterialProfileSearchJob,
);
export const getMaterialProfileSearchJob = traceFn(
  log,
  "getMaterialProfileSearchJob",
  _getMaterialProfileSearchJob,
);
export const listMaterialProfileSearchJobs = traceFn(
  log,
  "listMaterialProfileSearchJobs",
  _listMaterialProfileSearchJobs,
);
export const listMaterialProfileSearchRuns = traceFn(
  log,
  "listMaterialProfileSearchRuns",
  _listMaterialProfileSearchRuns,
);
export const cancelMaterialProfileSearchJob = traceFn(
  log,
  "cancelMaterialProfileSearchJob",
  _cancelMaterialProfileSearchJob,
);

/**
 * Cancel every queued/running search job for a workspace before rematch
 * deletes excel_workspace_items (runs cascade on item_id).
 */
async function _cancelActiveMaterialProfileSearchJobsForWorkspace(
  workspaceId: number,
) {
  const activeJobs = await db
    .select({ id: materialProfileSearchJobs.id })
    .from(materialProfileSearchJobs)
    .where(
      and(
        eq(materialProfileSearchJobs.workspaceId, workspaceId),
        inArray(materialProfileSearchJobs.status, ACTIVE_JOB_STATUSES),
      ),
    );
  const cancelled: MaterialProfileSearchJobSnapshot[] = [];
  for (const job of activeJobs) {
    cancelled.push(await cancelMaterialProfileSearchJob(job.id));
  }
  return cancelled;
}

export const cancelActiveMaterialProfileSearchJobsForWorkspace = traceFn(
  log,
  "cancelActiveMaterialProfileSearchJobsForWorkspace",
  _cancelActiveMaterialProfileSearchJobsForWorkspace,
);

/**
 * Pure decision: whether a completed/partial run should attempt auto-apply.
 * Exported for unit tests (DB merge path stays in autoApplyReliableSearchRunToItem).
 */
export function shouldAttemptAutoApplyReliableSearchRun(input: {
  status: MaterialProfileSearchRunStatus;
  hasReliableResult: boolean;
}): boolean {
  if (input.status !== "completed" && input.status !== "partial") {
    return false;
  }
  return input.hasReliableResult;
}

/**
 * Pure merge policy for auto-apply: skip overwriting exportable catalog/AI/web
 * decisions (search payloads may still be refreshed by the DB path).
 */
export function shouldSkipAutoApplyOverwrite(input: {
  hasExistingExportableDecision: boolean;
}): boolean {
  return input.hasExistingExportableDecision;
}

export const setCurrentMaterialProfileSearchRun = traceFn(
  log,
  "setCurrentMaterialProfileSearchRun",
  _setCurrentMaterialProfileSearchRun,
);
export const processMaterialProfileSearchJob = traceFn(
  log,
  "processMaterialProfileSearchJob",
  _processMaterialProfileSearchJob,
);
export const completeMaterialProfileSearchJob = traceFn(
  log,
  "completeMaterialProfileSearchJob",
  _completeMaterialProfileSearchJob,
);
export const failMaterialProfileSearchJob = traceFn(
  log,
  "failMaterialProfileSearchJob",
  _failMaterialProfileSearchJob,
);
