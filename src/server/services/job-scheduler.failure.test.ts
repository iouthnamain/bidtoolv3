import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ScrapedShopProduct } from "~/server/services/shop-material-scraper";

const mocks = vi.hoisted(() => {
  const patches: Array<Record<string, unknown>> = [];
  const where = vi.fn().mockResolvedValue(undefined);

  return {
    patches,
    scrapeShopMaterialsFromUrl: vi.fn(),
    replaceScrapeJobProducts: vi.fn(),
    resolveScrapeJobTtlDays: vi.fn(),
    resolveScrapeMaxConcurrentPages: vi.fn(),
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([{ status: "running" }]),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn((patch: Record<string, unknown>) => {
          patches.push(patch);
          return { where };
        }),
      })),
    },
  };
});

vi.mock("~/server/db", () => ({ db: mocks.db }));
vi.mock("~/server/services/app-settings", () => ({
  resolveScrapeJobTtlDays: mocks.resolveScrapeJobTtlDays,
  resolveScrapeMaxConcurrentPages: mocks.resolveScrapeMaxConcurrentPages,
}));
vi.mock("~/server/services/shop-material-scraper", () => ({
  scrapeShopMaterialsFromUrl: mocks.scrapeShopMaterialsFromUrl,
}));
vi.mock("~/server/services/shop-scrape-job-products", () => ({
  loadScrapeJobProducts: vi.fn(),
  replaceScrapeJobProducts: mocks.replaceScrapeJobProducts,
}));

import { runShopScrapeJobForTests, stopJobSchedulerForTests } from "./job-scheduler";
import {
  resolveScrapeJobTtlDays,
  resolveScrapeMaxConcurrentPages,
} from "~/server/services/app-settings";
import { replaceScrapeJobProducts } from "~/server/services/shop-scrape-job-products";
import { scrapeShopMaterialsFromUrl } from "~/server/services/shop-material-scraper";

const partialProduct: ScrapedShopProduct = {
  name: "Ống PVC D50",
  unit: "m",
  category: "Ống nước",
  specText: "D50",
  manufacturer: null,
  originCountry: null,
  price: null,
  priceText: null,
  currency: "VND",
  sourceUrl: "https://shop.example.com/pvc-d50",
  imageUrl: null,
  sku: null,
  model: null,
  availability: null,
  shopCategory: null,
  catalogPdfUrls: [],
};

describe("shop scrape terminal failure", () => {
  beforeEach(() => {
    mocks.patches.length = 0;
    vi.mocked(resolveScrapeMaxConcurrentPages).mockResolvedValue(1);
    vi.mocked(resolveScrapeJobTtlDays).mockResolvedValue(7);
    vi.mocked(replaceScrapeJobProducts).mockImplementation(
      async (_jobId, products) => products,
    );
    vi.mocked(scrapeShopMaterialsFromUrl).mockImplementation(
      async ({ onProgress }) => {
        onProgress?.({
          status: "extracting",
          currentUrl: partialProduct.sourceUrl,
          currentUrls: [partialProduct.sourceUrl],
          pagesVisited: ["https://shop.example.com/category"],
          failedPages: [],
          productCount: 1,
          queueLength: 0,
          maxPages: null,
          maxProducts: 5,
          method: "auto",
          elapsedMs: 120,
          products: [partialProduct],
        });
        throw new Error("network down");
      },
    );
  });

  afterEach(() => {
    stopJobSchedulerForTests();
  });

  it("keeps the latest products and a recoverable status after a scrape error", async () => {
    const job = {
      id: "00000000-0000-4000-8000-000000000101",
      url: "https://shop.example.com/category",
      maxPages: null,
      maxProducts: 5,
      method: "auto",
      detailEnrichment: "none",
    } as Parameters<typeof runShopScrapeJobForTests>[0];

    await runShopScrapeJobForTests(job);

    expect(replaceScrapeJobProducts).toHaveBeenCalledWith(job.id, [partialProduct]);
    expect(mocks.patches).toContainEqual(
      expect.objectContaining({ productCount: 1 }),
    );
    expect(
      mocks.patches.find((patch) => patch.status === "failed"),
    ).toEqual(
      expect.objectContaining({
        status: "failed",
        stopReason: "error",
        error: "network down",
        message: "Đã dừng sau 1/5 sản phẩm. Kiểm tra URL shop rồi thử lại.",
      }),
    );
  });
});
