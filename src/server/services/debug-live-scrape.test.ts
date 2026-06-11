import { chromium } from "playwright";
import { describe, expect, it } from "vitest";

import {
  closeShopScraperBrowser,
  collectShopPageSnapshot,
  extractProductsFromPageSnapshot,
  scrapeShopMaterialsFromUrl,
  SHOP_PROMO_BADGE_LABELS,
} from "~/server/services/shop-material-scraper";

const TARGET_URL =
  "https://codienhaiau.com/category/dong-ho-do/dong-ho-do-tan-so/";

const EXPECTED_PRODUCTS = [
  "Đồng hồ đo đa năng Selec VAF36A 96x96mm",
  "Đồng hồ đo tần số Selec MF16 96x48mm",
  "Đồng hồ đo tần số Selec MF316 96x96mm",
  "Đồng hồ đo tần số Selec MF216 72x72mm",
  "Đồng hồ đo đa năng Selec VAF39A 96x96mm",
  "Đồng hồ đo tần số Taiwan Meters 72x72mm",
  "Đồng hồ đo tần số Taiwan Meters 96x96mm",
  "Đồng hồ đo tần số Selec MA316 96x96mm",
];

const LIVE_SCRAPE = process.env.LIVE_SCRAPE === "1";

describe.skipIf(!LIVE_SCRAPE)("live codienhaiau scrape", () => {
  it("collects 8 products from category page", async () => {
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
      executablePath: "/usr/bin/google-chrome-stable",
    });
    const context = await browser.newContext({
      locale: "vi-VN",
      viewport: { width: 1366, height: 900 },
    });
    await context.route("**/*", async (route) => {
      const type = route.request().resourceType();
      if (["font", "image", "media"].includes(type)) {
        await route.abort();
        return;
      }
      await route.continue();
    });
    const page = await context.newPage();
    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(250);

    const snapshot = await page.evaluate(collectShopPageSnapshot, {
      promoBadgeLabels: [...SHOP_PROMO_BADGE_LABELS],
    });

    const productsAuto = extractProductsFromPageSnapshot(snapshot, "auto");

    await browser.close();

    expect(snapshot.cards).toHaveLength(8);
    expect(productsAuto).toHaveLength(8);
    expect(productsAuto.map((p) => p.name).sort()).toEqual(
      [...EXPECTED_PRODUCTS].sort(),
    );
    for (const product of productsAuto) {
      expect(product.sourceUrl).toMatch(/\/product\//);
      expect(product.name).not.toMatch(/^Thịnh thành$/);
    }
  }, 60_000);

  it("returns 8 products through scrapeShopMaterialsFromUrl", async () => {
    const result = await scrapeShopMaterialsFromUrl({
      url: TARGET_URL,
      maxPages: 1,
      maxProducts: 100,
      method: "auto",
    });

    expect(result.products).toHaveLength(8);
    expect(result.products.map((p) => p.name).sort()).toEqual(
      [...EXPECTED_PRODUCTS].sort(),
    );

    await closeShopScraperBrowser();
  }, 120_000);
});
