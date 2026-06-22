import { and, eq } from "drizzle-orm";

import { db } from "~/server/db";
import {
  tenantConditionForValue,
  type TenantScopeValue,
} from "~/server/api/tenant-scope";
import { shopScrapeJobs } from "~/server/db/schema";
import { ShopJobServiceError } from "~/server/services/shop-job-errors";
import {
  filterProductsBySourceUrls,
} from "~/server/services/shop-import-jobs";
import { previewShopImportProducts } from "~/server/services/shop-product-importer";
import type { ScrapedShopProduct } from "~/server/services/shop-material-scraper";
import { createLogger, traceFn } from "~/server/lib/logger";

const log = createLogger("services-shop-import-preview");

const IMPORTABLE_SCRAPE_JOB_STATUSES = [
  "completed",
  "failed",
  "cancelled",
] as const;

async function _previewShopImportJob(
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
  if (
    !IMPORTABLE_SCRAPE_JOB_STATUSES.includes(
      scrapeJob.status as (typeof IMPORTABLE_SCRAPE_JOB_STATUSES)[number],
    )
  ) {
    throw new ShopJobServiceError(
      "BAD_REQUEST",
      "Chỉ có thể xem trước nhập catalog từ job scrape đã dừng.",
    );
  }
  if (
    scrapeJob.expiresAt &&
    new Date(scrapeJob.expiresAt).getTime() < Date.now()
  ) {
    throw new ShopJobServiceError("BAD_REQUEST", "Job scrape đã hết hạn.");
  }

  const products = filterProductsBySourceUrls(
    asScrapedProducts(scrapeJob.products),
    input.productSourceUrls,
  );
  if (products.length === 0) {
    throw new ShopJobServiceError(
      "BAD_REQUEST",
      "Không có sản phẩm scrape để xem trước.",
    );
  }

  return previewShopImportProducts(db, products);
}

function asScrapedProducts(value: unknown): ScrapedShopProduct[] {
  return Array.isArray(value) ? (value as ScrapedShopProduct[]) : [];
}

export const previewShopImportJob = traceFn(
  log,
  "previewShopImportJob",
  _previewShopImportJob,
);
