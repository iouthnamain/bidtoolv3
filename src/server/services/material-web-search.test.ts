import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/services/search-audit", () => ({
  recordSearchAuditLog: vi.fn(),
}));

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

  it("reports SearXNG engine failures when no results are returned", async () => {
    vi.stubEnv("SEARXNG_BASE_URL", "http://searxng.test");
    vi.stubEnv("SEARXNG_HTML_FALLBACK", "false");

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              results: [],
              unresponsive_engines: [
                ["duckduckgo", "Suspended: access denied"],
                ["startpage", "Suspended: CAPTCHA"],
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    const { searchQueryWithFallback } = await import("./material-web-search");
    const { results, warnings } = await searchQueryWithFallback("cadivi");

    expect(results).toEqual([]);
    expect(warnings.join(" ")).toContain("engine không phản hồi");
    expect(warnings.join(" ")).toContain("duckduckgo");
    expect(warnings.join(" ")).toContain("không có kết quả");
  });

  it("retries with Bing through SearXNG when configured engines return no results", async () => {
    vi.stubEnv("SEARXNG_BASE_URL", "http://searxng.test");
    vi.stubEnv("SEARXNG_ENGINES", "google,duckduckgo");
    vi.stubEnv("SEARXNG_HTML_FALLBACK", "false");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(requestUrl(input));
      const engines = url.searchParams.get("engines");
      if (engines === "google,duckduckgo") {
        return new Response(
          JSON.stringify({
            results: [],
            unresponsive_engines: [
              ["google", "HTTP connection error"],
              ["duckduckgo", "Suspended: access denied"],
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (engines === "bing") {
        return new Response(
          JSON.stringify({
            results: [
              {
                title: "Sản phẩm - Công ty Cổ phần Nhựa Bình Minh",
                url: "https://binhminhplastic.com.vn/san-pham",
                content: "Ống nhựa PVC Bình Minh",
                score: 1,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`unexpected engines: ${engines}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { searchQueryWithFallback } = await import("./material-web-search");
    const { results, warnings } = await searchQueryWithFallback(
      "Ống nhựa Bình Minh D90",
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.domain).toBe("binhminhplastic.com.vn");
    expect(warnings.join(" ")).toContain("đã thử lại bằng Bing");
    expect(fetchMock).toHaveBeenCalledTimes(2);
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

  it("does not classify a generic Open Graph page as a product offer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            '<html><head><meta property="og:type" content="website" /></head><title>Giới thiệu</title><body>Nội dung chung</body></html>',
            {
              status: 200,
              headers: { "Content-Type": "text/html" },
            },
          ),
      ),
    );

    const { fetchUrlAsSearchResult } = await import("./material-web-search");
    const result = await fetchUrlAsSearchResult("https://example.com/about");

    expect(result?.rankReasons).not.toContain("fetched_product_offer");
  });

  it("does not read PDF responses as text snippets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("%PDF-1.7\u0000binary", {
            status: 200,
            headers: { "Content-Type": "application/pdf" },
          }),
      ),
    );

    const { fetchUrlAsSearchResult } = await import("./material-web-search");
    const result = await fetchUrlAsSearchResult(
      "https://example.com/catalog.pdf",
    );

    expect(result).toBeNull();
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

  it("deduplicates repeated warnings across product query variants", async () => {
    vi.stubEnv("SEARXNG_BASE_URL", "http://searxng.test");
    vi.stubEnv("SEARXNG_ENGINES", "google,duckduckgo");
    vi.stubEnv("SEARXNG_HTML_FALLBACK", "false");

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              results: [],
              unresponsive_engines: [["duckduckgo", "CAPTCHA"]],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    const { searchWebForProduct } = await import("./material-web-search");
    const response = await searchWebForProduct(
      ["query one", "query two"],
      undefined,
      {
        feature: "test",
      },
    );

    const engineWarnings = response.warnings.filter((warning) =>
      warning.includes("engine không phản hồi"),
    );
    const retryWarnings = response.warnings.filter((warning) =>
      warning.includes("đã thử lại bằng Bing"),
    );

    expect(engineWarnings).toHaveLength(1);
    expect(retryWarnings).toHaveLength(1);
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

  it("demotes steel sizing pages for plastic/PVC pipe queries", async () => {
    const { rankSearchResults } = await import("./material-web-search");
    const ranked = rankSearchResults(
      [
        {
          title: "Bảng tra kích thước ống thép tiêu chuẩn",
          url: "https://thepong.vn/bang-tra-kich-thuoc-ong-thep.htm",
          domain: "thepong.vn",
          snippet: "Bảng quy đổi kích thước ống thép DN Phi Inch",
          query: "Ống nhựa Bình Minh D90 thông số kỹ thuật",
          rankScore: 1,
        },
        {
          title: "Sản phẩm - Công ty Cổ phần Nhựa Bình Minh",
          url: "https://binhminhplastic.com.vn/san-pham",
          domain: "binhminhplastic.com.vn",
          snippet: "Ống và phụ tùng uPVC, HDPE, PPR, Nhựa Bình Minh",
          query: "binhminhplastic PVC D90",
          rankScore: 0.4,
        },
      ],
      {
        manufacturer: "Bình Minh",
        name: "Ống nhựa Bình Minh D90",
      },
    );

    expect(ranked[0]?.domain).toBe("binhminhplastic.com.vn");
    expect(ranked[1]?.rankReasons ?? []).toContain("plastic_family_mismatch");
  });

  it("ranks concrete spec overlap above generic spec keyword results", async () => {
    const { rankSearchResults } = await import("./material-web-search");
    const ranked = rankSearchResults(
      [
        {
          title: "Catalog thiết bị điện",
          url: "https://example.vn/catalog",
          domain: "example.vn",
          snippet: "Thông số kỹ thuật chung cho nhiều sản phẩm",
          query: "catalog thông số",
          rankScore: 0,
        },
        {
          title: "Cáp CVV CADIVI",
          url: "https://cadivi.vn/cvv-2x2-5",
          domain: "cadivi.vn",
          snippet: "Cáp CVV ruột đồng 2x2.5mm2 cách điện PVC",
          query: "CVV 2x2.5",
          rankScore: 0,
        },
      ],
      {
        name: "Cáp điện hạ thế",
        specText: "Ruột đồng 2x2.5mm2 cách điện PVC",
      },
    );

    expect(ranked[0]?.domain).toBe("cadivi.vn");
    expect(ranked[0]?.rankReasons ?? []).toContain("spec_overlap");
  });

  it("boosts profile shop/product and public-price evidence separately", async () => {
    const { rankSearchResults } = await import("./material-web-search");
    const results = [
      {
        title: "Ống PVC D90 tại cửa hàng vật tư",
        url: "https://vatlieu.example/san-pham/ong-pvc-d90",
        domain: "vatlieu.example",
        snippet: "Sản phẩm còn hàng.",
        query: "Ống PVC D90 sản phẩm",
        rankScore: 0,
      },
      {
        title: "Ống PVC D90 tại cửa hàng vật tư",
        url: "https://vatlieu.example/san-pham/ong-pvc-d90-gia",
        domain: "vatlieu.example",
        snippet: "Sản phẩm còn hàng. Giá bán: 125.000 ₫/m.",
        query: "Ống PVC D90 giá bán",
        rankScore: 0,
      },
    ];

    const ranked = rankSearchResults(
      results,
      { name: "Ống PVC D90", profileSearch: true },
      { boostDomains: [], penaltyDomains: [], blockDomains: [] },
    );
    const shopOnly = ranked.find((result) => result.url.endsWith("d90"));
    const priced = ranked.find((result) => result.url.endsWith("d90-gia"));

    expect(ranked[0]?.url).toBe(
      "https://vatlieu.example/san-pham/ong-pvc-d90-gia",
    );
    expect(shopOnly?.rankReasons).toContain("profile_product_or_shop_signal");
    expect(shopOnly?.rankReasons).not.toContain("profile_public_price_signal");
    expect(priced?.rankReasons).toContain("profile_product_or_shop_signal");
    expect(priced?.rankReasons).toContain("profile_public_price_signal");
    expect(priced?.rankScore ?? 0).toBeGreaterThan(shopOnly?.rankScore ?? 0);
  });

  it("does not mistake a product size after a price label for public-price evidence", async () => {
    const { rankSearchResults } = await import("./material-web-search");
    const [result] = rankSearchResults(
      [
        {
          title: "Bảng giá bán ống PVC D20",
          url: "https://vatlieu.example/san-pham/ong-pvc-d20",
          domain: "vatlieu.example",
          snippet: "Sản phẩm ống PVC kích thước D20 còn hàng.",
          query: "Ống PVC D20 giá bán",
          rankScore: 0,
        },
      ],
      { name: "Ống PVC D20", profileSearch: true },
      { boostDomains: [], penaltyDomains: [], blockDomains: [] },
    );

    expect(result?.rankReasons).toContain("profile_product_or_shop_signal");
    expect(result?.rankReasons).not.toContain("profile_public_price_signal");
  });

  it("does not apply profile evidence boosts outside profile search", async () => {
    const { rankSearchResults } = await import("./material-web-search");
    const [result] = rankSearchResults(
      [
        {
          title: "Ống PVC D90 tại cửa hàng",
          url: "https://vatlieu.example/san-pham/ong-pvc-d90",
          domain: "vatlieu.example",
          snippet: "Giá bán: 125.000 ₫/m.",
          query: "Ống PVC D90 giá bán",
          rankScore: 0,
        },
      ],
      { name: "Ống PVC D90" },
      { boostDomains: [], penaltyDomains: [], blockDomains: [] },
    );

    expect(result?.rankReasons).not.toContain("profile_product_or_shop_signal");
    expect(result?.rankReasons).not.toContain("profile_public_price_signal");
  });

  it("keeps marketplace penalties ahead of profile shop and price boosts", async () => {
    const { rankSearchResults } = await import("./material-web-search");
    const ranked = rankSearchResults(
      [
        {
          title: "Ống PVC D90 - Sản phẩm cửa hàng",
          url: "https://shopee.vn/ong-pvc-d90",
          domain: "shopee.vn",
          snippet: "Giá bán: 125.000 ₫/m.",
          query: "Ống PVC D90 giá bán",
          rankScore: 0,
        },
        {
          title: "Ống PVC D90 - Sản phẩm cửa hàng",
          url: "https://vatlieu.example/san-pham/ong-pvc-d90",
          domain: "vatlieu.example",
          snippet: "Giá bán: 125.000 ₫/m.",
          query: "Ống PVC D90 giá bán",
          rankScore: 0,
        },
      ],
      { name: "Ống PVC D90", profileSearch: true },
      { boostDomains: [], penaltyDomains: ["shopee.vn"], blockDomains: [] },
    );

    const marketplace = ranked.find((result) => result.domain === "shopee.vn");
    expect(ranked[0]?.domain).toBe("vatlieu.example");
    expect(marketplace?.rankReasons).toContain("penalty_domain");
    expect(marketplace?.rankReasons).not.toContain(
      "profile_product_or_shop_signal",
    );
    expect(marketplace?.rankReasons).not.toContain(
      "profile_public_price_signal",
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

  it("ranks fetched Product/Offer shop evidence above generic information", async () => {
    const { rankSearchResults } = await import("./material-web-search");
    const ranked = rankSearchResults(
      [
        {
          title: "Thông tin kỹ thuật van DN50",
          url: "https://info.example/van-dn50",
          domain: "info.example",
          snippet: "Van DN50 PN16 220V Kosaplus",
          query: "van DN50",
          rankScore: 0,
        },
        {
          title: "Van Kosaplus KE-050",
          url: "https://shop.example/san-pham/ke-050",
          domain: "shop.example",
          snippet: "Van DN50 PN16 220V còn hàng",
          query: "van DN50",
          rankScore: 0,
          rankReasons: ["fetched_product_offer"],
        },
      ],
      {
        name: "Van bướm điều khiển điện",
        manufacturer: "Kosaplus",
        code: "KE-050",
        specText: "DN50 PN16 220V",
        category: "Van công nghiệp",
        unit: "cái",
        originCountry: "Hàn Quốc",
        profileSearch: true,
      },
    );

    expect(ranked[0]?.domain).toBe("shop.example");
    expect(ranked[0]?.rankReasons).toContain("profile_fetched_product_offer");
  });
});
