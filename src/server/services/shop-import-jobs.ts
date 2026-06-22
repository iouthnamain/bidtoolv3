import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "~/server/db";
import {
  tenantConditionForValue,
  type TenantScopeValue,
} from "~/server/api/tenant-scope";
import { shopImportJobs, shopScrapeJobs } from "~/server/db/schema";
import { resolveScrapeJobTtlDays } from "~/server/services/app-settings";
import { abortShopImportJob } from "~/server/services/job-scheduler";
import { ShopJobServiceError } from "~/server/services/shop-job-errors";
import type { ScrapedShopProduct } from "~/server/services/shop-material-scraper";
import { createLogger, traceFn } from "~/server/lib/logger";
const log = createLogger("services-shop-import-jobs");

export type ShopImportJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type ShopImportJobItem = {
  name: string;
  sourceUrl: string;
  action: "created" | "updated" | "skipped" | "failed";
  materialId?: number;
  message?: string;
};

export type ShopImportJobResult = {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  items: ShopImportJobItem[];
};

export type ShopImportJobProgress = ShopImportJobResult & {
  processed: number;
  total: number;
  currentProductName: string | null;
  currentSourceUrl: string | null;
};

export type ShopImportJobSnapshot = ShopImportJobProgress & {
  id: string;
  scrapeJobId: string;
  status: ShopImportJobStatus;
  productSourceUrls: string[] | null;
  durationMs: number | null;
  startedAt: string;
  finishedAt: string | null;
  lastProgressAt: string | null;
  expiresAt: string | null;
  error: string | null;
};

export type ShopImportJobListItem = Omit<ShopImportJobSnapshot, "items">;

type ShopImportJobRow = typeof shopImportJobs.$inferSelect;

const ACTIVE_JOB_STATUSES: ShopImportJobStatus[] = ["queued", "running"];
const DEFAULT_LIST_LIMIT = 25;
const MAX_LIST_LIMIT = 100;

async function _startShopImportJob(
  input: {
    scrapeJobId: string;
    productSourceUrls?: string[];
  },
  scope?: TenantScopeValue,
) {
  const [scrapeJob] = await db
    .select({
      id: shopScrapeJobs.id,
      status: shopScrapeJobs.status,
      products: shopScrapeJobs.products,
      tenantId: shopScrapeJobs.tenantId,
    })
    .from(shopScrapeJobs)
    .where(
      and(
        eq(shopScrapeJobs.id, input.scrapeJobId),
        tenantConditionForValue(scope, shopScrapeJobs.tenantId),
      ),
    )
    .limit(1);

  if (!scrapeJob) {
    throw new ShopJobServiceError(
      "NOT_FOUND",
      "Không tìm thấy job scrape shop.",
    );
  }
  if (scrapeJob.status !== "completed") {
    throw new ShopJobServiceError(
      "BAD_REQUEST",
      "Chỉ có thể nhập catalog từ job scrape đã hoàn tất.",
    );
  }

  const products = filterProductsBySourceUrls(
    asScrapedProducts(scrapeJob.products),
    input.productSourceUrls,
  );
  if (products.length === 0) {
    throw new ShopJobServiceError(
      "BAD_REQUEST",
      "Không có sản phẩm scrape để nhập.",
    );
  }

  const now = new Date().toISOString();
  const [job] = await db
    .insert(shopImportJobs)
    .values({
      id: randomUUID(),
      scrapeJobId: scrapeJob.id,
      status: "queued",
      productSourceUrls: normalizeProductSourceUrls(input.productSourceUrls),
      total: products.length,
      // Inherit the parent scrape job's tenant so the import job is owned by
      // the same tenant.
      tenantId: scrapeJob.tenantId ?? null,
      startedAt: now,
      updatedAt: now,
    })
    .returning();

  return toImportJobSnapshot(requireRow(job));
}

async function _listShopImportJobs(
  input: {
    scrapeJobId?: string;
    limit?: number;
    offset?: number;
  } = {},
  scope?: TenantScopeValue,
) {
  const limit = clampListLimit(input.limit);
  const rows = await db
    .select()
    .from(shopImportJobs)
    .where(
      and(
        input.scrapeJobId
          ? eq(shopImportJobs.scrapeJobId, input.scrapeJobId)
          : undefined,
        tenantConditionForValue(scope, shopImportJobs.tenantId),
      ),
    )
    .orderBy(
      sql`case when ${shopImportJobs.status} in ('queued', 'running') then 0 else 1 end`,
      desc(shopImportJobs.startedAt),
    )
    .limit(limit)
    .offset(Math.max(0, input.offset ?? 0));

  return rows.map(toImportJobListItem);
}

async function _getShopImportJob(jobId: string, scope?: TenantScopeValue) {
  const [job] = await db
    .select()
    .from(shopImportJobs)
    .where(
      and(
        eq(shopImportJobs.id, jobId),
        tenantConditionForValue(scope, shopImportJobs.tenantId),
      ),
    )
    .limit(1);

  return job ? toImportJobSnapshot(job) : null;
}

async function _cancelShopImportJob(
  jobId: string,
  scope?: TenantScopeValue,
) {
  // Fail closed: a customer cancelling another tenant's import gets NOT_FOUND.
  const inScope = await getShopImportJob(jobId, scope);
  if (!inScope) {
    throw new ShopJobServiceError(
      "NOT_FOUND",
      "Không tìm thấy job nhập catalog.",
    );
  }
  const now = new Date().toISOString();
  const [cancelled] = await db
    .update(shopImportJobs)
    .set({
      status: "cancelled",
      currentProductName: null,
      currentSourceUrl: null,
      finishedAt: now,
      lastProgressAt: now,
      expiresAt: await expiresAt(now),
      durationMs: sql<number>`greatest(0, floor(extract(epoch from (${now}::timestamptz - ${shopImportJobs.startedAt})) * 1000))::int`,
      updatedAt: now,
    })
    .where(
      and(
        eq(shopImportJobs.id, jobId),
        inArray(shopImportJobs.status, ACTIVE_JOB_STATUSES),
      ),
    )
    .returning();

  if (cancelled) {
    abortShopImportJob(jobId);
    return toImportJobSnapshot(cancelled);
  }

  return getShopImportJob(jobId);
}

function toImportJobListItem(row: ShopImportJobRow): ShopImportJobListItem {
  const { items: _items, ...snapshot } = toImportJobSnapshot(row);
  void _items;
  return snapshot;
}

function toImportJobSnapshot(row: ShopImportJobRow): ShopImportJobSnapshot {
  return {
    id: row.id,
    scrapeJobId: row.scrapeJobId,
    status: row.status,
    processed: row.processed,
    total: row.total,
    created: row.created,
    updated: row.updated,
    skipped: row.skipped,
    failed: row.failed,
    items: asImportItems(row.items),
    productSourceUrls: row.productSourceUrls,
    currentProductName: row.currentProductName,
    currentSourceUrl: row.currentSourceUrl,
    durationMs: row.durationMs,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    lastProgressAt: row.lastProgressAt,
    expiresAt: row.expiresAt,
    error: row.error,
  };
}

function normalizeProductSourceUrls(sourceUrls: string[] | undefined) {
  if (!sourceUrls) {
    return null;
  }
  return Array.from(
    new Set(sourceUrls.map((url) => url.trim()).filter(Boolean)),
  );
}

function filterProductsBySourceUrls(
  products: ScrapedShopProduct[],
  sourceUrls: string[] | undefined,
) {
  const normalized = normalizeProductSourceUrls(sourceUrls);
  if (!normalized) {
    return products;
  }

  const sourceUrlSet = new Set(normalized);
  return products.filter((product) => sourceUrlSet.has(product.sourceUrl));
}

function asScrapedProducts(value: unknown): ScrapedShopProduct[] {
  return Array.isArray(value) ? (value as ScrapedShopProduct[]) : [];
}

function asImportItems(value: unknown): ShopImportJobItem[] {
  return Array.isArray(value) ? (value as ShopImportJobItem[]) : [];
}

async function expiresAt(finishedAtIso: string) {
  const ttlDays = await resolveScrapeJobTtlDays();
  return new Date(
    new Date(finishedAtIso).getTime() + ttlDays * 86_400_000,
  ).toISOString();
}

function clampListLimit(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return DEFAULT_LIST_LIMIT;
  }
  return Math.min(MAX_LIST_LIMIT, Math.max(1, Math.trunc(value ?? 0)));
}

function requireRow(row: ShopImportJobRow | undefined) {
  if (!row) {
    throw new Error("Không thể tạo job nhập catalog.");
  }
  return row;
}

export const startShopImportJob = traceFn(log, "startShopImportJob", _startShopImportJob);
export const listShopImportJobs = traceFn(log, "listShopImportJobs", _listShopImportJobs);
export const getShopImportJob = traceFn(log, "getShopImportJob", _getShopImportJob);
export const cancelShopImportJob = traceFn(log, "cancelShopImportJob", _cancelShopImportJob);
