import { describe, expect, it } from "vitest";

import {
  isMaterialProfileScrapeInputCurrent,
  isMaterialProfileScrapeProductSelectable,
  isMaterialProfileScrapeProducerJobStatus,
  materialProfileScrapeSourceForRun,
  materialProfileScrapeProducerFinishedAt,
  selectedProfileScrapeSource,
} from "~/server/services/material-profile-scrape-jobs";

describe("material profile scrape input snapshot", () => {
  const current = {
    snapshot: {
      itemUpdatedAt: "2026-07-12T01:00:00.000Z",
      materialId: null,
      searchGeneration: "web-run-3",
    },
    currentMaterialId: null,
    currentSourceFingerprint: "source-a",
    runSourceFingerprint: "source-a",
    currentSearchGeneration: "web-run-3",
  };

  it("accepts the immutable queued snapshot", () => {
    expect(isMaterialProfileScrapeInputCurrent(current)).toBe(true);
  });

  it("rejects material, source, and search changes", () => {
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

describe("material profile scrape source selection", () => {
  const high = {
    title: "Điểm cao",
    url: "https://example.com/high",
    domain: "example.com",
    snippet: "",
    rankScore: 0.95,
  };
  const selected = {
    title: "Người dùng chọn",
    url: "https://example.com/selected",
    domain: "example.com",
    snippet: "",
    rankScore: 0.72,
  };

  it("never falls back to the highest-scored source", () => {
    expect(
      selectedProfileScrapeSource(
        {
          materialId: null,
          acceptedFields: new Set(),
          webLinkResults: [high, selected],
        },
        {},
      ),
    ).toBeUndefined();
  });

  it("uses the explicitly selected source even when it scores lower", () => {
    expect(
      selectedProfileScrapeSource(
        {
          materialId: null,
          acceptedFields: new Set(),
          webLinkResults: [high, selected],
          selectedSearchCandidateKey: `web:${selected.url}`,
        },
        {},
      ),
    ).toEqual(selected);
  });

  it("accepts an interactive explicit URL before the visible result is persisted", () => {
    expect(
      selectedProfileScrapeSource(
        {
          materialId: null,
          acceptedFields: new Set(),
          webLinkResults: [],
        },
        {
          explicitSourceUrl: selected.url,
          explicitSourceCandidateKey: `web:${selected.url}`,
          allowUnpersistedExplicitSource: true,
        },
      ),
    ).toMatchObject({
      url: selected.url,
      domain: "example.com",
    });
  });

  it("keeps the source that launched an interactive scrape when it is absent from the latest search list", () => {
    expect(
      materialProfileScrapeSourceForRun(
        {
          materialId: null,
          acceptedFields: new Set(),
          webLinkResults: [],
        },
        {
          sourceUrl: selected.url,
          sourceScore: 0.72,
          inputSnapshotJson: {
            source: selected,
          },
        },
      ),
    ).toEqual(selected);
  });
});

describe("material profile scraped product selection", () => {
  it("allows recovery from terminal runs that retain product snapshots", () => {
    expect(isMaterialProfileScrapeProductSelectable("skipped", 6)).toBe(true);
    expect(isMaterialProfileScrapeProductSelectable("failed", 2)).toBe(true);
  });

  it("does not expose partial products while a scrape is still running", () => {
    expect(isMaterialProfileScrapeProductSelectable("running", 6)).toBe(false);
    expect(isMaterialProfileScrapeProductSelectable("cancelled", 6)).toBe(
      false,
    );
  });
});

describe("material profile scrape producer state", () => {
  it("only treats queued and running jobs as producer-active", () => {
    expect(isMaterialProfileScrapeProducerJobStatus("queued")).toBe(true);
    expect(isMaterialProfileScrapeProducerJobStatus("running")).toBe(true);
    expect(isMaterialProfileScrapeProducerJobStatus("awaiting_review")).toBe(
      false,
    );
  });

  it("persists the latest fixed run timestamp when production ends", () => {
    expect(
      materialProfileScrapeProducerFinishedAt(
        [
          {
            finishedAt: "2026-08-20T00:00:18.000Z",
            updatedAt: "2026-08-20T00:00:18.000Z",
          },
          {
            finishedAt: null,
            updatedAt: "2026-08-20T00:00:20.600Z",
          },
        ],
        "2026-08-20T01:00:00.000Z",
      ),
    ).toBe("2026-08-20T00:00:20.600Z");
  });
});
