import { describe, expect, it } from "vitest";

import { scrapeTimeoutMs } from "./shop-scrape-limits";

describe("scrapeTimeoutMs", () => {
  it("raises the timeout floor for single-page scrapes", () => {
    expect(scrapeTimeoutMs(1)).toBeGreaterThanOrEqual(45_000);
    expect(scrapeTimeoutMs(5)).toBe(55_000);
  });
});
