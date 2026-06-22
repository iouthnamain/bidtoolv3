import { describe, expect, it } from "vitest";

const IMPORTABLE_SCRAPE_JOB_STATUSES = [
  "completed",
  "failed",
  "cancelled",
] as const;

function canImportFromScrapeStatus(status: string) {
  return IMPORTABLE_SCRAPE_JOB_STATUSES.includes(
    status as (typeof IMPORTABLE_SCRAPE_JOB_STATUSES)[number],
  );
}

describe("shop import eligibility", () => {
  it("allows import from completed, failed, and cancelled scrape jobs", () => {
    expect(canImportFromScrapeStatus("completed")).toBe(true);
    expect(canImportFromScrapeStatus("failed")).toBe(true);
    expect(canImportFromScrapeStatus("cancelled")).toBe(true);
    expect(canImportFromScrapeStatus("running")).toBe(false);
  });
});
