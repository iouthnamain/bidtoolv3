import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WebLinkResult } from "~/lib/materials/enrich-gap-fill";

const appSettingsMock = vi.hoisted(() => ({
  resolveAiProvider: vi.fn(),
  resolveSearchDomainPolicy: vi.fn(),
  resolveSearchQueryControls: vi.fn(),
}));

const materialWebSearchMock = vi.hoisted(() => ({
  enrichSearchResultsWithFetchedContent: vi.fn(),
  fetchUrlAsSearchResult: vi.fn(),
  rankSearchResults: vi.fn(),
  searchWebForProduct: vi.fn(),
}));

const materialExtractionMock = vi.hoisted(() => ({
  extractProductFromSources: vi.fn(),
}));

vi.mock("~/server/services/app-settings", () => appSettingsMock);

vi.mock("~/server/services/material-web-search", () => materialWebSearchMock);

vi.mock(
  "~/server/services/material-enrichment-extract",
  () => materialExtractionMock,
);

import { resolveAiProvider } from "~/server/services/app-settings";
import { extractProfileRowAiCandidates } from "~/server/services/enrich-profile-row-search";
import { extractProductFromSources } from "~/server/services/material-enrichment-extract";
import { fetchUrlAsSearchResult } from "~/server/services/material-web-search";

function webLink(index: number, url: string): WebLinkResult {
  return {
    title: `Nguồn ${index}`,
    url,
    domain: "example.com",
    snippet: `Thông tin nguồn ${index}`,
    query: "Ống PVC D50",
    rankScore: 1 - index * 0.01,
  };
}

describe("extractProfileRowAiCandidates", () => {
  beforeEach(() => {
    vi.mocked(resolveAiProvider).mockReset();
    vi.mocked(fetchUrlAsSearchResult).mockReset();
    vi.mocked(extractProductFromSources).mockReset();

    vi.mocked(resolveAiProvider).mockResolvedValue({
      provider: "openrouter",
      apiKey: "test-key",
      model: "test-model",
    });
    vi.mocked(fetchUrlAsSearchResult).mockResolvedValue(null);
  });

  it("returns bounded warnings for failed and empty per-link AI extraction", async () => {
    vi.mocked(extractProductFromSources).mockImplementation(
      async (_input, candidates) => {
        const url = candidates[0]?.url ?? "";
        if (url.endsWith("/fail")) {
          throw new Error("Nguồn lỗi");
        }
        return { catalogPdfUrls: [] };
      },
    );

    const links = [
      webLink(0, "https://example.com/fail"),
      ...Array.from({ length: 6 }, (_, index) =>
        webLink(index + 1, `https://example.com/empty-${index + 1}`),
      ),
    ];

    const result = await extractProfileRowAiCandidates(
      { name: "Ống PVC D50" },
      links,
    );

    expect(result.aiSearchCandidates).toEqual([]);
    expect(result.recommendedCandidateKey).toBeUndefined();
    expect(result.warnings.length).toBeLessThanOrEqual(6);
    expect(result.warnings).toContain(
      "AI không trích xuất được nguồn example.com: Nguồn lỗi.",
    );
    expect(
      result.warnings.filter((warning) =>
        warning.includes("AI không tìm thấy trường/PDF dùng được"),
      ),
    ).toHaveLength(5);
    expect(extractProductFromSources).toHaveBeenCalledTimes(6);
  });
});
