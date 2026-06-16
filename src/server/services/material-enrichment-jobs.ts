import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import {
  type MaterialEnrichmentFilterOptions,
  type MaterialEnrichmentJobOptions,
  type MaterialEnrichmentResult,
} from "~/lib/materials/material-enrichment-types";
import { env } from "~/env";
import { db } from "~/server/db";
import {
  materialEnrichmentItems,
  materialEnrichmentJobs,
  materialWebCandidates,
  materials,
} from "~/server/db/schema";
import { commitEnrichmentItem } from "~/server/services/material-enrichment-commit";
import { ShopJobServiceError } from "~/server/services/shop-job-errors";

export type MaterialEnrichmentJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type MaterialEnrichmentJobSnapshot = {
  id: string;
  status: MaterialEnrichmentJobStatus;
  options: MaterialEnrichmentJobOptions;
  filterOptions: MaterialEnrichmentFilterOptions;
  materialIds: number[];
  total: number;
  processed: number;
  matched: number;
  needsReview: number;
  pdfsFound: number;
  pdfsGenerated: number;
  failed: number;
  currentMaterialId: number | null;
  currentMaterialName: string | null;
  message: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  lastProgressAt: string | null;
  expiresAt: string | null;
  isExpired: boolean;
};

export type MaterialEnrichmentJobListItem = MaterialEnrichmentJobSnapshot;

export type MaterialEnrichmentItemSnapshot = {
  id: number;
  jobId: string;
  materialId: number;
  status: string;
  originalSnapshot: Record<string, unknown>;
  materialImageUrl: string | null;
  result: MaterialEnrichmentResult;
  committedAt: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type MaterialWebCandidateSnapshot = {
  id: number;
  enrichmentItemId: number;
  materialId: number;
  provider: string;
  query: string;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  catalogPdfUrls: string[];
  confidenceScore: number;
  matchReasons: string[];
  isSelected: boolean;
  fetchedAt: string;
  createdAt: string;
  imageUrl: string | null;
};

type JobRow = typeof materialEnrichmentJobs.$inferSelect;
type ItemRow = typeof materialEnrichmentItems.$inferSelect;

const ACTIVE_JOB_STATUSES: MaterialEnrichmentJobStatus[] = ["queued", "running"];
const DEFAULT_LIST_LIMIT = 25;
const MAX_LIST_LIMIT = 100;

function parseJobOptions(value: unknown): MaterialEnrichmentJobOptions {
  if (!value || typeof value !== "object") {
    return {};
  }
  return value as MaterialEnrichmentJobOptions;
}

function parseFilterOptions(value: unknown): MaterialEnrichmentFilterOptions {
  const empty: MaterialEnrichmentFilterOptions = {
    categories: [],
    manufacturers: [],
    origins: [],
    units: [],
  };
  if (!value || typeof value !== "object") {
    return empty;
  }
  const record = value as Record<string, unknown>;
  return {
    categories: Array.isArray(record.categories)
      ? record.categories.map(String).filter(Boolean)
      : [],
    manufacturers: Array.isArray(record.manufacturers)
      ? record.manufacturers.map(String).filter(Boolean)
      : [],
    origins: Array.isArray(record.origins)
      ? record.origins.map(String).filter(Boolean)
      : [],
    units: Array.isArray(record.units)
      ? record.units.map(String).filter(Boolean)
      : [],
  };
}

async function selectDistinctMaterialValues(column: AnyPgColumn) {
  const trimmedColumn = sql<string>`btrim(${column})`;
  const rows = await db
    .select({ value: trimmedColumn })
    .from(materials)
    .where(
      and(
        isNull(materials.deletedAt),
        sql`nullif(btrim(${column}), '') is not null`,
      ),
    )
    .groupBy(trimmedColumn)
    .orderBy(asc(trimmedColumn))
    .limit(500);

  return rows.map((row) => row.value.trim()).filter(Boolean);
}

async function loadFilterOptionsSnapshot(
  _materialIds: number[],
): Promise<MaterialEnrichmentFilterOptions> {
  const [categories, manufacturers, origins, units] = await Promise.all([
    selectDistinctMaterialValues(materials.category),
    selectDistinctMaterialValues(materials.manufacturer),
    selectDistinctMaterialValues(materials.originCountry),
    selectDistinctMaterialValues(materials.unit),
  ]);

  return {
    categories,
    manufacturers,
    origins,
    units,
  };
}

export async function startMaterialEnrichmentJob(input: {
  materialIds: number[];
  options?: MaterialEnrichmentJobOptions;
  filterOptions?: MaterialEnrichmentFilterOptions;
}) {
  const materialIds = [...new Set(input.materialIds.map((id) => Math.trunc(id)).filter((id) => id > 0))];
  if (materialIds.length === 0) {
    throw new ShopJobServiceError(
      "BAD_REQUEST",
      "Chọn ít nhất một vật tư để enrichment.",
    );
  }

  const existingMaterials = await db
    .select({ id: materials.id })
    .from(materials)
    .where(and(inArray(materials.id, materialIds), isNull(materials.deletedAt)));

  if (existingMaterials.length === 0) {
    throw new ShopJobServiceError("NOT_FOUND", "Không tìm thấy vật tư đã chọn.");
  }

  const filterSnapshot =
    input.filterOptions ?? (await loadFilterOptionsSnapshot(materialIds));
  const now = new Date().toISOString();
  const jobId = randomUUID();

  const [job] = await db
    .insert(materialEnrichmentJobs)
    .values({
      id: jobId,
      status: "queued",
      optionsJson: input.options ?? {},
      materialIds,
      filterSnapshotJson: filterSnapshot,
      total: existingMaterials.length,
      message: "Đang xếp hàng chờ enrichment.",
      startedAt: now,
      updatedAt: now,
    })
    .returning();

  await db.insert(materialEnrichmentItems).values(
    existingMaterials.map((material, index) => ({
      jobId,
      materialId: material.id,
      sortOrder: index,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    })),
  );

  return toJobSnapshot(requireRow(job));
}

export async function listMaterialEnrichmentJobs(
  input: { limit?: number; offset?: number } = {},
) {
  const limit = clampListLimit(input.limit);
  const rows = await db
    .select()
    .from(materialEnrichmentJobs)
    .orderBy(
      sql`case when ${materialEnrichmentJobs.status} in ('queued', 'running') then 0 else 1 end`,
      desc(materialEnrichmentJobs.startedAt),
    )
    .limit(limit)
    .offset(Math.max(0, input.offset ?? 0));

  return rows.map(toJobListItem);
}

export async function getMaterialEnrichmentJob(jobId: string) {
  const [job] = await db
    .select()
    .from(materialEnrichmentJobs)
    .where(eq(materialEnrichmentJobs.id, jobId))
    .limit(1);

  return job ? toJobSnapshot(job) : null;
}

export async function cancelMaterialEnrichmentJob(jobId: string) {
  const now = new Date().toISOString();
  const [cancelled] = await db
    .update(materialEnrichmentJobs)
    .set({
      status: "cancelled",
      currentMaterialId: null,
      currentMaterialName: null,
      finishedAt: now,
      lastProgressAt: now,
      expiresAt: expiresAt(now),
      message: "Job enrichment đã bị hủy.",
      updatedAt: now,
    })
    .where(
      and(
        eq(materialEnrichmentJobs.id, jobId),
        inArray(materialEnrichmentJobs.status, ACTIVE_JOB_STATUSES),
      ),
    )
    .returning();

  return cancelled ? toJobSnapshot(cancelled) : getMaterialEnrichmentJob(jobId);
}

export async function deleteMaterialEnrichmentJob(jobId: string) {
  const existing = await getMaterialEnrichmentJob(jobId);
  if (!existing) {
    return null;
  }
  if (ACTIVE_JOB_STATUSES.includes(existing.status)) {
    throw new ShopJobServiceError(
      "BAD_REQUEST",
      "Hãy hủy job enrichment trước khi xóa khỏi danh sách.",
    );
  }

  const [deleted] = await db
    .delete(materialEnrichmentJobs)
    .where(eq(materialEnrichmentJobs.id, jobId))
    .returning();

  return deleted ? toJobSnapshot(deleted) : existing;
}

export async function getMaterialEnrichmentItem(itemId: number) {
  const [item] = await db
    .select()
    .from(materialEnrichmentItems)
    .where(eq(materialEnrichmentItems.id, itemId))
    .limit(1);

  if (!item) {
    return null;
  }

  const [material] = await db
    .select({ imageUrl: materials.imageUrl })
    .from(materials)
    .where(eq(materials.id, item.materialId))
    .limit(1);

  return toItemSnapshot(item, material?.imageUrl ?? null);
}

export async function listMaterialEnrichmentItems(
  input: string | { jobId: string; limit?: number; offset?: number },
) {
  const jobId = typeof input === "string" ? input : input.jobId;
  const limit =
    typeof input === "string"
      ? 500
      : Math.min(500, Math.max(1, input.limit ?? 500));
  const offset = typeof input === "string" ? 0 : Math.max(0, input.offset ?? 0);
  const rows = await db
    .select()
    .from(materialEnrichmentItems)
    .where(eq(materialEnrichmentItems.jobId, jobId))
    .orderBy(asc(materialEnrichmentItems.sortOrder))
    .limit(limit)
    .offset(offset);

  return rows.map((row) => toItemSnapshot(row));
}

export async function listMaterialWebCandidates(itemId: number) {
  const rows = await db
    .select()
    .from(materialWebCandidates)
    .where(eq(materialWebCandidates.enrichmentItemId, itemId))
    .orderBy(desc(materialWebCandidates.confidenceScore));

  return rows.map(toCandidateSnapshot);
}

export async function selectWebCandidate(itemId: number, candidateId: number) {
  const [item] = await db
    .select()
    .from(materialEnrichmentItems)
    .where(eq(materialEnrichmentItems.id, itemId))
    .limit(1);

  if (!item) {
    throw new ShopJobServiceError("NOT_FOUND", "Không tìm thấy dòng enrichment.");
  }

  const [candidate] = await db
    .select()
    .from(materialWebCandidates)
    .where(
      and(
        eq(materialWebCandidates.id, candidateId),
        eq(materialWebCandidates.enrichmentItemId, itemId),
      ),
    )
    .limit(1);

  if (!candidate) {
    throw new ShopJobServiceError("NOT_FOUND", "Không tìm thấy ứng viên web.");
  }

  await db
    .update(materialWebCandidates)
    .set({ isSelected: false })
    .where(eq(materialWebCandidates.enrichmentItemId, itemId));

  await db
    .update(materialWebCandidates)
    .set({ isSelected: true })
    .where(eq(materialWebCandidates.id, candidateId));

  const result = (item.resultJson ?? {}) as MaterialEnrichmentResult;
  const nextResult: MaterialEnrichmentResult = {
    ...result,
    selectedCandidateId: candidateId,
  };

  const [updated] = await db
    .update(materialEnrichmentItems)
    .set({
      resultJson: nextResult,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(materialEnrichmentItems.id, itemId))
    .returning();

  return {
    item: toItemSnapshot(requireItemRow(updated)),
    candidate: toCandidateSnapshot(candidate),
  };
}

export async function commitMaterialEnrichmentItem(itemId: number) {
  const item = await getMaterialEnrichmentItem(itemId);
  if (!item) {
    throw new ShopJobServiceError("NOT_FOUND", "Không tìm thấy dòng enrichment.");
  }
  if (item.status === "committed") {
    throw new ShopJobServiceError("BAD_REQUEST", "Dòng enrichment đã được commit.");
  }
  if (!["auto", "review"].includes(item.status)) {
    throw new ShopJobServiceError(
      "BAD_REQUEST",
      "Chỉ commit các dòng ở trạng thái auto hoặc review.",
    );
  }

  const committed = await commitEnrichmentItem(db, itemId);
  return toItemSnapshot(requireItemRow(committed));
}

export async function bulkCommitMaterialEnrichment(input: {
  jobId: string;
  itemIds?: number[];
  minConfidence?: number;
}) {
  const items = await listMaterialEnrichmentItems(input);
  const minConfidence = input.minConfidence ?? 0;
  const itemIdSet =
    input.itemIds && input.itemIds.length > 0
      ? new Set(input.itemIds)
      : null;

  const eligible = items.filter((item) => {
    if (itemIdSet && !itemIdSet.has(item.id)) {
      return false;
    }
    if (!["auto", "review"].includes(item.status)) {
      return false;
    }
    return item.result.overallConfidence >= minConfidence;
  });
  const results: MaterialEnrichmentItemSnapshot[] = [];
  let committed = 0;
  let failed = 0;

  for (const item of eligible) {
    try {
      results.push(await commitMaterialEnrichmentItem(item.id));
      committed += 1;
    } catch {
      failed += 1;
    }
  }

  return { committed, failed, items: results };
}

export async function rejectMaterialEnrichmentItem(itemId: number) {
  const [updated] = await db
    .update(materialEnrichmentItems)
    .set({
      status: "rejected",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(materialEnrichmentItems.id, itemId))
    .returning();

  if (!updated) {
    throw new ShopJobServiceError("NOT_FOUND", "Không tìm thấy dòng enrichment.");
  }

  return toItemSnapshot(updated);
}

export async function exportMaterialEnrichmentReport(jobId: string) {
  const job = await getMaterialEnrichmentJob(jobId);
  if (!job) {
    throw new ShopJobServiceError("NOT_FOUND", "Không tìm thấy job enrichment.");
  }

  const items = await listMaterialEnrichmentItems({ jobId });
  const candidatesByItem = await Promise.all(
    items.map(async (item) => ({
      itemId: item.id,
      candidates: await listMaterialWebCandidates(item.id),
    })),
  );

  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      job,
      items,
      candidatesByItem,
    },
    null,
    2,
  );
}

function toJobListItem(row: JobRow): MaterialEnrichmentJobListItem {
  return toJobSnapshot(row);
}

function toJobSnapshot(row: JobRow): MaterialEnrichmentJobSnapshot {
  return {
    id: row.id,
    status: row.status,
    options: parseJobOptions(row.optionsJson),
    filterOptions: parseFilterOptions(row.filterSnapshotJson),
    materialIds: Array.isArray(row.materialIds) ? row.materialIds : [],
    total: row.total,
    processed: row.processed,
    matched: row.matched,
    needsReview: row.needsReview,
    pdfsFound: row.pdfsFound,
    pdfsGenerated: row.pdfsGenerated,
    failed: row.failed,
    currentMaterialId: row.currentMaterialId,
    currentMaterialName: row.currentMaterialName,
    message: row.message,
    error: row.error,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    lastProgressAt: row.lastProgressAt,
    expiresAt: row.expiresAt,
    isExpired: row.expiresAt
      ? new Date(row.expiresAt).getTime() < Date.now()
      : false,
  };
}

function toItemSnapshot(
  row: ItemRow,
  materialImageUrl: string | null = null,
): MaterialEnrichmentItemSnapshot {
  return {
    id: row.id,
    jobId: row.jobId,
    materialId: row.materialId,
    status: row.status,
    originalSnapshot:
      row.originalSnapshotJson && typeof row.originalSnapshotJson === "object"
        ? row.originalSnapshotJson
        : {},
    materialImageUrl,
    result:
      row.resultJson && typeof row.resultJson === "object"
        ? (row.resultJson as MaterialEnrichmentResult)
        : {
            fields: {},
            catalogPdfUrls: [],
            overallConfidence: 0,
            status: "pending",
          },
    committedAt: row.committedAt,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toCandidateSnapshot(
  row: typeof materialWebCandidates.$inferSelect,
): MaterialWebCandidateSnapshot {
  return {
    id: row.id,
    enrichmentItemId: row.enrichmentItemId,
    materialId: row.materialId,
    provider: row.provider,
    query: row.query,
    title: row.title,
    url: row.url,
    domain: row.domain,
    snippet: row.snippet,
    catalogPdfUrls: Array.isArray(row.catalogPdfUrls) ? row.catalogPdfUrls : [],
    confidenceScore: row.confidenceScore,
    matchReasons: Array.isArray(row.matchReasons) ? row.matchReasons : [],
    isSelected: row.isSelected,
    fetchedAt: row.fetchedAt,
    createdAt: row.createdAt,
    imageUrl: row.imageUrl ?? null,
  };
}

function expiresAt(finishedAtIso: string) {
  return new Date(
    new Date(finishedAtIso).getTime() + env.SCRAPE_JOB_TTL_DAYS * 86_400_000,
  ).toISOString();
}

function clampListLimit(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return DEFAULT_LIST_LIMIT;
  }
  return Math.min(MAX_LIST_LIMIT, Math.max(1, Math.trunc(value ?? 0)));
}

function requireRow(row: JobRow | undefined) {
  if (!row) {
    throw new Error("Không thể tạo job enrichment.");
  }
  return row;
}

function requireItemRow(row: ItemRow | undefined) {
  if (!row) {
    throw new Error("Không thể cập nhật dòng enrichment.");
  }
  return row;
}
