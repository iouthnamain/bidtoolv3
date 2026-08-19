import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WebLinkResult } from "~/lib/materials/enrich-gap-fill";

const appSettingsMock = vi.hoisted(() => ({
  resolveAiProvider: vi.fn(),
  resolveSearchDomainPolicy: vi.fn(),
  resolveSearchQueryControls: vi.fn(),
  resolveSearchRelevancePipelineMode: vi.fn(),
  resolveSearxngSearchConfig: vi.fn(),
}));

const materialWebSearchMock = vi.hoisted(() => ({
  enrichSearchResultsWithFetchedContent: vi.fn(),
  fetchUrlAsSearchResult: vi.fn(),
  normalizeWebSearchQuery: (query: string) =>
    query.trim().replace(/\s+/g, " ").toLowerCase(),
  rankSearchResults: vi.fn(),
  searchBingForProduct: vi.fn(),
  searchWebForProduct: vi.fn(),
}));

const materialExtractionMock = vi.hoisted(() => ({
  extractProductFromSources: vi.fn(),
}));

const feedbackMock = vi.hoisted(() => ({
  activeRejectedUrls: vi.fn(),
}));

const searchAuditMock = vi.hoisted(() => ({
  recordSearchAuditLog: vi.fn(),
}));

const aiRerankerMock = vi.hoisted(() => ({
  rerankAmbiguousMaterialLinks: vi.fn(),
}));

vi.mock("~/server/services/app-settings", () => appSettingsMock);

vi.mock("~/server/services/material-web-search", () => materialWebSearchMock);

vi.mock(
  "~/server/services/material-enrichment-extract",
  () => materialExtractionMock,
);

vi.mock("~/server/services/material-search-feedback", () => ({
  activeRejectedUrls: feedbackMock.activeRejectedUrls,
  normalizeMaterialSearchUrl: (url: string) => url,
}));

vi.mock("~/server/services/search-audit", () => searchAuditMock);

vi.mock("~/server/services/material-search-ai-reranker", () => aiRerankerMock);

import {
  resolveAiProvider,
  resolveSearchDomainPolicy,
  resolveSearchQueryControls,
  resolveSearchRelevancePipelineMode,
  resolveSearxngSearchConfig,
} from "~/server/services/app-settings";
import {
  extractProfileRowAiCandidates,
  searchProfileRowWebLinks,
} from "~/server/services/enrich-profile-row-search";
import { extractProductFromSources } from "~/server/services/material-enrichment-extract";
import {
  enrichSearchResultsWithFetchedContent,
  fetchUrlAsSearchResult,
  rankSearchResults,
  searchBingForProduct,
  searchWebForProduct,
} from "~/server/services/material-web-search";
import { activeRejectedUrls } from "~/server/services/material-search-feedback";
import { rerankAmbiguousMaterialLinks } from "~/server/services/material-search-ai-reranker";
import { recordSearchAuditLog } from "~/server/services/search-audit";

function webLink(index: number, url: string): WebLinkResult {
  return {
    title: `Nguồn ${index}`,
    url,
    domain: "example.com",
    snippet: `Thông tin nguồn ${index}`,
    query: "Ống PVC D50",
    rankScore: 1 - index * 0.01,
    assessment: {
      score: 0.8,
      tier: "primary",
      dimensions: {
        identity: 0.8,
        specification: 0.8,
        sourceTrust: 0.8,
        retrievalConsensus: 0.5,
      },
      reasons: ["Khớp tên"],
      conflicts: [],
      hardRejects: [],
      aiOverrideEligible: false,
    },
  };
}

describe("extractProfileRowAiCandidates", () => {
  beforeEach(() => {
    vi.mocked(resolveAiProvider).mockReset();
    vi.mocked(fetchUrlAsSearchResult).mockReset();
    vi.mocked(extractProductFromSources).mockReset();
    vi.mocked(rerankAmbiguousMaterialLinks).mockReset().mockResolvedValue({
      promotedResults: [],
      decisions: [],
    });
    vi.mocked(recordSearchAuditLog).mockReset();

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

describe("searchProfileRowWebLinks query budget", () => {
  beforeEach(() => {
    vi.mocked(resolveSearchDomainPolicy).mockResolvedValue({
      boostDomains: [],
      penaltyDomains: [],
      blockDomains: [],
    });
    vi.mocked(resolveSearchQueryControls).mockResolvedValue({
      enableSiteVnVariants: true,
      enableNegativeMarketplaceVariants: true,
      materialJobMaxQueries: 6,
      interactiveMaxQueries: 4,
      excelResearchMaxQueries: 6,
    });
    vi.mocked(resolveSearchRelevancePipelineMode).mockResolvedValue("guarded");
    vi.mocked(resolveSearxngSearchConfig).mockResolvedValue({
      baseUrl: "http://searxng.test",
      apiKey: null,
      engines: ["google"],
      language: "vi-VN",
      safeSearch: 0,
      timeRange: "",
      requestTimeoutMs: 1_000,
      htmlFallback: false,
      resultLimitPerQuery: 8,
    });
    vi.mocked(searchWebForProduct)
      .mockReset()
      .mockResolvedValue({
        results: [],
        warnings: [],
        domainPolicy: {
          boostDomains: [],
          penaltyDomains: [],
          blockDomains: [],
        },
      });
    vi.mocked(searchBingForProduct).mockReset().mockResolvedValue({
      results: [],
      warnings: [],
      providers: ["bing"],
      domainPolicy: {
        boostDomains: [],
        penaltyDomains: [],
        blockDomains: [],
      },
    });
    vi.mocked(rankSearchResults).mockReset().mockReturnValue([]);
    vi.mocked(enrichSearchResultsWithFetchedContent)
      .mockReset()
      .mockResolvedValue([]);
    vi.mocked(activeRejectedUrls).mockReset().mockResolvedValue(new Set());
    vi.mocked(recordSearchAuditLog).mockReset();
  });

  it("gives wave 2 only the remaining guarded query budget", async () => {
    const result = await searchProfileRowWebLinks({
      name: "Ống PVC D50 Bình Minh",
      manufacturer: "Bình Minh",
      specText: "D50 PN10",
    });

    expect(searchWebForProduct).toHaveBeenCalledTimes(2);
    const firstWaveCount =
      vi.mocked(searchWebForProduct).mock.calls[0]?.[0].length;
    const secondWaveCount =
      vi.mocked(searchWebForProduct).mock.calls[1]?.[0].length;
    expect(firstWaveCount).toBeGreaterThan(0);
    expect(firstWaveCount! + secondWaveCount!).toBe(4);
    expect(result.queries).toHaveLength(4);
  });

  it("caps legacy queries at the same interactive budget", async () => {
    vi.mocked(resolveSearchRelevancePipelineMode).mockResolvedValue("legacy");
    vi.mocked(resolveSearchQueryControls).mockResolvedValue({
      enableSiteVnVariants: true,
      enableNegativeMarketplaceVariants: true,
      materialJobMaxQueries: 6,
      interactiveMaxQueries: 2,
      excelResearchMaxQueries: 6,
    });

    const result = await searchProfileRowWebLinks({ name: "Ống PVC D50" });

    expect(searchWebForProduct).toHaveBeenCalledTimes(1);
    expect(vi.mocked(searchWebForProduct).mock.calls[0]?.[0]).toHaveLength(2);
    expect(result.queries).toHaveLength(2);
  });

  it("audits rejected results across both waves", async () => {
    const rejectedUrls = new Set([
      "https://example.com/rejected-wave-1",
      "https://example.com/rejected-wave-2",
    ]);
    vi.mocked(activeRejectedUrls).mockResolvedValue(rejectedUrls);
    vi.mocked(searchWebForProduct)
      .mockResolvedValueOnce({
        results: [
          {
            title: "Đã từ chối 1",
            url: "https://example.com/rejected-wave-1",
            domain: "example.com",
            snippet: "",
            query: "Ống PVC D50",
            rankScore: 0,
          },
          {
            title: "Sản phẩm khác hoàn toàn",
            url: "https://example.com/unrelated",
            domain: "example.com",
            snippet: "không có bằng chứng vật tư",
            query: "Ống PVC D50",
            rankScore: 0,
          },
        ],
        warnings: [],
        unsafeRejectedUrls: ["https://unsafe.example/item"],
      })
      .mockResolvedValueOnce({
        results: [
          {
            title: "Đã từ chối 2",
            url: "https://example.com/rejected-wave-1",
            domain: "example.com",
            snippet: "",
            query: "Ống PVC D50",
            rankScore: 0,
          },
        ],
        warnings: [],
        unsafeRejectedUrls: [
          "https://unsafe.example/item",
          "https://unsafe.example/other",
        ],
      });
    vi.mocked(rankSearchResults).mockImplementation((results) => results);
    vi.mocked(enrichSearchResultsWithFetchedContent).mockImplementation(
      async (results) =>
        results.map((result) => ({ ...result, fetchStatus: "verified" })),
    );

    const result = await searchProfileRowWebLinks({ name: "Ống PVC D50" });

    expect(result.rejectedCount).toBe(4);
    expect(recordSearchAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        qualitySummary: expect.objectContaining({
          rejectedCount: 4,
          unsafeRejectedCount: 2,
          feedbackRejectedCount: 1,
        }),
      }),
    );
  });

  it("tries direct Bing once when SearXNG candidates all fail the identity gate", async () => {
    vi.mocked(resolveSearchQueryControls).mockResolvedValue({
      enableSiteVnVariants: true,
      enableNegativeMarketplaceVariants: true,
      materialJobMaxQueries: 6,
      interactiveMaxQueries: 1,
      excelResearchMaxQueries: 6,
    });
    vi.mocked(searchWebForProduct).mockResolvedValue({
      results: [
        {
          title: "Tin bóng đá mới nhất",
          url: "https://news.example/bong-da",
          domain: "news.example",
          snippet: "Kết quả thi đấu hôm nay",
          query: "Ống PVC D50 Bình Minh",
          rankScore: 1,
          provider: "searxng",
        },
      ],
      warnings: [],
      providers: ["searxng"],
      domainPolicy: { boostDomains: [], penaltyDomains: [], blockDomains: [] },
    });
    vi.mocked(searchBingForProduct).mockResolvedValue({
      results: [
        {
          title: "Ống nhựa PVC D50 Bình Minh PN10",
          url: "https://binhminhplastic.com.vn/ong-pvc-d50-pn10",
          domain: "binhminhplastic.com.vn",
          snippet: "Sản phẩm ống PVC D50 PN10 chính hãng Bình Minh",
          query: "Ống PVC D50 Bình Minh",
          rankScore: 1,
          provider: "bing",
        },
      ],
      warnings: ["Đã thử Bing trực tiếp sau khi lọc nhận dạng."],
      providers: ["bing"],
      domainPolicy: { boostDomains: [], penaltyDomains: [], blockDomains: [] },
    });
    vi.mocked(rankSearchResults).mockImplementation((results) => results);
    vi.mocked(enrichSearchResultsWithFetchedContent).mockImplementation(
      async (results) =>
        results.map((result) => ({ ...result, fetchStatus: "verified" })),
    );

    const result = await searchProfileRowWebLinks({
      name: "Ống PVC D50 Bình Minh",
      manufacturer: "Bình Minh",
      specText: "D50 PN10",
    });

    expect(searchBingForProduct).toHaveBeenCalledTimes(1);
    expect(result.webLinkResults.map((link) => link.url)).toContain(
      "https://binhminhplastic.com.vn/ong-pvc-d50-pn10",
    );
  });

  it("still tries direct Bing when SearXNG labels its engine results as Bing", async () => {
    vi.mocked(resolveSearchQueryControls).mockResolvedValue({
      enableSiteVnVariants: true,
      enableNegativeMarketplaceVariants: true,
      materialJobMaxQueries: 6,
      interactiveMaxQueries: 1,
      excelResearchMaxQueries: 6,
    });
    vi.mocked(searchWebForProduct).mockResolvedValue({
      results: [
        {
          title: "Tin bóng đá mới nhất",
          url: "https://news.example/bong-da",
          domain: "news.example",
          snippet: "Kết quả thi đấu hôm nay",
          query: "Ống PVC D50 Bình Minh",
          rankScore: 1,
          // SearXNG exposes the underlying engine label here. This does not
          // mean the guarded direct-Bing fallback has already run.
          provider: "bing",
        },
      ],
      warnings: [],
      providers: ["searxng"],
      directBingQueries: [],
    });
    vi.mocked(searchBingForProduct).mockResolvedValue({
      results: [],
      warnings: [],
      providers: ["bing"],
      directBingQueries: [],
    });
    vi.mocked(rankSearchResults).mockImplementation((results) => results);
    vi.mocked(enrichSearchResultsWithFetchedContent).mockImplementation(
      async (results) =>
        results.map((result) => ({ ...result, fetchStatus: "verified" })),
    );

    await searchProfileRowWebLinks({
      name: "Ống PVC D50 Bình Minh",
      manufacturer: "Bình Minh",
      specText: "D50 PN10",
    });

    expect(searchBingForProduct).toHaveBeenCalledTimes(1);
  });

  it("keeps irrelevant direct Bing results rejected after the rescue attempt", async () => {
    vi.mocked(resolveSearchQueryControls).mockResolvedValue({
      enableSiteVnVariants: true,
      enableNegativeMarketplaceVariants: true,
      materialJobMaxQueries: 6,
      interactiveMaxQueries: 1,
      excelResearchMaxQueries: 6,
    });
    vi.mocked(searchWebForProduct).mockResolvedValue({
      results: [
        {
          title: "Kết quả xổ số",
          url: "https://noise.example/xo-so",
          domain: "noise.example",
          snippet: "Tin không liên quan",
          query: "Ống PVC D50 Bình Minh",
          rankScore: 1,
          provider: "searxng",
        },
      ],
      warnings: [],
      providers: ["searxng"],
    });
    vi.mocked(searchBingForProduct).mockResolvedValue({
      results: [
        {
          title: "Tin thời tiết",
          url: "https://other.example/thoi-tiet",
          domain: "other.example",
          snippet: "Dự báo thời tiết hôm nay",
          query: "Ống PVC D50 Bình Minh",
          rankScore: 1,
          provider: "bing",
        },
      ],
      warnings: [],
      providers: ["bing"],
    });
    vi.mocked(rankSearchResults).mockImplementation((results) => results);

    const result = await searchProfileRowWebLinks({
      name: "Ống PVC D50 Bình Minh",
      manufacturer: "Bình Minh",
      specText: "D50 PN10",
    });

    expect(searchBingForProduct).toHaveBeenCalledTimes(1);
    expect(result.webLinkResults).toEqual([]);
  });

  it("does not run direct Bing again when the search response already included it", async () => {
    vi.mocked(resolveSearchQueryControls).mockResolvedValue({
      enableSiteVnVariants: true,
      enableNegativeMarketplaceVariants: true,
      materialJobMaxQueries: 6,
      interactiveMaxQueries: 1,
      excelResearchMaxQueries: 6,
    });
    vi.mocked(searchWebForProduct).mockResolvedValue({
      results: [
        {
          title: "Tin thời tiết",
          url: "https://other.example/thoi-tiet",
          domain: "other.example",
          snippet: "Dự báo thời tiết hôm nay",
          query: "Ống PVC D50 Bình Minh",
          rankScore: 1,
          provider: "bing",
        },
      ],
      warnings: [],
      providers: ["searxng", "bing"],
      directBingQueries: ["ống pvc d50 bình minh"],
    });
    vi.mocked(rankSearchResults).mockImplementation((results) => results);

    const result = await searchProfileRowWebLinks({
      name: "Ống PVC D50 Bình Minh",
      manufacturer: "Bình Minh",
      specText: "D50 PN10",
    });

    expect(searchBingForProduct).not.toHaveBeenCalled();
    expect(result.webLinkResults).toEqual([]);
  });

  it("rescues only mixed-response queries that have not already tried direct Bing", async () => {
    let searchCall = 0;
    let alreadyRescuedQuery = "";
    vi.mocked(searchWebForProduct).mockImplementation(async (queries) => {
      searchCall += 1;
      const normalized = queries.map((entry) =>
        (typeof entry === "string" ? entry : entry.query)
          .trim()
          .replace(/\s+/g, " ")
          .toLowerCase(),
      );
      if (searchCall === 1) {
        alreadyRescuedQuery = normalized[0]!;
        return {
          results: queries.map((entry, index) => {
            const query = typeof entry === "string" ? entry : entry.query;
            return {
              title: index === 0 ? "Tin thời tiết" : "Kết quả xổ số",
              url: `https://noise.example/first-${index}`,
              domain: "noise.example",
              snippet: "Nội dung không liên quan",
              query,
              rankScore: 1,
              provider: index === 0 ? ("bing" as const) : ("searxng" as const),
            };
          }),
          warnings: [],
          providers: ["searxng" as const, "bing" as const],
          directBingQueries: [alreadyRescuedQuery],
        };
      }
      return {
        results: queries.map((entry, index) => {
          const query = typeof entry === "string" ? entry : entry.query;
          return {
            title: "Tin thể thao",
            url: `https://noise.example/second-${index}`,
            domain: "noise.example",
            snippet: "Nội dung không liên quan",
            query,
            rankScore: 1,
            provider: "searxng" as const,
          };
        }),
        warnings: [],
        providers: ["searxng" as const],
        directBingQueries: [],
      };
    });
    vi.mocked(searchBingForProduct).mockResolvedValue({
      results: [],
      warnings: [],
      providers: ["bing"],
      directBingQueries: [],
    });
    vi.mocked(rankSearchResults).mockImplementation((results) => results);
    vi.mocked(enrichSearchResultsWithFetchedContent).mockImplementation(
      async (results) =>
        results.map((result) => ({ ...result, fetchStatus: "verified" })),
    );

    await searchProfileRowWebLinks({
      name: "Ống PVC D50 Bình Minh",
      manufacturer: "Bình Minh",
      specText: "D50 PN10",
    });

    expect(searchBingForProduct).toHaveBeenCalledTimes(1);
    const rescuedQueries = vi
      .mocked(searchBingForProduct)
      .mock.calls[0]![0].map((entry) =>
        (typeof entry === "string" ? entry : entry.query)
          .trim()
          .replace(/\s+/g, " ")
          .toLowerCase(),
      );
    expect(rescuedQueries).not.toContain(alreadyRescuedQuery);
    expect(rescuedQueries).toHaveLength(3);
  });
});
