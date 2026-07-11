import { describe, expect, it } from "vitest";

import { isMaterialProfileScrapeInputCurrent } from "~/server/services/material-profile-scrape-jobs";

describe("material profile scrape input snapshot", () => {
  const current = {
    snapshot: {
      itemUpdatedAt: "2026-07-12T01:00:00.000Z",
      materialId: null,
      searchGeneration: "web-run-3",
    },
    currentUpdatedAt: "2026-07-12T01:00:00.000Z",
    currentMaterialId: null,
    currentSourceFingerprint: "source-a",
    runSourceFingerprint: "source-a",
    currentSearchGeneration: "web-run-3",
  };

  it("accepts the immutable queued snapshot", () => {
    expect(isMaterialProfileScrapeInputCurrent(current)).toBe(true);
  });

  it("rejects row edits, remaps, source changes, and newer search results", () => {
    expect(
      isMaterialProfileScrapeInputCurrent({
        ...current,
        currentUpdatedAt: "2026-07-12T01:01:00.000Z",
      }),
    ).toBe(false);
    expect(
      isMaterialProfileScrapeInputCurrent({
        ...current,
        currentMaterialId: 42,
      }),
    ).toBe(false);
    expect(
      isMaterialProfileScrapeInputCurrent({
        ...current,
        currentSourceFingerprint: "source-b",
      }),
    ).toBe(false);
    expect(
      isMaterialProfileScrapeInputCurrent({
        ...current,
        currentSearchGeneration: "web-run-4",
      }),
    ).toBe(false);
  });
});
