import { describe, expect, it } from "vitest";

import {
  closeShopScraperBrowser,
  scrapeShopMaterialsFromUrl,
} from "~/server/services/shop-material-scraper";

const LIVE_SCRAPE_REVIEW = process.env.LIVE_SCRAPE_REVIEW === "1";
const REVIEW_URLS = (process.env.LIVE_SCRAPE_REVIEW_URLS ?? "")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);

describe.skipIf(!LIVE_SCRAPE_REVIEW || REVIEW_URLS.length === 0)(
  "live shop compatibility review",
  () => {
    it(
      "prints one-page scrape summaries",
      async () => {
        const summaries = [];
        try {
          for (const url of REVIEW_URLS) {
            const started = Date.now();
            try {
              const result = await scrapeShopMaterialsFromUrl({
                url,
                maxPages: 1,
                maxProducts: 80,
                method: "auto",
                concurrentPages: 1,
              });
              summaries.push({
                url,
                count: result.products.length,
                failedPages: result.failedPages,
                durationMs: Date.now() - started,
                sample: result.products.slice(0, 12).map((product) => ({
                  name: product.name,
                  price: product.price,
                  priceText: product.priceText,
                  unit: product.unit,
                  sourceUrl: product.sourceUrl,
                })),
              });
            } catch (error) {
              summaries.push({
                url,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        } finally {
          await closeShopScraperBrowser();
        }

        console.log(JSON.stringify(summaries, null, 2));
        expect(summaries).toHaveLength(REVIEW_URLS.length);
      },
      180_000,
    );
  },
);
