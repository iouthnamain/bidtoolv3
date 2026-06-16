import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScrapedShopProduct } from "~/server/services/shop-material-scraper";

vi.mock("~/server/services/job-scheduler", () => ({
  abortShopScrapeJob: vi.fn(),
  isShopScrapeJobActivelyRunning: vi.fn(),
}));

vi.mock("~/server/db", () => ({
  db: {},
}));

vi.mock("~/env", () => ({
  env: {
    SCRAPE_JOB_TTL_DAYS: 7,
  },
}));

import { isShopScrapeJobActivelyRunning } from "~/server/services/job-scheduler";
import { isScrapeJobProductsEditable } from "~/server/services/shop-scrape-jobs";

const sampleProduct: ScrapedShopProduct = {
  name: "Ống PVC",
  unit: "m",
  category: null,
  specText: "DN50",
  manufacturer: null,
  originCountry: null,
  price: null,
  priceText: null,
  currency: "VND",
  sourceUrl: "https://shop.example.com/p/1",
  imageUrl: null,
  sku: null,
  model: null,
  availability: null,
  shopCategory: null,
  catalogPdfUrls: [],
};

function editableJob(
  overrides: Partial<{
    id: string;
    status: "queued" | "running" | "completed" | "failed" | "cancelled";
    products: ScrapedShopProduct[];
    isExpired: boolean;
  }> = {},
) {
  return {
    id: "job-1",
    status: "running" as const,
    products: [sampleProduct],
    isExpired: false,
    ...overrides,
  };
}

describe("isScrapeJobProductsEditable", () => {
  beforeEach(() => {
    vi.mocked(isShopScrapeJobActivelyRunning).mockReturnValue(false);
  });

  it("allows completed, failed, and cancelled jobs", () => {
    expect(isScrapeJobProductsEditable(editableJob({ status: "completed" }))).toBe(
      true,
    );
    expect(isScrapeJobProductsEditable(editableJob({ status: "failed" }))).toBe(
      true,
    );
    expect(
      isScrapeJobProductsEditable(editableJob({ status: "cancelled" })),
    ).toBe(true);
  });

  it("allows paused or errored jobs that still show as running but are idle", () => {
    expect(isScrapeJobProductsEditable(editableJob({ status: "running" }))).toBe(
      true,
    );
    expect(isScrapeJobProductsEditable(editableJob({ status: "queued" }))).toBe(
      true,
    );
  });

  it("blocks jobs that are actively scraping", () => {
    vi.mocked(isShopScrapeJobActivelyRunning).mockReturnValue(true);
    expect(isScrapeJobProductsEditable(editableJob({ status: "running" }))).toBe(
      false,
    );
  });

  it("blocks expired jobs and idle jobs without products", () => {
    expect(
      isScrapeJobProductsEditable(
        editableJob({ status: "failed", isExpired: true }),
      ),
    ).toBe(false);
    expect(
      isScrapeJobProductsEditable(
        editableJob({ status: "queued", products: [] }),
      ),
    ).toBe(false);
  });

  it("still allows adding products to a failed job with no scraped rows yet", () => {
    expect(
      isScrapeJobProductsEditable(
        editableJob({ status: "failed", products: [] }),
      ),
    ).toBe(true);
  });
});
