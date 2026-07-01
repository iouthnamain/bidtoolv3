import { afterEach, describe, expect, it, vi } from "vitest";

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

describe("searchQueryWithFallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses SearXNG results when configured and DuckDuckGo is not called", async () => {
    vi.stubEnv("SEARXNG_BASE_URL", "http://searxng.test");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes("searxng.test")) {
        return new Response(
          JSON.stringify({
            results: [
              {
                title: "Catalog PDF",
                url: "https://example.com/spec.pdf",
                content: "Product datasheet",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("127.0.0.1:8888") || url.includes("localhost:8888")) {
        return new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error("DuckDuckGo should not be called");
    });
    vi.stubGlobal("fetch", fetchMock);

    const { searchQueryWithFallback } = await import("./material-web-search");
    const { results, warnings } = await searchQueryWithFallback("ống PVC");

    expect(results).toHaveLength(1);
    expect(results[0]?.url).toBe("https://example.com/spec.pdf");
    expect(warnings).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not call DuckDuckGo when SearXNG fails", async () => {
    vi.stubEnv("SEARXNG_BASE_URL", "http://searxng.test");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes("searxng.test")) {
        throw new Error("fetch failed");
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { searchQueryWithFallback } = await import("./material-web-search");
    const { results, warnings } = await searchQueryWithFallback("ống PVC");

    expect(results).toEqual([]);
    expect(warnings.some((warning) => warning.includes("SearXNG"))).toBe(true);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        new URL(requestUrl(url)).hostname.includes("duckduckgo"),
      ),
    ).toBe(false);
  });

  it("falls back to SearXNG HTML when JSON API returns 403", async () => {
    vi.stubEnv("SEARXNG_BASE_URL", "http://searxng.test");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (!url.includes("searxng.test")) {
        throw new Error("DuckDuckGo should not be called");
      }
      if (url.includes("format=json")) {
        return new Response("Forbidden", { status: 403 });
      }
      return new Response(
        `<article class="result result-default category-general"><a href="https://example.com/spec.pdf" class="url_header" rel="noreferrer"></a><h3><a href="https://example.com/spec.pdf" rel="noreferrer">Catalog PDF</a></h3><p class="content">Product datasheet</p></article>`,
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { searchQueryWithFallback } = await import("./material-web-search");
    const { results, warnings } = await searchQueryWithFallback("ống PVC");

    expect(results).toHaveLength(1);
    expect(results[0]?.url).toBe("https://example.com/spec.pdf");
    expect(warnings.some((warning) => warning.includes("403"))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends SearXNG auth header when SEARXNG_API_KEY is configured", async () => {
    vi.stubEnv("SEARXNG_BASE_URL", "http://searxng.test");
    vi.stubEnv("SEARXNG_API_KEY", "secret-token");

    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer secret-token",
        });
        return new Response(
          JSON.stringify({
            results: [
              {
                title: "Catalog PDF",
                url: "https://example.com/spec.pdf",
                content: "Product datasheet",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { searchQueryWithFallback } = await import("./material-web-search");
    const { results } = await searchQueryWithFallback("ống PVC");

    expect(results).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not fall back to HTML when disabled", async () => {
    vi.stubEnv("SEARXNG_BASE_URL", "http://searxng.test");
    vi.stubEnv("SEARXNG_HTML_FALLBACK", "false");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes("format=json")) {
        return new Response("Forbidden", { status: 403 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { searchQueryWithFallback } = await import("./material-web-search");
    const { results, warnings } = await searchQueryWithFallback("ống PVC");

    expect(results).toEqual([]);
    expect(warnings.some((warning) => warning.includes("403"))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns empty results without throwing when all providers fail", async () => {
    vi.stubEnv("SEARXNG_BASE_URL", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fetch failed");
      }),
    );

    const { searchQueryWithFallback } = await import("./material-web-search");
    const { results, warnings } = await searchQueryWithFallback("ống PVC");

    expect(results).toEqual([]);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("fetches a known source URL as a search candidate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            "<html><title>Ống PVC 90</title><body>Thông số kỹ thuật</body></html>",
            {
              status: 200,
              headers: { "Content-Type": "text/html" },
            },
          ),
      ),
    );

    const { fetchUrlAsSearchResult } = await import("./material-web-search");
    const result = await fetchUrlAsSearchResult(
      "https://example.com/product/pvc",
    );

    expect(result?.title).toBe("Ống PVC 90");
    expect(result?.snippet).toContain("Thông số");
  });

  it("caches repeated product searches for a short TTL", async () => {
    vi.stubEnv("SEARXNG_BASE_URL", "http://searxng.test");
    vi.stubEnv("ENRICHMENT_SEARCH_CACHE_TTL_MS", "60000");
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: [
              {
                title: "Ống PVC 90",
                url: "https://example.com/pvc-90",
                content: "Thông số kỹ thuật",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { searchWebForProduct } = await import("./material-web-search");
    const first = await searchWebForProduct(["Ống PVC 90"]);
    const second = await searchWebForProduct(["  Ống   PVC 90  "]);

    expect(first.results).toHaveLength(1);
    expect(second.results).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("boosts VN domains, product codes, and PDF URLs when ranking", async () => {
    const { rankSearchResults } = await import("./material-web-search");
    const ranked = rankSearchResults(
      [
        {
          title: "Generic listing",
          url: "https://marketplace.example/item",
          domain: "marketplace.example",
          snippet: "buy pvc pipe",
          query: "pvc",
          rankScore: 0,
        },
        {
          title: "PVC-D90 datasheet Bình Minh",
          url: "https://binhminh.vn/catalog/pvc-d90.pdf",
          domain: "binhminh.vn",
          snippet: "Thông số kỹ thuật catalog",
          query: "pvc filetype:pdf",
          rankScore: 0,
        },
      ],
      {
        manufacturer: "Bình Minh",
        name: "Ống PVC D90",
        code: "PVC-D90",
      },
    );

    expect(ranked[0]?.url).toContain("binhminh.vn");
    expect(ranked[0]?.rankScore ?? 0).toBeGreaterThan(
      ranked[1]?.rankScore ?? 0,
    );
  });

  it("builds SearXNG URL with configured engines, language, safesearch and time range", async () => {
    const { buildSearxngUrl } = await import("./material-web-search");
    const url = buildSearxngUrl(
      "http://searxng.test/",
      "Ống nhựa Bình Minh D90",
      {
        baseUrl: "http://searxng.test",
        apiKey: null,
        engines: ["google", "bing", "duckduckgo"],
        language: "vi-VN",
        safeSearch: 0,
        timeRange: "month",
        requestTimeoutMs: 12000,
        htmlFallback: true,
        resultLimitPerQuery: 8,
      },
      "json",
    );

    expect(url.toString()).toContain("/search?");
    expect(url.searchParams.get("q")).toBe("Ống nhựa Bình Minh D90");
    expect(url.searchParams.get("format")).toBe("json");
    expect(url.searchParams.get("engines")).toBe("google,bing,duckduckgo");
    expect(url.searchParams.get("language")).toBe("vi-VN");
    expect(url.searchParams.get("safesearch")).toBe("0");
    expect(url.searchParams.get("time_range")).toBe("month");
  });

  it("filters hard-blocked domains before ranking", async () => {
    const { applyDomainPolicy } = await import("./material-web-search");
    const filtered = applyDomainPolicy(
      [
        {
          title: "Marketplace",
          url: "https://shopee.vn/item",
          domain: "shopee.vn",
          snippet: "",
          query: "ống",
          rankScore: 0,
        },
        {
          title: "Supplier",
          url: "https://binhminhplastic.com.vn/pvc",
          domain: "binhminhplastic.com.vn",
          snippet: "",
          query: "ống",
          rankScore: 0,
        },
      ],
      {
        boostDomains: [],
        penaltyDomains: [],
        blockDomains: ["shopee.vn"],
      },
    );

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.domain).toBe("binhminhplastic.com.vn");
    expect(filtered.some((result) => result.domain === "shopee.vn")).toBe(
      false,
    );
  });
});
