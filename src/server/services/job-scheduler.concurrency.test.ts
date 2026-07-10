import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const queuedJobs: Array<Record<string, unknown>> = [];
  const completions = new Map<
    string,
    { resolve: (value: Record<string, unknown>) => void }
  >();
  let activeCalls = 0;
  let maxActiveCalls = 0;

  const db = {
    transaction: vi.fn(
      async (callback: (tx: Record<string, unknown>) => Promise<unknown>) =>
        callback({
          select: vi.fn(() => ({
            from: vi.fn(() => ({
              where: vi.fn(() => ({
                orderBy: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    for: vi.fn(async () =>
                      queuedJobs[0] ? [queuedJobs[0]] : [],
                    ),
                  })),
                })),
              })),
            })),
          })),
          update: vi.fn(() => ({
            set: vi.fn(() => ({
              where: vi.fn(() => ({
                returning: vi.fn(async () => {
                  const claimed = queuedJobs.shift();
                  return claimed ? [claimed] : [];
                }),
              })),
            })),
          })),
        }),
    ),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([{ status: "running" }]),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(undefined),
      })),
    })),
  };

  return {
    queuedJobs,
    completions,
    db,
    resolveScrapeMaxConcurrentJobs: vi.fn(),
    resolveScrapeMaxConcurrentPages: vi.fn(),
    resolveScrapeJobTtlDays: vi.fn(),
    replaceScrapeJobProducts: vi.fn(),
    scrapeShopMaterialsFromUrl: vi.fn(
      (input: { url: string; concurrentPages: number }) => {
        activeCalls += 1;
        maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
        return new Promise<Record<string, unknown>>((resolve) => {
          completions.set(input.url, {
            resolve: (result) => {
              activeCalls -= 1;
              resolve(result);
            },
          });
        });
      },
    ),
    reset() {
      queuedJobs.length = 0;
      completions.clear();
      activeCalls = 0;
      maxActiveCalls = 0;
    },
    maxActiveCalls: () => maxActiveCalls,
  };
});

vi.mock("~/server/db", () => ({ db: mocks.db }));
vi.mock("~/server/services/app-settings", () => ({
  resolveScrapeMaxConcurrentJobs: mocks.resolveScrapeMaxConcurrentJobs,
  resolveScrapeMaxConcurrentPages: mocks.resolveScrapeMaxConcurrentPages,
  resolveScrapeJobTtlDays: mocks.resolveScrapeJobTtlDays,
}));
vi.mock("~/server/services/shop-material-scraper", () => ({
  scrapeShopMaterialsFromUrl: mocks.scrapeShopMaterialsFromUrl,
}));
vi.mock("~/server/services/shop-scrape-job-products", () => ({
  loadScrapeJobProducts: vi.fn(),
  replaceScrapeJobProducts: mocks.replaceScrapeJobProducts,
}));

import {
  fillShopScrapeSlotsForTests,
  stopJobSchedulerForTests,
} from "~/server/services/job-scheduler";

function scrapeJob(id: string) {
  return {
    id,
    url: `https://shop.example.com/${id}`,
    maxPages: null,
    maxProducts: 10,
    method: "auto",
    detailEnrichment: "none",
  };
}

function scrapeResult() {
  return {
    products: [],
    pagesVisited: [],
    failedPages: [],
    durationMs: 10,
    stopReason: "queue_empty",
  };
}

describe("scrape scheduler concurrency", () => {
  beforeEach(() => {
    mocks.reset();
    mocks.queuedJobs.push(
      scrapeJob("job-1"),
      scrapeJob("job-2"),
      scrapeJob("job-3"),
    );
    mocks.resolveScrapeMaxConcurrentJobs.mockResolvedValue(2);
    mocks.resolveScrapeMaxConcurrentPages.mockResolvedValue(4);
    mocks.resolveScrapeJobTtlDays.mockResolvedValue(7);
    mocks.replaceScrapeJobProducts.mockResolvedValue([]);
  });

  afterEach(() => {
    stopJobSchedulerForTests();
    vi.clearAllMocks();
  });

  it("runs two distinct jobs, holds the third, then fills the released slot", async () => {
    await fillShopScrapeSlotsForTests();
    await vi.waitFor(() => {
      expect(mocks.scrapeShopMaterialsFromUrl).toHaveBeenCalledTimes(2);
    });

    expect(
      mocks.scrapeShopMaterialsFromUrl.mock.calls.map(([input]) => input.url),
    ).toEqual([
      "https://shop.example.com/job-1",
      "https://shop.example.com/job-2",
    ]);
    expect(
      mocks.scrapeShopMaterialsFromUrl.mock.calls.map(
        ([input]) => input.concurrentPages,
      ),
    ).toEqual([4, 4]);

    await fillShopScrapeSlotsForTests();
    expect(mocks.scrapeShopMaterialsFromUrl).toHaveBeenCalledTimes(2);
    expect(mocks.queuedJobs).toHaveLength(1);

    mocks.completions
      .get("https://shop.example.com/job-1")
      ?.resolve(scrapeResult());
    await vi.waitFor(() => {
      expect(mocks.replaceScrapeJobProducts).toHaveBeenCalledTimes(1);
    });

    await fillShopScrapeSlotsForTests();
    await vi.waitFor(() => {
      expect(mocks.scrapeShopMaterialsFromUrl).toHaveBeenCalledTimes(3);
    });
    expect(
      mocks.scrapeShopMaterialsFromUrl.mock.calls[2]?.[0].concurrentPages,
    ).toBe(4);
    expect(mocks.maxActiveCalls()).toBe(2);

    mocks.completions
      .get("https://shop.example.com/job-2")
      ?.resolve(scrapeResult());
    mocks.completions
      .get("https://shop.example.com/job-3")
      ?.resolve(scrapeResult());
    await vi.waitFor(() => {
      expect(mocks.replaceScrapeJobProducts).toHaveBeenCalledTimes(3);
    });
  });
});
