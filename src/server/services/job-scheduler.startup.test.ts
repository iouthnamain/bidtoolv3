import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { shopScrapeJobs } from "~/server/db/schema";
import type { resetStaleExcelResearchRows } from "./excel-research/process-batch";
import type { scrapeShopMaterialsFromUrl } from "./shop-material-scraper";
import {
  runJobSchedulerTickForTests,
  startJobScheduler,
  stopJobSchedulerForTests,
} from "./job-scheduler";
import {
  getSchedulerState,
  resetSchedulerStateForTests,
} from "./scheduler-state";

const mocks = vi.hoisted(() => {
  const selectQueuedJob = vi.fn<(table: unknown) => Promise<unknown[]>>();
  const claimQueuedJob = vi.fn<() => Promise<unknown[]>>();
  const updateJob =
    vi.fn<(table: unknown, patch: { status?: string }) => void>();
  const tx = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          orderBy: () => ({
            limit: () => ({ for: () => selectQueuedJob(table) }),
          }),
        }),
      }),
    }),
    update: () => ({
      set: () => ({ where: () => ({ returning: claimQueuedJob }) }),
    }),
  };
  return {
    selectQueuedJob,
    claimQueuedJob,
    updateJob,
    resolveImportMaxConcurrentJobs: vi.fn<() => Promise<number>>(),
    resetStaleExcelResearchRows: vi.fn<typeof resetStaleExcelResearchRows>(),
    scrapeShopMaterialsFromUrl: vi.fn<typeof scrapeShopMaterialsFromUrl>(),
    db: {
      transaction: (run: (transaction: typeof tx) => Promise<unknown>) =>
        run(tx),
      select: () => ({ from: () => ({ where: async () => [] }) }),
      update: (table: unknown) => ({
        set: (patch: { status?: string }) => ({
          where: async () => updateJob(table, patch),
        }),
      }),
      delete: () => ({ where: async () => undefined }),
    },
  };
});

vi.mock("~/server/db", () => ({ db: mocks.db }));
vi.mock("~/server/runtime", () => ({
  hasDatabaseUrl: () => true,
  isServerlessRuntime: () => false,
}));
vi.mock("./app-settings", () => ({
  resolveScrapeMaxConcurrentJobs: async () => 2,
  resolveScrapeMaxConcurrentPages: async () => 1,
  resolveImportMaxConcurrentJobs: mocks.resolveImportMaxConcurrentJobs,
  resolveEnrichmentMaxConcurrentJobs: async () => 0,
  resolveExcelResearchMaxConcurrentJobs: async () => 0,
}));
vi.mock("./excel-research/process-batch", () => ({
  resetStaleExcelResearchRows: mocks.resetStaleExcelResearchRows,
}));
vi.mock("./shop-material-scraper", () => ({
  scrapeShopMaterialsFromUrl: mocks.scrapeShopMaterialsFromUrl,
}));
vi.mock("./material-profile-scrape-jobs", () => ({
  advanceMaterialProfileScrapeJobs: async () => undefined,
  cleanupExpiredMaterialProfileScrapeJobs: async () => undefined,
}));
vi.mock("./material-profile-material-batches", () => ({
  resumeMaterialProfileSaveBatches: async () => undefined,
  cleanupExpiredMaterialProfileBatches: async () => undefined,
}));

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function startupRecoveries() {
  return mocks.resetStaleExcelResearchRows.mock.calls.filter(
    ([options]) => options?.startup,
  );
}

describe("job scheduler startup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    resetSchedulerStateForTests();
    mocks.selectQueuedJob.mockResolvedValue([]);
    mocks.resolveImportMaxConcurrentJobs.mockResolvedValue(0);
  });

  afterEach(async () => {
    stopJobSchedulerForTests();
    await vi.dynamicImportSettled();
    vi.useRealTimers();
  });

  it("waits for a pending claim after a sibling failure and retries without requeuing the active job", async () => {
    const job = { id: "shop-1", url: "https://shop.example.com/shop-1" };
    let status = "queued";
    let scrapeClaims = 0;
    const secondClaimStarted = deferred();
    const releaseClaim = deferred();
    const failImportQueue = deferred();

    mocks.updateJob.mockImplementation((table, patch) => {
      if (table === shopScrapeJobs && patch.status === "queued") {
        status = "queued";
      }
    });
    mocks.selectQueuedJob.mockImplementation(async (table) => {
      if (table !== shopScrapeJobs) return [];
      scrapeClaims += 1;
      if (scrapeClaims === 2) {
        secondClaimStarted.resolve();
        await releaseClaim.promise;
      }
      return status === "queued" ? [job] : [];
    });
    mocks.claimQueuedJob.mockImplementation(async () => {
      status = "running";
      return [job];
    });
    mocks.scrapeShopMaterialsFromUrl.mockImplementation(
      ({ signal }) =>
        new Promise<never>((_, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    mocks.resolveImportMaxConcurrentJobs.mockImplementationOnce(async () => {
      await failImportQueue.promise;
      throw new Error("import queue unavailable");
    });

    startJobScheduler();
    await secondClaimStarted.promise;
    expect(mocks.scrapeShopMaterialsFromUrl).toHaveBeenCalledTimes(1);

    failImportQueue.resolve();
    await vi.dynamicImportSettled();
    await runJobSchedulerTickForTests();
    expect.soft(mocks.resolveImportMaxConcurrentJobs).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect.soft(scrapeClaims).toBe(2);
    expect.soft(getSchedulerState()).toMatchObject({
      state: "recovering",
      lastSuccessfulPollAt: null,
      lastError: "import queue unavailable",
    });

    releaseClaim.resolve();
    await vi.advanceTimersByTimeAsync(999);
    expect.soft(getSchedulerState()).toMatchObject({
      state: "retrying",
      lastSuccessfulPollAt: null,
    });

    await vi.advanceTimersByTimeAsync(1);
    expect(getSchedulerState()).toMatchObject({
      state: "ready",
      lastSuccessfulPollAt: expect.any(String),
      lastError: null,
    });
    expect.soft(startupRecoveries()).toEqual([[{ startup: true }]]);
    expect.soft(mocks.claimQueuedJob).toHaveBeenCalledTimes(1);
    expect(mocks.scrapeShopMaterialsFromUrl).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        url: job.url,
        signal: expect.any(AbortSignal),
      }),
    );

    const signal = mocks.scrapeShopMaterialsFromUrl.mock.calls[0]?.[0].signal;
    expect(signal?.aborted).toBe(false);
    stopJobSchedulerForTests();
    expect(signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(getSchedulerState().state).toBe("stopped");
    expect(mocks.resolveImportMaxConcurrentJobs).toHaveBeenCalledTimes(2);
  });

  it("backs off when recovery fails and clears the pending retry on stop", async () => {
    mocks.resetStaleExcelResearchRows.mockRejectedValue(
      new Error("recovery unavailable"),
    );

    startJobScheduler();
    await vi.advanceTimersByTimeAsync(999);
    expect(startupRecoveries()).toHaveLength(1);
    expect(getSchedulerState()).toMatchObject({
      state: "retrying",
      lastSuccessfulPollAt: null,
      lastError: "recovery unavailable",
    });

    await vi.advanceTimersByTimeAsync(1);
    expect(startupRecoveries()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(startupRecoveries()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(startupRecoveries()).toHaveLength(3);
    expect(mocks.selectQueuedJob).not.toHaveBeenCalled();

    stopJobSchedulerForTests();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(startupRecoveries()).toHaveLength(3);
    expect(getSchedulerState().state).toBe("stopped");
  });
});
