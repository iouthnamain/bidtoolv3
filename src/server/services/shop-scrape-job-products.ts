import "server-only";

import { asc, eq } from "drizzle-orm";

import { db } from "~/server/db";
import { shopScrapeJobProducts } from "~/server/db/schema";
import { sanitizeScrapedProductList } from "~/lib/materials/shop-promo-badges";
import type { ScrapedShopProduct } from "~/server/services/shop-material-scraper";

export async function loadScrapeJobProducts(
  jobId: string,
  fallbackProducts: unknown,
) {
  const rows = await db
    .select({ productJson: shopScrapeJobProducts.productJson })
    .from(shopScrapeJobProducts)
    .where(eq(shopScrapeJobProducts.jobId, jobId))
    .orderBy(asc(shopScrapeJobProducts.sortOrder), asc(shopScrapeJobProducts.id));

  if (rows.length > 0) {
    return sanitizeScrapedProductList(
      rows.map((row) => row.productJson) as ScrapedShopProduct[],
    );
  }

  if (!Array.isArray(fallbackProducts)) {
    return [];
  }

  return sanitizeScrapedProductList(fallbackProducts as ScrapedShopProduct[]);
}

export async function replaceScrapeJobProducts(
  jobId: string,
  products: ScrapedShopProduct[],
) {
  const sanitizedProducts = sanitizeScrapedProductList(products);
  await db
    .delete(shopScrapeJobProducts)
    .where(eq(shopScrapeJobProducts.jobId, jobId));

  if (sanitizedProducts.length > 0) {
    const now = new Date().toISOString();
    await db.insert(shopScrapeJobProducts).values(
      sanitizedProducts.map((product, index) => ({
        jobId,
        sourceUrl: product.sourceUrl,
        sortOrder: index,
        productJson: product,
        createdAt: now,
        updatedAt: now,
      })),
    );
  }

  return sanitizedProducts;
}
