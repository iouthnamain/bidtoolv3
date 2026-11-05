import { describe, expect, it } from "vitest";

import {
  abortShopImportJob,
  abortShopScrapeJob,
  abortMaterialEnrichmentJob,
  abortMaterialProfileSearchJob,
  stopJobSchedulerForTests,
  cancelledImportRecoveryPatch,
} from "./job-scheduler";

describe("job scheduler active-run registry", () => {
  it("tolerates aborting unknown jobs and can reset cleanly", () => {
    expect(() =>
      abortShopScrapeJob("00000000-0000-4000-8000-000000000001"),
    ).not.toThrow();
    expect(() =>
      abortShopImportJob("00000000-0000-4000-8000-000000000002"),
    ).not.toThrow();
    expect(() =>
      abortMaterialEnrichmentJob("00000000-0000-4000-8000-000000000003"),
    ).not.toThrow();
    expect(() =>
      abortMaterialProfileSearchJob("00000000-0000-4000-8000-000000000004"),
    ).not.toThrow();
    expect(() => stopJobSchedulerForTests()).not.toThrow();
  });

  it("reconciles a cancelled job's durable ledger without making it runnable", () => {
    const progress = {
      processed: 1,
      total: 2,
      created: 1,
      updated: 0,
      skipped: 0,
      failed: 0,
      items: [],
      currentProductName: null,
      currentSourceUrl: null,
    };
    const patch = cancelledImportRecoveryPatch(
      "cancelled",
      progress,
      "2026-11-05T12:00:00.000Z",
    );
    expect(patch).toMatchObject({ processed: 1, total: 2 });
    expect(patch).toHaveProperty("updatedAt", "2026-11-05T12:00:00.000Z");
    expect(cancelledImportRecoveryPatch("running", progress, "now")).toBeNull();
  });
});
