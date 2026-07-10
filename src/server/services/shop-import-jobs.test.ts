import { describe, expect, it } from "vitest";

import {
  filterProductsBySourceUrls,
  isImportableScrapeJobStatus,
  normalizeProductSourceUrls,
} from "~/server/services/shop-import-source";
import type { ScrapedShopProduct } from "~/server/services/shop-material-scraper";

describe("shop import eligibility", () => {
  it("allows import from completed, failed, and cancelled scrape jobs", () => {
    expect(isImportableScrapeJobStatus("completed")).toBe(true);
    expect(isImportableScrapeJobStatus("failed")).toBe(true);
    expect(isImportableScrapeJobStatus("cancelled")).toBe(true);
    expect(isImportableScrapeJobStatus("running")).toBe(false);
  });

  it("keeps all mode distinct from every explicit selected URL array", () => {
    expect(normalizeProductSourceUrls(undefined)).toBeNull();
    expect(normalizeProductSourceUrls([])).toEqual([]);
    expect(
      normalizeProductSourceUrls([
        " https://example.com/a ",
        "",
        "https://example.com/a",
      ]),
    ).toEqual(["https://example.com/a"]);

    const products = [
      { sourceUrl: "https://example.com/a" },
      { sourceUrl: "https://example.com/b" },
    ] as ScrapedShopProduct[];
    expect(filterProductsBySourceUrls(products, undefined)).toEqual(products);
    expect(filterProductsBySourceUrls(products, [])).toEqual([]);
  });
});
