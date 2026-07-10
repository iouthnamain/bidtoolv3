import "server-only";

import { and, eq } from "drizzle-orm";

import {
  tenantConditionForValue,
  type TenantScopeValue,
} from "~/server/api/tenant-scope";
import { db } from "~/server/db";
import { shopScrapeJobs } from "~/server/db/schema";
import { ShopJobServiceError } from "~/server/services/shop-job-errors";
import type { ScrapedShopProduct } from "~/server/services/shop-material-scraper";
import { loadScrapeJobProducts } from "~/server/services/shop-scrape-job-products";

const IMPORTABLE_SCRAPE_JOB_STATUSES = [
  "completed",
  "failed",
  "cancelled",
] as const;

export function isImportableScrapeJobStatus(status: string) {
  return IMPORTABLE_SCRAPE_JOB_STATUSES.includes(
    status as (typeof IMPORTABLE_SCRAPE_JOB_STATUSES)[number],
  );
}

export type ShopImportMode = "create_all" | "match_existing";

export function normalizeProductSourceUrls(sourceUrls: string[] | undefined) {
  if (sourceUrls === undefined) {
    return null;
  }
  return Array.from(
    new Set(sourceUrls.map((url) => url.trim()).filter(Boolean)),
  );
}

export function filterProductsBySourceUrls(
  products: ScrapedShopProduct[],
  sourceUrls: string[] | undefined,
) {
  const normalized = normalizeProductSourceUrls(sourceUrls);
  if (normalized === null) {
    return products;
  }

  const sourceUrlSet = new Set(normalized);
  return products.filter((product) => sourceUrlSet.has(product.sourceUrl));
}

export async function loadShopImportSource(
  input: {
    scrapeJobId: string;
    productSourceUrls?: string[];
  },
  operation: "import" | "preview",
  scope?: TenantScopeValue,
) {
  const [scrapeJob] = await db
    .select({
      id: shopScrapeJobs.id,
      status: shopScrapeJobs.status,
      products: shopScrapeJobs.products,
      tenantId: shopScrapeJobs.tenantId,
      expiresAt: shopScrapeJobs.expiresAt,
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
  if (!isImportableScrapeJobStatus(scrapeJob.status)) {
    throw new ShopJobServiceError(
      "BAD_REQUEST",
      operation === "import"
        ? "Chỉ có thể nhập catalog từ job scrape đã dừng (hoàn tất, lỗi hoặc hủy)."
        : "Chỉ có thể xem trước nhập catalog từ job scrape đã dừng.",
    );
  }
  if (
    scrapeJob.expiresAt &&
    new Date(scrapeJob.expiresAt).getTime() < Date.now()
  ) {
    throw new ShopJobServiceError("BAD_REQUEST", "Job scrape đã hết hạn.");
  }

  const productSourceUrls = normalizeProductSourceUrls(input.productSourceUrls);
  const mode: ShopImportMode =
    productSourceUrls === null ? "create_all" : "match_existing";
  const products = filterProductsBySourceUrls(
    await loadScrapeJobProducts(scrapeJob.id, scrapeJob.products),
    input.productSourceUrls,
  );
  if (products.length === 0) {
    throw new ShopJobServiceError(
      "BAD_REQUEST",
      operation === "import"
        ? "Không có sản phẩm scrape để nhập."
        : "Không có sản phẩm scrape để xem trước.",
    );
  }

  return {
    scrapeJob,
    products,
    productSourceUrls,
    mode,
  };
}
