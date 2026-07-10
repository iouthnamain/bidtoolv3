import "server-only";

import { randomUUID } from "node:crypto";

import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  ne,
  sql,
  type SQL,
} from "drizzle-orm";

import type {
  AiSearchStoredResult,
  WebLinkResult,
} from "~/lib/materials/enrich-gap-fill";
import {
  deserializeRowDecision,
  type WebSearchStatus,
} from "~/lib/materials/review-decision";
import {
  RELIABLE_SEARCH_MATCH_THRESHOLD,
  webLinkMatchChips,
} from "~/lib/materials/search-candidate-match";
import {
  autoProfileIdentityMismatchReasons,
  autoProfileSourceLabel,
  evaluateAutoProfileCandidate,
} from "~/lib/materials/profile-auto-gate";
import {
  createMaterialProfileSourceFingerprint,
  validateMaterialProfileInput,
  validateMaterialProfileResolution,
} from "~/lib/materials/profile-input-contract";
import { db } from "~/server/db";
import {
  excelWorkspaceItems,
  excelWorkspaces,
  materialCatalogDocumentLinks,
  materials,
  materialProfilePromotionLedger,
  materialProfileSearchCache,
  materialProfileSearchJobs,
  materialProfileSearchRuns,
} from "~/server/db/schema";
import { getOrCreateCatalogDocumentByUrl } from "~/server/services/catalog-documents";
import { parseOptionalNumber } from "~/server/services/excel-workbook";
import type { EnrichWebRowInput } from "~/server/services/enrich-web-row";
import { runWithConcurrency } from "~/server/services/concurrency";
import {
  extractProfileRowAiCandidates,
  searchProfileRowWebLinks,
} from "~/server/services/enrich-profile-row-search";
import { abortMaterialProfileSearchJob } from "~/server/services/job-scheduler";
import { createLogger, traceFn } from "~/server/lib/logger";

const log = createLogger("services-material-profile-search-jobs");

export type MaterialProfileSearchMode = "web" | "ai" | "auto";
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

/** Internal control-flow signal: a cancelled job must never write a later result. */
class MaterialProfileSearchCancelledError extends Error {
  constructor() {
    super("Job tìm kiếm đã bị hủy.");
    this.name = "MaterialProfileSearchCancelledError";
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

const MAX_INTERACTIVE_JOB_ITEMS = 500;
export const MAX_AUTO_MATERIAL_PROFILE_JOB_ITEMS = 5_000;
const MAX_SEARCH_RUN_LIST_LIMIT = 500;
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
  return value === "web" || value === "ai" || value === "auto";
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
    throw new MaterialProfileSearchCancelledError();
  }
}

async function assertJobIsNotCancelled(jobId: string) {
  const [job] = await db
    .select({ status: materialProfileSearchJobs.status })
    .from(materialProfileSearchJobs)
    .where(eq(materialProfileSearchJobs.id, jobId))
    .limit(1);
  if (!job || job.status === "cancelled") {
    throw new MaterialProfileSearchCancelledError();
  }
}

type AutoRunEligibility =
  | { current: true }
  | { current: false; message: string };

/**
 * A search run captures a row snapshot. Re-mapping/uploading can replace that
 * row while a network/AI request is still in flight, so automatic persistence
 * must only touch the still-current row with the same source fingerprint.
 */
async function getAutoRunEligibility(
  run: RunRow,
  signal?: AbortSignal,
): Promise<AutoRunEligibility> {
  throwIfAborted(signal);
  await assertJobIsNotCancelled(run.jobId);

  const [item] = await db
    .select()
    .from(excelWorkspaceItems)
    .where(
      and(
        eq(excelWorkspaceItems.id, run.itemId),
        eq(excelWorkspaceItems.workspaceId, run.workspaceId),
      ),
    )
    .limit(1);
  if (!item || item.isStale) {
    return {
      current: false,
      message: "Dòng nguồn đã được thay đổi hoặc thay thế; bỏ qua kết quả cũ.",
    };
  }

  const snapshot = asRecord(run.inputSnapshotJson);
  const expectedFingerprint = createMaterialProfileSourceFingerprint({
    name: textField(snapshot.name),
    unit: textField(snapshot.unit),
    specText: textField(snapshot.specText),
    rowIndex: run.originalRowIndex,
  });
  const actualFingerprint =
    item.sourceFingerprint ||
    createMaterialProfileSourceFingerprint({
      name: item.productName,
      unit: item.unit,
      specText: item.specText,
      rowIndex: item.originalRowIndex,
    });
  if (actualFingerprint !== expectedFingerprint) {
    return {
      current: false,
      message: "Dòng nguồn đã thay đổi dữ liệu; bỏ qua kết quả cũ.",
    };
  }

  return { current: true };
}

function textField(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function firstNonEmptyText(...values: Array<string | null | undefined>) {
  return values.map((value) => value?.trim() ?? "").find(Boolean) ?? "";
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
    | "mode"
    | "inputSnapshotJson"
    | "webLinkResultsJson"
    | "aiSearchCandidatesJson"
    | "recommendedCandidateKey"
  >,
) {
  const snapshot = asRecord(run.inputSnapshotJson);
  const rowName = textField(snapshot.name);
  const sheetFields = sheetFieldsFromSnapshot(snapshot);
  const decision = parseRunDecision(run as RunRow);

  // The unattended path has a stronger truth condition than the review UI: a
  // model recommendation is not reliable unless every automatic-evidence gate
  // passes. This keeps progress counters from describing an unsafe result as
  // found/saved.
  if (run.mode === "auto") {
    return (decision?.aiSearchCandidates ?? []).some(
      (candidate) =>
        evaluateAutoProfileCandidate({
          row: {
            name: rowName,
            code: sheetFields.code,
            unit: sheetFields.unit,
            specText: sheetFields.specText,
            manufacturer: sheetFields.manufacturer,
            category: sheetFields.category,
            originCountry: sheetFields.originCountry,
          },
          candidate,
        }).allowed,
    );
  }

  if (run.recommendedCandidateKey) return true;

  const webReliable = (decision?.webLinkResults ?? []).some(
    (link) =>
      webLinkMatchChips(link, rowName, sheetFields).score >=
      RELIABLE_SEARCH_MATCH_THRESHOLD,
  );
  if (webReliable) return true;

  return (decision?.aiSearchCandidates ?? []).some(
    (candidate) =>
      evaluateAutoProfileCandidate({
        row: {
          name: rowName,
          code: sheetFields.code,
          unit: sheetFields.unit,
          specText: sheetFields.specText,
          manufacturer: sheetFields.manufacturer,
          category: sheetFields.category,
          originCountry: sheetFields.originCountry,
        },
        candidate,
      }).score >= RELIABLE_SEARCH_MATCH_THRESHOLD,
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
      mode: input.run.mode,
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
      mode: materialProfileSearchRuns.mode,
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
  const jobItemLimit =
    input.mode === "auto"
      ? MAX_AUTO_MATERIAL_PROFILE_JOB_ITEMS
      : MAX_INTERACTIVE_JOB_ITEMS;
  if (itemIds.length > jobItemLimit) {
    throw new MaterialProfileSearchJobError(
      "BAD_REQUEST",
      `Tối đa ${jobItemLimit.toLocaleString("vi-VN")} dòng mỗi job tìm kiếm.`,
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
  const eligibleItems =
    input.mode === "auto"
      ? items.filter(
          (item) =>
            !item.isStale &&
            validateMaterialProfileInput({
              name: item.productName,
              unit: item.unit,
              specText: item.specText,
              rowIndex: item.originalRowIndex,
            }).valid,
        )
      : items;
  if (eligibleItems.length === 0) {
    throw new MaterialProfileSearchJobError(
      "BAD_REQUEST",
      "Chưa có dòng đủ Tên vật tư, ĐVT và Thông số kỹ thuật để tự xử lý.",
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
        requestedItemIds: eligibleItems.map((item) => item.id),
        total: eligibleItems.length,
        message:
          input.mode === "web"
            ? "Đang xếp hàng tìm web."
            : input.mode === "auto"
              ? "Đang xếp hàng tự xử lý."
              : "Đang xếp hàng tìm AI.",
        startedAt: now,
        lastProgressAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await tx.insert(materialProfileSearchRuns).values(
      eligibleItems.map((item, index) => ({
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
    .limit(Math.min(Math.max(input.limit ?? 10, 1), MAX_SEARCH_RUN_LIST_LIMIT));
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
  await assertJobIsNotCancelled(input.run.jobId);
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

type AutoProfileSearchCachePayload = {
  queries: string[];
  warnings: string[];
  webLinkResults: WebLinkResult[];
  aiSearchCandidates: AiSearchStoredResult[];
  recommendedCandidateKey: string | null;
};

function autoProfileSearchCacheKey(input: EnrichWebRowInput) {
  return `profile-auto:v1:${createMaterialProfileSourceFingerprint({
    name: input.name ?? "",
    unit: input.unit ?? "",
    specText: input.specText ?? "",
  })}`;
}

function autoProfileSearchCachePayload(
  value: unknown,
): AutoProfileSearchCachePayload | null {
  const record = asRecord(value);
  if (!record || Object.keys(record).length === 0) return null;
  return {
    queries: parseStringArray(record.queries),
    warnings: parseStringArray(record.warnings),
    webLinkResults: Array.isArray(record.webLinkResults)
      ? (record.webLinkResults as WebLinkResult[])
      : [],
    aiSearchCandidates: Array.isArray(record.aiSearchCandidates)
      ? (record.aiSearchCandidates as AiSearchStoredResult[])
      : [],
    recommendedCandidateKey:
      typeof record.recommendedCandidateKey === "string"
        ? record.recommendedCandidateKey
        : null,
  };
}

async function readAutoProfileSearchCache(input: EnrichWebRowInput) {
  const [row] = await db
    .select({ payloadJson: materialProfileSearchCache.payloadJson })
    .from(materialProfileSearchCache)
    .where(
      and(
        eq(
          materialProfileSearchCache.cacheKey,
          autoProfileSearchCacheKey(input),
        ),
        gt(materialProfileSearchCache.expiresAt, new Date().toISOString()),
      ),
    )
    .limit(1);
  return row ? autoProfileSearchCachePayload(row.payloadJson) : null;
}

async function writeAutoProfileSearchCache(
  input: EnrichWebRowInput,
  payload: AutoProfileSearchCachePayload,
) {
  const now = new Date().toISOString();
  const expiresAt = new Date(
    Date.now() + 7 * 24 * 60 * 60 * 1_000,
  ).toISOString();
  await db
    .insert(materialProfileSearchCache)
    .values({
      cacheKey: autoProfileSearchCacheKey(input),
      payloadJson: sanitizeStoredJson(payload) as Record<string, unknown>,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: materialProfileSearchCache.cacheKey,
      set: {
        payloadJson: sanitizeStoredJson(payload) as Record<string, unknown>,
        expiresAt,
        updatedAt: now,
      },
    });
}

async function recordAutoProfilePromotion(input: {
  run: RunRow;
  status: "saved" | "needs_verification";
  materialId: number | null;
  resolution: Record<string, unknown>;
}) {
  const now = new Date().toISOString();
  const sourceFingerprint = createMaterialProfileSourceFingerprint({
    name: textField(
      input.run.inputSnapshotJson && asRecord(input.run.inputSnapshotJson).name,
    ),
    unit: textField(asRecord(input.run.inputSnapshotJson).unit),
    specText: textField(asRecord(input.run.inputSnapshotJson).specText),
    rowIndex: input.run.originalRowIndex,
  });
  await db
    .insert(materialProfilePromotionLedger)
    .values({
      workspaceId: input.run.workspaceId,
      itemId: input.run.itemId,
      sourceFingerprint,
      materialId: input.materialId,
      status: input.status,
      resolutionJson: sanitizeStoredJson(input.resolution) as Record<
        string,
        unknown
      >,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        materialProfilePromotionLedger.workspaceId,
        materialProfilePromotionLedger.itemId,
        materialProfilePromotionLedger.sourceFingerprint,
      ],
      set: {
        materialId: input.materialId,
        status: input.status,
        resolutionJson: sanitizeStoredJson(input.resolution) as Record<
          string,
          unknown
        >,
        updatedAt: now,
      },
    });
}

function autoProfileRowIdentity(row: EnrichWebRowInput) {
  return {
    name: row.name ?? "",
    code: row.code,
    unit: row.unit ?? "",
    specText: row.specText ?? "",
    manufacturer: row.manufacturer,
    category: row.category,
    originCountry: row.originCountry,
  };
}

function blockAutoProfileResolution(
  resolution: ReturnType<typeof validateMaterialProfileResolution>,
  reasons: string[],
) {
  if (reasons.length === 0) return resolution;
  return {
    ...resolution,
    promotable: false,
    status: "needs_verification" as const,
    reasons: Array.from(new Set([...resolution.reasons, ...reasons])),
  };
}

async function persistAutoProfileNeedsVerification(input: {
  run: RunRow;
  resolution: ReturnType<typeof validateMaterialProfileResolution>;
}) {
  const eligibility = await getAutoRunEligibility(input.run);
  if (!eligibility.current) return;

  const now = new Date().toISOString();
  await db
    .update(excelWorkspaceItems)
    .set({
      enrichedSnapshotJson: sql`coalesce(${excelWorkspaceItems.enrichedSnapshotJson}, '{}'::jsonb) || ${JSON.stringify(
        { autoResolution: input.resolution },
      )}::jsonb`,
      updatedAt: now,
    })
    .where(
      and(
        eq(excelWorkspaceItems.id, input.run.itemId),
        eq(excelWorkspaceItems.isStale, false),
      ),
    );
  await recordAutoProfilePromotion({
    run: input.run,
    status: "needs_verification",
    materialId: null,
    resolution: input.resolution as unknown as Record<string, unknown>,
  });
}

/**
 * Persist only evidence-backed automatic candidates. The manual review flow is
 * intentionally separate, but this path never lets inherited row values or a
 * model-only claim become a canonical material.
 */
async function promoteAutoProfileCandidate(input: {
  run: RunRow;
  row: EnrichWebRowInput;
  candidate: AiSearchStoredResult;
}) {
  const eligibility = await getAutoRunEligibility(input.run);
  if (!eligibility.current) {
    return { promoted: false, skipped: true, reason: eligibility.message };
  }

  const autoGate = evaluateAutoProfileCandidate({
    row: autoProfileRowIdentity(input.row),
    candidate: input.candidate,
  });
  const fields = input.candidate.fields;
  const candidate = {
    code: fields.code,
    name: input.candidate.title?.trim() ?? "",
    unit: fields.unit,
    specText: fields.specText,
    manufacturer: fields.manufacturer,
    originCountry: fields.originCountry,
    unitPrice: parseOptionalNumber(fields.defaultUnitPrice ?? ""),
    source: autoGate.sourceUrl
      ? autoProfileSourceLabel(autoGate.sourceUrl)
      : "",
    sourceUrl: autoGate.sourceUrl ?? "",
    catalogUrl: autoGate.catalogUrl ?? "",
    evidenceUrls: autoGate.evidenceUrls,
    confidence: autoGate.confidence,
    provenance: "ai",
  };
  let resolution = validateMaterialProfileResolution({
    input: {
      name: input.row.name ?? "",
      unit: input.row.unit ?? "",
      specText: input.row.specText ?? "",
      rowIndex: input.run.originalRowIndex,
    },
    candidate,
  });
  resolution = blockAutoProfileResolution(resolution, autoGate.reasons);

  if (!resolution.promotable) {
    await persistAutoProfileNeedsVerification({ run: input.run, resolution });
    return { promoted: false, resolution };
  }

  const normalized = resolution.candidate;
  const resolvedName = normalized.name ?? input.row.name ?? "";
  const resolvedUnit = normalized.unit ?? input.row.unit ?? "";
  const resolvedSpecText = normalized.specText ?? input.row.specText ?? "";
  const catalogUrl = normalized.catalogUrl;
  if (!catalogUrl) {
    const blocked = blockAutoProfileResolution(resolution, [
      "Chưa có URL catalog đủ điều kiện để lưu.",
    ]);
    await persistAutoProfileNeedsVerification({
      run: input.run,
      resolution: blocked,
    });
    return { promoted: false, resolution: blocked };
  }

  // Catalog-document creation happens before the material transaction. If it
  // fails, no canonical material or matched row is written. The transaction
  // below links this verified document atomically with the material/item state.
  let catalogDocument: Awaited<
    ReturnType<typeof getOrCreateCatalogDocumentByUrl>
  >;
  try {
    catalogDocument = await getOrCreateCatalogDocumentByUrl(db, catalogUrl, {
      sourceType: "detected",
      title: resolvedName,
      supplier: normalized.manufacturer ?? null,
    });
  } catch (error) {
    const blocked = blockAutoProfileResolution(resolution, [
      `Không thể tạo liên kết catalog đã xác minh: ${error instanceof Error ? error.message : "lỗi không xác định"}.`,
    ]);
    await persistAutoProfileNeedsVerification({
      run: input.run,
      resolution: blocked,
    });
    return { promoted: false, resolution: blocked };
  }

  const now = new Date().toISOString();
  const snapshot = asRecord(input.run.inputSnapshotJson);
  const expectedFingerprint = createMaterialProfileSourceFingerprint({
    name: textField(snapshot.name),
    unit: textField(snapshot.unit),
    specText: textField(snapshot.specText),
    rowIndex: input.run.originalRowIndex,
  });

  const promotion = await db.transaction(async (tx) => {
    // Lock the source row before creating/updating a canonical material. A
    // re-map waits for this short transaction, then marks the old row stale;
    // conversely a stale or cancelled run returns without writing anything.
    const [currentJob] = await tx
      .select({ status: materialProfileSearchJobs.status })
      .from(materialProfileSearchJobs)
      .where(eq(materialProfileSearchJobs.id, input.run.jobId))
      .limit(1)
      .for("update");
    if (!currentJob || currentJob.status === "cancelled") {
      throw new MaterialProfileSearchCancelledError();
    }
    const [currentItem] = await tx
      .select()
      .from(excelWorkspaceItems)
      .where(
        and(
          eq(excelWorkspaceItems.id, input.run.itemId),
          eq(excelWorkspaceItems.workspaceId, input.run.workspaceId),
        ),
      )
      .limit(1)
      .for("update");
    const currentFingerprint = currentItem
      ? currentItem.sourceFingerprint ||
        createMaterialProfileSourceFingerprint({
          name: currentItem.productName,
          unit: currentItem.unit,
          specText: currentItem.specText,
          rowIndex: currentItem.originalRowIndex,
        })
      : "";
    if (
      !currentItem ||
      currentItem.isStale ||
      currentFingerprint !== expectedFingerprint
    ) {
      return { material: null, collisionReasons: [] as string[] };
    }

    const [existing] = await tx
      .select()
      .from(materials)
      .where(
        and(
          isNull(materials.deletedAt),
          normalized.code
            ? eq(materials.code, normalized.code)
            : and(
                eq(materials.name, resolvedName),
                eq(materials.unit, resolvedUnit),
                eq(materials.specText, resolvedSpecText),
              ),
        ),
      )
      .limit(1);
    const collisionReasons = existing
      ? autoProfileIdentityMismatchReasons(
          {
            name: input.row.name ?? "",
            unit: input.row.unit ?? "",
            specText: input.row.specText ?? "",
          },
          {
            name: existing.name,
            unit: existing.unit,
            specText: existing.specText,
          },
        )
      : [];
    if (collisionReasons.length > 0) {
      return { material: null, collisionReasons };
    }

    const metadata = {
      ...(existing?.metadataJson ?? {}),
      materialProfile: {
        confidence: normalized.confidence,
        source: normalized.source,
        sourceUrl: normalized.sourceUrl,
        catalogUrl: normalized.catalogUrl,
        provenance: normalized.provenance,
        codeProvenance: normalized.codeProvenance,
        resolvedAt: now,
      },
    };
    const values = {
      code: firstNonEmptyText(existing?.code, normalized.code) || null,
      name: firstNonEmptyText(existing?.name, resolvedName),
      unit: firstNonEmptyText(existing?.unit, resolvedUnit),
      category:
        firstNonEmptyText(existing?.category, input.row.category) || null,
      specText: firstNonEmptyText(existing?.specText, resolvedSpecText),
      manufacturer:
        firstNonEmptyText(existing?.manufacturer, normalized.manufacturer) ||
        null,
      originCountry:
        firstNonEmptyText(existing?.originCountry, normalized.originCountry) ||
        null,
      defaultUnitPrice:
        existing?.defaultUnitPrice ?? normalized.unitPrice ?? null,
      currency: existing?.currency ?? "VND",
      sourceUrl:
        firstNonEmptyText(existing?.sourceUrl, normalized.sourceUrl) || null,
      metadataJson: metadata,
      updatedAt: now,
    };
    const [saved] = existing
      ? await tx
          .update(materials)
          .set(values)
          .where(eq(materials.id, existing.id))
          .returning()
      : await tx
          .insert(materials)
          .values({ ...values, createdAt: now })
          .returning();
    if (!saved) {
      throw new Error("Không thể lưu vật tư đã tự xử lý.");
    }

    await tx
      .insert(materialCatalogDocumentLinks)
      .values({
        documentId: catalogDocument.document.id,
        materialId: saved.id,
        linkSource: "scrape",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
    await tx
      .update(excelWorkspaceItems)
      .set({
        materialId: saved.id,
        matchStatus: "matched",
        enrichedSnapshotJson: sql`coalesce(${excelWorkspaceItems.enrichedSnapshotJson}, '{}'::jsonb) || ${JSON.stringify(
          {
            autoResolution: resolution,
            autoPromotedMaterialId: saved.id,
          },
        )}::jsonb`,
        updatedAt: now,
      })
      .where(
        and(
          eq(excelWorkspaceItems.id, input.run.itemId),
          eq(excelWorkspaceItems.isStale, false),
          eq(excelWorkspaceItems.sourceFingerprint, expectedFingerprint),
        ),
      );
    return { material: saved, collisionReasons: [] as string[] };
  });

  if (!promotion.material) {
    if (promotion.collisionReasons.length > 0) {
      const blocked = blockAutoProfileResolution(
        resolution,
        promotion.collisionReasons,
      );
      await persistAutoProfileNeedsVerification({
        run: input.run,
        resolution: blocked,
      });
      return { promoted: false, resolution: blocked };
    }
    return {
      promoted: false,
      skipped: true,
      reason: "Dòng nguồn đã thay đổi trước khi lưu kết quả tự động.",
      resolution,
    };
  }

  await recordAutoProfilePromotion({
    run: input.run,
    status: "saved",
    materialId: promotion.material.id,
    resolution: resolution as unknown as Record<string, unknown>,
  });
  return {
    promoted: true,
    materialId: promotion.material.id,
    resolution,
  };
}

async function promoteFirstAutoProfileCandidate(input: {
  run: RunRow;
  row: EnrichWebRowInput;
  candidates: AiSearchStoredResult[];
}) {
  const selected =
    input.candidates.find(
      (candidate) =>
        evaluateAutoProfileCandidate({
          row: autoProfileRowIdentity(input.row),
          candidate,
        }).allowed,
    ) ?? input.candidates[0];
  return selected
    ? promoteAutoProfileCandidate({ ...input, candidate: selected })
    : null;
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
          : job.mode === "auto"
            ? "Đang tự tìm và điền dữ liệu vật tư."
            : "Đang trích xuất AI từ nguồn web.",
      lastProgressAt: now,
      updatedAt: now,
    })
    .where(eq(materialProfileSearchJobs.id, job.id));

  await db
    .update(materialProfileSearchRuns)
    .set({ status: "running", startedAt: now, updatedAt: now })
    .where(eq(materialProfileSearchRuns.id, run.id));

  if (job.mode === "auto") {
    const eligibility = await getAutoRunEligibility(run, signal);
    if (!eligibility.current) {
      return updateRunWithResult({
        run,
        status: "skipped",
        webLinksStatus: "idle",
        aiSearchStatus: "idle",
        webLinkResults: [],
        aiSearchCandidates: [],
        queries: [],
        warnings: [eligibility.message],
        errorMessage: eligibility.message,
      });
    }
  }

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

    if (job.mode === "auto") {
      const cached = await readAutoProfileSearchCache(input);
      if (cached) {
        const cachedStatus: MaterialProfileSearchRunStatus =
          cached.aiSearchCandidates.length > 0
            ? "completed"
            : cached.webLinkResults.length > 0
              ? "partial"
              : "failed";
        const delta = await updateRunWithResult({
          run,
          status: cachedStatus,
          webLinksStatus: cached.webLinkResults.length > 0 ? "done" : "error",
          aiSearchStatus:
            cached.aiSearchCandidates.length > 0 ? "done" : "error",
          webLinkResults: cached.webLinkResults,
          aiSearchCandidates: cached.aiSearchCandidates,
          queries: cached.queries,
          recommendedCandidateKey: cached.recommendedCandidateKey ?? undefined,
          warnings: [
            ...cached.warnings,
            "Dùng kết quả đã lưu trong bộ nhớ đệm.",
          ],
          errorMessage:
            cachedStatus === "failed"
              ? "Không có kết quả đã lưu phù hợp."
              : null,
        });
        if (cached.aiSearchCandidates.length > 0) {
          try {
            throwIfAborted(signal);
            await promoteFirstAutoProfileCandidate({
              run,
              row: input,
              candidates: cached.aiSearchCandidates,
            });
          } catch (error) {
            if (error instanceof MaterialProfileSearchCancelledError) {
              throw error;
            }
            log.warn("auto_profile_cached_promotion_failed", {
              runId: run.id,
              itemId: run.itemId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        return delta;
      }
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
      if (job.mode === "auto") {
        await writeAutoProfileSearchCache(input, {
          queries,
          warnings,
          webLinkResults,
          aiSearchCandidates: ai.aiSearchCandidates,
          recommendedCandidateKey: ai.recommendedCandidateKey ?? null,
        });
      }
      const delta = await updateRunWithResult({
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
      if (job.mode === "auto" && ai.aiSearchCandidates.length > 0) {
        try {
          throwIfAborted(signal);
          await promoteFirstAutoProfileCandidate({
            run,
            row: input,
            candidates: ai.aiSearchCandidates,
          });
        } catch (error) {
          if (error instanceof MaterialProfileSearchCancelledError) {
            throw error;
          }
          log.warn("auto_profile_promotion_failed", {
            runId: run.id,
            itemId: run.itemId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return delta;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Không cấu hình AI enrichment.";
      warnings.push(message);
      if (job.mode === "auto") {
        await writeAutoProfileSearchCache(input, {
          queries,
          warnings,
          webLinkResults,
          aiSearchCandidates: [],
          recommendedCandidateKey: null,
        });
      }
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
    if (error instanceof MaterialProfileSearchCancelledError) {
      return zeroJobCounterDelta();
    }
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
          : job.mode === "auto"
            ? "Đang tự xử lý hồ sơ vật tư."
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

async function _completeMaterialProfileSearchJob(jobId: string) {
  await refreshJobCounters(jobId);
  const now = new Date().toISOString();
  const job = await getJobRow(jobId);
  if (!job || job.status === "cancelled") {
    return;
  }
  await db
    .update(materialProfileSearchJobs)
    .set({
      status: "completed",
      currentItemId: null,
      currentRowIndex: null,
      currentProductName: null,
      message: "Job tìm kiếm hồ sơ vật tư đã hoàn tất.",
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
