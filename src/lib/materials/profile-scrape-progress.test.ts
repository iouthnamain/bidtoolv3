import { describe, expect, it } from "vitest";

import {
  isMaterialProfileScrapeProducerActive,
  materialProfileScrapeElapsedMs,
} from "~/lib/materials/profile-scrape-progress";

describe("material profile scrape progress", () => {
  it.each(["queued", "running"])("keeps %s producer-active", (status) => {
    expect(isMaterialProfileScrapeProducerActive(status)).toBe(true);
    expect(
      materialProfileScrapeElapsedMs({
        job: { status, startedAt: "2026-08-20T00:00:00.000Z" },
        nowMs: Date.parse("2026-08-20T00:00:12.000Z"),
      }),
    ).toBe(12_000);
  });

  it("freezes awaiting-review time at the completed run update", () => {
    const input = {
      job: {
        status: "awaiting_review",
        startedAt: "2026-08-20T00:00:00.000Z",
        lastProgressAt: "2026-08-20T05:00:00.000Z",
      },
      run: {
        status: "awaiting_product_selection",
        startedAt: "2026-08-20T00:00:01.000Z",
        updatedAt: "2026-08-20T00:00:20.600Z",
      },
    };

    expect(isMaterialProfileScrapeProducerActive(input.job.status)).toBe(false);
    expect(
      materialProfileScrapeElapsedMs({
        ...input,
        nowMs: Date.parse("2026-08-20T06:00:00.000Z"),
      }),
    ).toBe(20_600);
    expect(
      materialProfileScrapeElapsedMs({
        ...input,
        nowMs: Date.parse("2026-08-21T06:00:00.000Z"),
      }),
    ).toBe(20_600);
  });

  it("uses the fixed job finish time for terminal jobs", () => {
    expect(
      materialProfileScrapeElapsedMs({
        job: {
          status: "failed",
          startedAt: "2026-08-20T00:00:00.000Z",
          finishedAt: "2026-08-20T00:01:30.000Z",
        },
        nowMs: Date.parse("2026-08-21T00:00:00.000Z"),
      }),
    ).toBe(90_000);
  });
});
