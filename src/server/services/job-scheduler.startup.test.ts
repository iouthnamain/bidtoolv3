import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { excelResearchJobs, shopScrapeJobs } from "~/server/db/schema";
import type { resetStaleExcelResearchRows } from "./excel-research/process-batch";
import type { scrapeShopMaterialsFromUrl } from "./shop-material-scraper";
import { startJobScheduler, stopJobSchedulerForTests } from "./job-scheduler";
import {
  getSchedulerState,
  resetSchedulerStateForTests,
} from "./scheduler-state";

const mocks = vi.hoisted(() => {
  const selectQueuedJob = vi.fn<(table: unknown) => Promise<unknown[]>>();
  const claimQueuedJob = vi.fn<() => Promise<unknown[]>>();
  const updateJob =
    vi.fn<(table: unknown, patch: { status?: string }) => void>();
  const selectExcelJob = vi.fn<() => Promise<{ id: string }[]>>();
  const readExcelJobStatus = vi.fn<() => Promise<{ status: string }[]>>();
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
    selectExcelJob,
    readExcelJobStatus,
    resolveExcelResearchMaxConcurrentJobs: vi.fn<() => Promise<number>>(),
    resolveImportMaxConcurrentJobs: vi.fn<() => Promise<number>>(),
    resumeMaterialProfileSaveBatches: vi.fn<() => Promise<void>>(),
    resetStaleExcelResearchRows: vi.fn<typeof resetStaleExcelResearchRows>(),
    scrapeShopMaterialsFromUrl: vi.fn<typeof scrapeShopMaterialsFromUrl>(),
    db: {
      transaction: (run: (transaction: typeof tx) => Promise<unknown>) =>
        run(tx),
      select: () => ({
        from: (table: unknown) => ({
          where: () =>
            table === excelResearchJobs
              ? {
                  orderBy: () => ({ limit: selectExcelJob }),
                  limit: readExcelJobStatus,
                }
              : Promise.resolve([]),
        }),
      }),
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
  resolveExcelResearchMaxConcurrentJobs:
    mocks.resolveExcelResearchMaxConcurrentJobs,
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
vi.mock("~/server/services/material-profile-material-batches", () => ({
  resumeMaterialProfileSaveBatches: mocks.resumeMaterialProfileSaveBatches,
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
    vi.stubEnv("BIDTOOL_DEPLOYMENT_SURFACE", undefined);
    resetSchedulerStateForTests();
    mocks.selectQueuedJob.mockResolvedValue([]);
    mocks.resolveExcelResearchMaxConcurrentJobs.mockResolvedValue(0);
    mocks.resolveImportMaxConcurrentJobs.mockResolvedValue(0);
  });

  afterEach(async () => {
    const stopped = stopJobSchedulerForTests();
    await vi.dynamicImportSettled();
    await stopped;
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("retries a failed queue while a pending claim stays protected", async () => {
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
    await vi.advanceTimersByTimeAsync(999);
    expect.soft(getSchedulerState()).toMatchObject({
      state: "recovering",
      lastSuccessfulPollAt: null,
      lastError: "import queue unavailable",
    });
    await vi.advanceTimersByTimeAsync(1);
    expect.soft(mocks.resolveImportMaxConcurrentJobs).toHaveBeenCalledTimes(2);
    expect.soft(scrapeClaims).toBe(2);
    expect.soft(getSchedulerState()).toMatchObject({
      state: "recovering",
      lastSuccessfulPollAt: null,
    });

    releaseClaim.resolve();
    await vi.advanceTimersByTimeAsync(1_000);
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
    expect(mocks.resolveImportMaxConcurrentJobs).toHaveBeenCalledTimes(3);
  });

  it("keeps polling healthy queues while a save batch drains", async () => {
    startJobScheduler();
    await vi.advanceTimersByTimeAsync(0);
    await vi.dynamicImportSettled();
    expect(getSchedulerState().state).toBe("ready");
    const finishBatch = deferred();
    mocks.resumeMaterialProfileSaveBatches.mockImplementationOnce(
      () => finishBatch.promise,
    );
    mocks.resolveImportMaxConcurrentJobs.mockRejectedValueOnce(
      new Error("import unavailable"),
    );
    mocks.selectQueuedJob.mockClear();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(getSchedulerState()).toMatchObject({
      lastError: "import unavailable",
    });
    expect(
      mocks.selectQueuedJob.mock.calls.filter(
        ([table]) => table === shopScrapeJobs,
      ),
    ).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(
      mocks.selectQueuedJob.mock.calls.filter(
        ([table]) => table === shopScrapeJobs,
      ),
    ).toHaveLength(2);
    finishBatch.resolve();
  });

  it("starts regular queue polling before a slow first save batch finishes", async () => {
    const finishBatch = deferred();
    await import("~/server/services/material-profile-material-batches");
    mocks.resumeMaterialProfileSaveBatches.mockImplementation(
      () => finishBatch.promise,
    );
    startJobScheduler();
    await vi.advanceTimersByTimeAsync(0);
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(2_000);

    const attemptCount =
      mocks.resumeMaterialProfileSaveBatches.mock.calls.length;
    const scrapePolls = mocks.selectQueuedJob.mock.calls.filter(
      ([table]) => table === shopScrapeJobs,
    ).length;

    finishBatch.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect({ attemptCount, scrapePolls }).toEqual({
      attemptCount: 1,
      scrapePolls: 3,
    });
    expect(getSchedulerState().state).toBe("ready");
  });

  it("does not let an old startup overwrite a restarted scheduler", async () => {
    const oldRecovery = deferred();
    mocks.resetStaleExcelResearchRows.mockImplementationOnce(
      () => oldRecovery.promise,
    );
    startJobScheduler();
    await vi.advanceTimersByTimeAsync(0);
    expect(getSchedulerState().state).toBe("recovering");
    stopJobSchedulerForTests();

    startJobScheduler();
    await vi.advanceTimersByTimeAsync(0);
    expect(getSchedulerState().state).toBe("stopped");
    expect(startupRecoveries()).toHaveLength(1);
    oldRecovery.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await vi.dynamicImportSettled();
    expect(getSchedulerState().state).toBe("ready");
    expect(startupRecoveries()).toHaveLength(2);
  });

  it("does not start Excel research when its claim returns after stop", async () => {
    const claimStarted = deferred();
    const releaseClaim = deferred();
    mocks.resolveExcelResearchMaxConcurrentJobs.mockResolvedValue(1);
    mocks.selectExcelJob.mockResolvedValue([]);
    mocks.selectExcelJob.mockImplementationOnce(async () => {
      claimStarted.resolve();
      await releaseClaim.promise;
      return [{ id: "excel-1" }];
    });
    mocks.readExcelJobStatus.mockResolvedValue([]);

    startJobScheduler();
    await claimStarted.promise;
    const stopped = stopJobSchedulerForTests();
    releaseClaim.resolve();
    await stopped;

    expect(mocks.readExcelJobStatus).not.toHaveBeenCalled();
    expect(getSchedulerState().state).toBe("stopped");
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
