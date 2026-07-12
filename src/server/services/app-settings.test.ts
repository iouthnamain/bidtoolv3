import { describe, expect, it } from "vitest";

import { OPERATIONAL_SETTINGS } from "~/server/services/app-settings";

describe("app settings defaults", () => {
  it("defaults shared scrape concurrency to eight jobs", () => {
    expect(OPERATIONAL_SETTINGS.scrapeMaxConcurrentJobs.defaultValue).toBe(8);
    expect(OPERATIONAL_SETTINGS.scrapeMaxConcurrentJobs.max).toBe(16);
  });
});
