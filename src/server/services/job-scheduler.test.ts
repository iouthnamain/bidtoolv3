import { describe, expect, it } from "vitest";

import {
  abortShopImportJob,
  abortShopScrapeJob,
  stopJobSchedulerForTests,
} from "./job-scheduler";

describe("job scheduler active-run registry", () => {
  it("tolerates aborting unknown jobs and can reset cleanly", () => {
    expect(() =>
      abortShopScrapeJob("00000000-0000-4000-8000-000000000001"),
    ).not.toThrow();
    expect(() =>
      abortShopImportJob("00000000-0000-4000-8000-000000000002"),
    ).not.toThrow();
    expect(() => stopJobSchedulerForTests()).not.toThrow();
  });
});
