import { describe, expect, it } from "vitest";

import {
  canImportJob,
  progressPercent,
  progressWidth,
  type ScrapeJob,
} from "./scrape-job-utils";

const importableJob = {
  id: "00000000-0000-4000-8000-000000000001",
  status: "completed",
  isExpired: false,
  products: [{ sourceUrl: "https://shop.example/a" }],
} as ScrapeJob;

describe("canImportJob", () => {
  it("allows import for terminal jobs with visible products", () => {
    expect(canImportJob(importableJob, 1)).toBe(true);
  });

  it("blocks import while scrape is still active even if products exist", () => {
    expect(
      canImportJob(
        {
          ...importableJob,
          status: "running",
        },
        1,
      ),
    ).toBe(false);
  });
});

describe("scrape progress helpers", () => {
  it("reports bounded percentages for known limits", () => {
    expect(progressPercent(25, 100)).toBe(25);
    expect(progressPercent(120, 100)).toBe(100);
    expect(progressPercent(1, 0)).toBe(0);
  });

  it("uses an indeterminate width only while active", () => {
    expect(progressWidth(null, true)).toBe("55%");
    expect(progressWidth(null, false)).toBe("100%");
    expect(progressWidth(42, true)).toBe("42%");
  });
});
