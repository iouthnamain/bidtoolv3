import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "~/server/db";
import {
  tenantConditionForValue,
  type TenantScopeValue,
} from "~/server/api/tenant-scope";
import { shopScrapeJobs } from "~/server/db/schema";
import { resolveScrapeJobTtlDays } from "~/server/services/app-settings";
import {
  abortShopScrapeJob,
  isShopScrapeJobActivelyRunning,
} from "~/server/services/job-scheduler";
import { ShopJobServiceError } from "~/server/services/shop-job-errors";
import {
  sanitizeScrapedProductList,
  sanitizeScrapedProductName,
} from "~/lib/materials/shop-promo-badges";
import {
  type ScrapedShopProduct,
  type ShopDetailEnrichmentMode,
  type ShopScrapeMethod,
  type ShopScrapeStopReason,
} from "~/server/services/shop-material-scraper";

export type ShopScrapeJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type ShopScrapeJobSnapshot = {
  id: string;
  status: ShopScrapeJobStatus;
  url: string;
  normalizedUrl: string;
  scrapeMode: "limited" | "all";
  maxPages: number | null;
  maxProducts: number | null;
  method: ShopScrapeMethod;
  detailEnrichment: ShopDetailEnrichmentMode;
  currentUrl: string | null;
  currentUrls: string[];
  pagesVisited: string[];
  failedPages: Array<{ url: string; message: string }>;
  products: ScrapedShopProduct[];
  productCount: number;
  queueLength: number;
  durationMs: number | null;
  stopReason:
    | (ShopScrapeStopReason | "timeout" | "cancelled" | "error" | "expired")
    | null;
  message: string | null;
  lastProgressAt: string | null;
  startedAt: string;
  finishedAt: string | null;
  expiresAt: string | null;
  error: string | null;
  isExpired: boolean;
  productsEditable: boolean;
};

export type ShopScrapeJobListItem = Omit<ShopScrapeJobSnapshot, "products">;

type ShopScrapeJobRow = typeof shopScrapeJobs.$inferSelect;

const ACTIVE_JOB_STATUSES: ShopScrapeJobStatus[] = ["queued", "running"];
const DEFAULT_LIST_LIMIT = 25;
const MAX_LIST_LIMIT = 100;

export async function startShopScrapeJob(input: {
  url: string;
  scrapeMode: "limited" | "all";
  maxPages: number | null;
  maxProducts: number | null;
  method: ShopScrapeMethod;
  detailEnrichment: ShopDetailEnrichmentMode;
  // Tenant attribution for the created job (creator's tenant; null for internal).
  tenantId?: string | null;
}) {
  const normalizedUrl = normalizeShopScrapeUrl(input.url);
  const [duplicate] = await db
    .select({ id: shopScrapeJobs.id, status: shopScrapeJobs.status })
    .from(shopScrapeJobs)
    .where(
      and(
        eq(shopScrapeJobs.normalizedUrl, normalizedUrl),
        inArray(shopScrapeJobs.status, ACTIVE_JOB_STATUSES),
      ),
    )
    .limit(1);

  if (duplicate) {
    throw new ShopJobServiceError(
      "CONFLICT",
      "URL shop này đang có job scrape trong hàng chờ hoặc đang chạy.",
    );
  }

  const now = new Date().toISOString();
  try {
    const [job] = await db
      .insert(shopScrapeJobs)
      .values({
        id: randomUUID(),
        url: input.url.trim(),
        normalizedUrl,
        status: "queued",
        scrapeMode: input.scrapeMode,
        maxPages: input.maxPages,
        maxProducts: input.maxProducts,
        method: input.method,
        detailEnrichment: input.detailEnrichment,
        message: "Đang xếp hàng chờ scrape.",
        tenantId: input.tenantId ?? null,
        startedAt: now,
        updatedAt: now,
      })
      .returning();

    return toScrapeJobSnapshot(requireRow(job));
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ShopJobServiceError(
        "CONFLICT",
        "URL shop này đang có job scrape trong hàng chờ hoặc đang chạy.",
      );
    }
    throw error;
  }
}

export async function listShopScrapeJobs(
  input: {
    limit?: number;
    offset?: number;
  } = {},
  scope?: TenantScopeValue,
) {
  const limit = clampListLimit(input.limit);
  const rows = await db
    .select()
    .from(shopScrapeJobs)
    .where(tenantConditionForValue(scope, shopScrapeJobs.tenantId))
    .orderBy(
      sql`case when ${shopScrapeJobs.status} in ('queued', 'running') then 0 else 1 end`,
      desc(shopScrapeJobs.startedAt),
    )
    .limit(limit)
    .offset(Math.max(0, input.offset ?? 0));

  return rows.map(toScrapeJobListItem);
}

export async function getShopScrapeJob(jobId: string, scope?: TenantScopeValue) {
  const [job] = await db
    .select()
    .from(shopScrapeJobs)
    .where(
      and(
        eq(shopScrapeJobs.id, jobId),
        tenantConditionForValue(scope, shopScrapeJobs.tenantId),
      ),
    )
    .limit(1);

  return job ? toScrapeJobSnapshot(job) : null;
}

export async function cancelShopScrapeJob(
  jobId: string,
  scope?: TenantScopeValue,
) {
  // Fail closed: a customer cancelling another tenant's job gets NOT_FOUND.
  const inScope = await getShopScrapeJob(jobId, scope);
  if (!inScope) {
    throw new ShopJobServiceError(
      "NOT_FOUND",
      "Không tìm thấy job scrape shop.",
    );
  }
  const now = new Date().toISOString();
  const [cancelled] = await db
    .update(shopScrapeJobs)
    .set({
      status: "cancelled",
      currentUrls: [],
      finishedAt: now,
      lastProgressAt: now,
      expiresAt: await expiresAt(now),
      stopReason: "cancelled",
      message: "Job scrape đã bị hủy.",
      durationMs: sql<number>`greatest(0, floor(extract(epoch from (${now}::timestamptz - ${shopScrapeJobs.startedAt})) * 1000))::int`,
      updatedAt: now,
    })
    .where(
      and(
        eq(shopScrapeJobs.id, jobId),
        inArray(shopScrapeJobs.status, ACTIVE_JOB_STATUSES),
      ),
    )
    .returning();

  if (cancelled) {
    abortShopScrapeJob(jobId);
    return toScrapeJobSnapshot(cancelled);
  }

  return getShopScrapeJob(jobId);
}

const EDITABLE_SCRAPE_JOB_STATUSES: ShopScrapeJobStatus[] = [
  "completed",
  "failed",
  "cancelled",
];

export function isScrapeJobProductsEditable(job: {
  id: string;
  status: ShopScrapeJobStatus;
  products: ScrapedShopProduct[];
  isExpired: boolean;
}) {
  if (job.isExpired) {
    return false;
  }
  if (EDITABLE_SCRAPE_JOB_STATUSES.includes(job.status)) {
    return true;
  }
  return (
    job.products.length > 0 && !isShopScrapeJobActivelyRunning(job.id)
  );
}

function assertScrapeJobProductsEditable(job: ShopScrapeJobSnapshot) {
  if (!isScrapeJobProductsEditable(job)) {
    if (job.isExpired) {
      throw new ShopJobServiceError("BAD_REQUEST", "Job scrape đã hết hạn.");
    }
    if (isShopScrapeJobActivelyRunning(job.id)) {
      throw new ShopJobServiceError(
        "BAD_REQUEST",
        "Chỉ chỉnh sửa sản phẩm sau khi job scrape dừng lại.",
      );
    }
    throw new ShopJobServiceError(
      "BAD_REQUEST",
      "Job scrape không thể chỉnh sửa sản phẩm.",
    );
  }
}

function trimmedOrNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? null : trimmed;
}

function normalizeScrapedProductInput(
  product: ScrapedShopProduct,
): ScrapedShopProduct {
  const name = sanitizeScrapedProductName(product.name) ?? product.name.trim();
  return {
    name,
    unit: trimmedOrNull(product.unit),
    category: trimmedOrNull(product.category),
    specText: product.specText.trim(),
    manufacturer: trimmedOrNull(product.manufacturer),
    originCountry: trimmedOrNull(product.originCountry),
    price: product.price ?? null,
    priceText: trimmedOrNull(product.priceText),
    currency: trimmedOrNull(product.currency) ?? "VND",
    sourceUrl: product.sourceUrl.trim(),
    imageUrl: trimmedOrNull(product.imageUrl),
    sku: trimmedOrNull(product.sku),
    model: trimmedOrNull(product.model),
    availability: trimmedOrNull(product.availability),
    shopCategory: trimmedOrNull(product.shopCategory),
    catalogPdfUrls: Array.isArray(product.catalogPdfUrls)
      ? product.catalogPdfUrls.map((url) => url.trim()).filter(Boolean)
      : [],
  };
}

async function persistScrapeJobProducts(jobId: string, products: ScrapedShopProduct[]) {
  const sanitizedProducts = sanitizeScrapedProductList(products);
  const now = new Date().toISOString();
  const [updated] = await db
    .update(shopScrapeJobs)
    .set({
      products: sanitizedProducts,
      productCount: sanitizedProducts.length,
      updatedAt: now,
    })
    .where(eq(shopScrapeJobs.id, jobId))
    .returning();

  return toScrapeJobSnapshot(requireRow(updated));
}

export async function updateShopScrapeJobProduct(
  input: {
    jobId: string;
    sourceUrl: string;
    product: ScrapedShopProduct;
  },
  scope?: TenantScopeValue,
) {
  const job = await getShopScrapeJob(input.jobId, scope);
  if (!job) {
    throw new ShopJobServiceError(
      "NOT_FOUND",
      "Không tìm thấy job scrape shop.",
    );
  }
  assertScrapeJobProductsEditable(job);

  const products = [...job.products];
  const index = products.findIndex(
    (product) => product.sourceUrl === input.sourceUrl,
  );
  if (index < 0) {
    throw new ShopJobServiceError(
      "NOT_FOUND",
      "Không tìm thấy sản phẩm trong job scrape.",
    );
  }

  const nextProduct = normalizeScrapedProductInput(input.product);
  if (!nextProduct.name) {
    throw new ShopJobServiceError("BAD_REQUEST", "Tên sản phẩm không được để trống.");
  }
  if (!nextProduct.sourceUrl) {
    throw new ShopJobServiceError("BAD_REQUEST", "URL nguồn không được để trống.");
  }
  if (
    nextProduct.sourceUrl !== input.sourceUrl &&
    products.some((product) => product.sourceUrl === nextProduct.sourceUrl)
  ) {
    throw new ShopJobServiceError(
      "CONFLICT",
      "URL nguồn đã tồn tại trong job scrape.",
    );
  }

  products[index] = nextProduct;
  return persistScrapeJobProducts(input.jobId, products);
}

export async function deleteShopScrapeJobProduct(
  input: {
    jobId: string;
    sourceUrl: string;
  },
  scope?: TenantScopeValue,
) {
  const job = await getShopScrapeJob(input.jobId, scope);
  if (!job) {
    throw new ShopJobServiceError(
      "NOT_FOUND",
      "Không tìm thấy job scrape shop.",
    );
  }
  assertScrapeJobProductsEditable(job);

  const products = job.products.filter(
    (product) => product.sourceUrl !== input.sourceUrl,
  );
  if (products.length === job.products.length) {
    throw new ShopJobServiceError(
      "NOT_FOUND",
      "Không tìm thấy sản phẩm trong job scrape.",
    );
  }

  return persistScrapeJobProducts(input.jobId, products);
}

export async function deleteShopScrapeJobProducts(
  input: {
    jobId: string;
    sourceUrls: string[];
  },
  scope?: TenantScopeValue,
) {
  const job = await getShopScrapeJob(input.jobId, scope);
  if (!job) {
    throw new ShopJobServiceError(
      "NOT_FOUND",
      "Không tìm thấy job scrape shop.",
    );
  }
  assertScrapeJobProductsEditable(job);

  const uniqueSourceUrls = [
    ...new Set(input.sourceUrls.map((url) => url.trim()).filter(Boolean)),
  ];
  if (uniqueSourceUrls.length === 0) {
    throw new ShopJobServiceError(
      "BAD_REQUEST",
      "Chọn ít nhất một sản phẩm để xóa.",
    );
  }

  const urlsToDelete = new Set(uniqueSourceUrls);
  const products = job.products.filter(
    (product) => !urlsToDelete.has(product.sourceUrl),
  );
  const removedCount = job.products.length - products.length;
  if (removedCount === 0) {
    throw new ShopJobServiceError(
      "NOT_FOUND",
      "Không tìm thấy sản phẩm đã chọn trong job scrape.",
    );
  }

  const snapshot = await persistScrapeJobProducts(input.jobId, products);
  return { job: snapshot, removedCount };
}

export async function addShopScrapeJobProduct(
  input: {
    jobId: string;
    product: ScrapedShopProduct;
  },
  scope?: TenantScopeValue,
) {
  const job = await getShopScrapeJob(input.jobId, scope);
  if (!job) {
    throw new ShopJobServiceError(
      "NOT_FOUND",
      "Không tìm thấy job scrape shop.",
    );
  }
  assertScrapeJobProductsEditable(job);

  const nextProduct = normalizeScrapedProductInput(input.product);
  if (!nextProduct.name) {
    throw new ShopJobServiceError("BAD_REQUEST", "Tên sản phẩm không được để trống.");
  }
  if (!nextProduct.sourceUrl) {
    throw new ShopJobServiceError("BAD_REQUEST", "URL nguồn không được để trống.");
  }
  if (job.products.some((product) => product.sourceUrl === nextProduct.sourceUrl)) {
    throw new ShopJobServiceError(
      "CONFLICT",
      "URL nguồn đã tồn tại trong job scrape.",
    );
  }

  return persistScrapeJobProducts(input.jobId, [...job.products, nextProduct]);
}

export async function deleteShopScrapeJob(
  jobId: string,
  scope?: TenantScopeValue,
) {
  const existing = await getShopScrapeJob(jobId, scope);
  if (!existing) {
    return null;
  }
  if (ACTIVE_JOB_STATUSES.includes(existing.status)) {
    throw new ShopJobServiceError(
      "BAD_REQUEST",
      "Hãy hủy job scrape trước khi xóa khỏi danh sách.",
    );
  }

  const [deleted] = await db
    .delete(shopScrapeJobs)
    .where(eq(shopScrapeJobs.id, jobId))
    .returning();

  return deleted ? toScrapeJobSnapshot(deleted) : existing;
}

export function normalizeShopScrapeUrl(input: string) {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new ShopJobServiceError("BAD_REQUEST", "URL shop không hợp lệ.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new ShopJobServiceError(
      "BAD_REQUEST",
      "Chỉ hỗ trợ URL shop http hoặc https.",
    );
  }

  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.hash = "";
  parsed.username = "";
  parsed.password = "";
  parsed.searchParams.sort();
  parsed.pathname =
    parsed.pathname.length > 1
      ? parsed.pathname.replace(/\/+$/g, "") || "/"
      : parsed.pathname;

  return parsed.toString();
}

function toScrapeJobListItem(row: ShopScrapeJobRow): ShopScrapeJobListItem {
  const { products: _products, ...snapshot } = toScrapeJobSnapshot(row);
  void _products;
  return snapshot;
}

function toScrapeJobSnapshot(row: ShopScrapeJobRow): ShopScrapeJobSnapshot {
  const products = asScrapedProducts(row.products);
  const currentUrls = Array.isArray(row.currentUrls) ? row.currentUrls : [];
  const snapshot: ShopScrapeJobSnapshot = {
    id: row.id,
    status: row.status,
    url: row.url,
    normalizedUrl: row.normalizedUrl,
    scrapeMode: row.scrapeMode === "all" ? "all" : "limited",
    maxPages: row.maxPages,
    maxProducts: row.maxProducts,
    method: asScrapeMethod(row.method),
    detailEnrichment: asDetailEnrichment(row.detailEnrichment),
    currentUrl: currentUrls[0] ?? null,
    currentUrls,
    pagesVisited: Array.isArray(row.pagesVisited) ? row.pagesVisited : [],
    failedPages: Array.isArray(row.failedPages) ? row.failedPages : [],
    products,
    productCount: products.length,
    queueLength: row.queueLength,
    durationMs: row.durationMs,
    stopReason: asStopReason(row.stopReason),
    message: row.message,
    lastProgressAt: row.lastProgressAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    expiresAt: row.expiresAt,
    error: row.error,
    isExpired: row.expiresAt
      ? new Date(row.expiresAt).getTime() < Date.now()
      : false,
    productsEditable: false,
  };
  snapshot.productsEditable = isScrapeJobProductsEditable(snapshot);
  return snapshot;
}

function asScrapedProducts(value: unknown): ScrapedShopProduct[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return sanitizeScrapedProductList(value as ScrapedShopProduct[]);
}

function asScrapeMethod(value: string): ShopScrapeMethod {
  return value === "json_ld" || value === "dom_cards" ? value : "auto";
}

function asDetailEnrichment(value: string): ShopDetailEnrichmentMode {
  return value === "missing_fields" ? "missing_fields" : "none";
}

function asStopReason(
  value: string | null,
): ShopScrapeJobSnapshot["stopReason"] {
  if (
    value === "queue_empty" ||
    value === "page_limit" ||
    value === "product_limit" ||
    value === "timeout" ||
    value === "cancelled" ||
    value === "error" ||
    value === "expired"
  ) {
    return value;
  }
  return null;
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

function requireRow(row: ShopScrapeJobRow | undefined) {
  if (!row) {
    throw new Error("Không thể tạo job scrape shop.");
  }
  return row;
}

function isUniqueViolation(error: unknown) {
  let current: unknown = error;
  while (current && typeof current === "object") {
    if ("code" in current && current.code === "23505") {
      return true;
    }
    current = "cause" in current ? current.cause : null;
  }
  return false;
}
