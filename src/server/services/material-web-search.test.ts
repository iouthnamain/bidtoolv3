import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/services/search-audit", () => ({
  recordSearchAuditLog: vi.fn(),
}));

import { recordSearchAuditLog } from "~/server/services/search-audit";

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function bingHtml(input: { title: string; url: string; snippet: string }) {
  return `<ol id="b_results"><li class="b_algo"><h2><a href="${input.url}">${input.title}</a></h2><div class="b_caption"><p>${input.snippet}</p></div></li></ol>`;
}

describe("searchQueryWithFallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses primary SearXNG results without calling direct Bing", async () => {
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
                engines: ["bing", "yep"],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error("Direct Bing should not be called");
    });
    vi.stubGlobal("fetch", fetchMock);

    const { searchQueryWithFallback } = await import("./material-web-search");
    const response = await searchQueryWithFallback("ống PVC");
    const { results, warnings } = response;

    expect(results).toHaveLength(1);
    expect(results[0]?.url).toBe("https://example.com/spec.pdf");
    expect(results[0]?.engines).toEqual(["bing", "yep"]);
    expect(warnings).toEqual([]);
    expect(response.providers).toEqual(["searxng"]);
    expect(response.directBingQueries).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to direct Bing when SearXNG errors", async () => {
    vi.stubEnv("SEARXNG_BASE_URL", "http://searxng.test");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes("searxng.test")) {
        throw new Error("fetch failed");
      }
      if (url.includes("bing.com/search")) {
        return new Response(
          bingHtml({
            title: "Ống PVC Bình Minh D90",
            url: "https://binhminhplastic.com.vn/ong-pvc-d90",
            snippet: "Ống nhựa PVC D90 chính hãng Bình Minh",
          }),
          { status: 200, headers: { "Content-Type": "text/html" } },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { searchQueryWithFallback } = await import("./material-web-search");
    const response = await searchQueryWithFallback("ống PVC");
    const { results, warnings } = response;

    expect(results).toEqual([
      expect.objectContaining({
        title: "Ống PVC Bình Minh D90",
        url: "https://binhminhplastic.com.vn/ong-pvc-d90",
        provider: "bing",
      }),
    ]);
    expect(warnings.some((warning) => warning.includes("SearXNG"))).toBe(true);
    expect(response.providers).toEqual(["searxng", "bing"]);
    expect(response.directBingQueries).toEqual(["ống pvc"]);
    expect(recordSearchAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "bing_html",
        status: "success",
        resultCount: 1,
      }),
    );
    expect(
      fetchMock.mock.calls.some(([url]) =>
        new URL(requestUrl(url)).hostname.includes("bing.com"),
      ),
    ).toBe(true);
  });

  it("lets the guarded profile pipeline defer direct Bing rescue", async () => {
    vi.stubEnv("SEARXNG_BASE_URL", "http://searxng.test");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes("searxng.test")) {
        return new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected direct fallback: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { searchQueryWithFallback } = await import("./material-web-search");
    const response = await searchQueryWithFallback("ống PVC", undefined, {
      feature: "profile_search",
      allowDirectBingFallback: false,
    });

    expect(response.results).toEqual([]);
    expect(response.providers).toEqual(["searxng"]);
    expect(response.directBingQueries).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
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

  it("skips SearXNG HTML when disabled before using direct Bing", async () => {
    vi.stubEnv("SEARXNG_BASE_URL", "http://searxng.test");
    vi.stubEnv("SEARXNG_ENGINES", "bing");
    vi.stubEnv("SEARXNG_HTML_FALLBACK", "false");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes("format=json")) {
        return new Response("Forbidden", { status: 403 });
      }
      if (url.includes("bing.com/search")) {
        return new Response(
          bingHtml({
            title: "Ống PVC",
            url: "https://example.vn/ong-pvc",
            snippet: "Thông tin ống PVC",
          }),
          { status: 200, headers: { "Content-Type": "text/html" } },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { searchQueryWithFallback } = await import("./material-web-search");
    const { results, warnings } = await searchQueryWithFallback("ống PVC");

    expect(results).toHaveLength(1);
    expect(warnings.some((warning) => warning.includes("403"))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
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

  it("uses direct Bing when configured SearXNG engines return no results", async () => {
    vi.stubEnv("SEARXNG_BASE_URL", "http://searxng.test");
    vi.stubEnv("SEARXNG_ENGINES", "google,duckduckgo");
    vi.stubEnv("SEARXNG_HTML_FALLBACK", "false");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(requestUrl(input));
      if (url.hostname === "searxng.test") {
        expect(url.searchParams.get("engines")).toBe("google,duckduckgo");
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
      if (url.hostname.endsWith("bing.com")) {
        return new Response(
          bingHtml({
            title: "Sản phẩm - Công ty Cổ phần Nhựa Bình Minh",
            url: "https://binhminhplastic.com.vn/san-pham",
            snippet: "Ống nhựa PVC Bình Minh",
          }),
          { status: 200, headers: { "Content-Type": "text/html" } },
        );
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { searchQueryWithFallback } = await import("./material-web-search");
    const { results, warnings } = await searchQueryWithFallback(
      "Ống nhựa Bình Minh D90",
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.domain).toBe("binhminhplastic.com.vn");
    expect(results[0]?.provider).toBe("bing");
    expect(warnings.join(" ")).toContain("Bing trực tiếp");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("still uses direct Bing when Bing is configured inside an empty SearXNG response", async () => {
    vi.stubEnv("SEARXNG_BASE_URL", "http://searxng.test");
    vi.stubEnv("SEARXNG_ENGINES", "google,bing,duckduckgo");
    vi.stubEnv("SEARXNG_HTML_FALLBACK", "false");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(requestUrl(input));
      if (url.hostname === "searxng.test") {
        expect(url.searchParams.get("engines")).toBe("google,bing,duckduckgo");
        return new Response(
          JSON.stringify({
            results: [],
            unresponsive_engines: [["duckduckgo", "Suspended: access denied"]],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.hostname.endsWith("bing.com")) {
        return new Response(
          bingHtml({
            title: "Van tiết lưu",
            url: "https://example.vn/van-tiet-luu",
            snippet: "Thông tin van tiết lưu",
          }),
          { status: 200, headers: { "Content-Type": "text/html" } },
        );
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { searchQueryWithFallback } = await import("./material-web-search");
    const { results, warnings } = await searchQueryWithFallback("van tiết lưu");

    expect(results).toHaveLength(1);
    expect(results[0]?.url).toBe("https://example.vn/van-tiet-luu");
    expect(results[0]?.provider).toBe("bing");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses direct Bing when SearXNG is unconfigured", async () => {
    vi.stubEnv("SEARXNG_BASE_URL", "");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(requestUrl(input));
      expect(url.hostname).toBe("www.bing.com");
      return new Response(
        bingHtml({
          title: "Cáp điện CADIVI",
          url: "https://cadivi.vn/cap-dien",
          snippet: "Thông tin sản phẩm cáp điện CADIVI",
        }),
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { searchQueryWithFallback } = await import("./material-web-search");
    const response = await searchQueryWithFallback("cáp điện CADIVI");

    expect(response.results[0]).toEqual(
      expect.objectContaining({ provider: "bing", domain: "cadivi.vn" }),
    );
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

  it("keeps direct Bing searches isolated from the SearXNG primary cache", async () => {
    vi.stubEnv("SEARXNG_BASE_URL", "http://searxng.test");
    vi.stubEnv("ENRICHMENT_SEARCH_CACHE_TTL_MS", "60000");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(requestUrl(input));
      if (url.hostname === "searxng.test") {
        return new Response(
          JSON.stringify({
            results: [
              {
                title: "Kết quả không liên quan",
                url: "https://irrelevant.example/news",
                content: "Tin tức tổng hợp",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        bingHtml({
          title: "Ống PVC D90 Bình Minh",
          url: "https://binhminhplastic.com.vn/ong-pvc-d90",
          snippet: "Sản phẩm ống PVC D90 Bình Minh",
        }),
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { searchBingForProduct, searchWebForProduct } =
      await import("./material-web-search");
    const primary = await searchWebForProduct(["Ống PVC D90"]);
    const rescue = await searchBingForProduct(["Ống PVC D90"]);
    const cachedRescue = await searchBingForProduct(["  Ống   PVC D90  "]);

    expect(primary.results[0]?.provider).toBe("searxng");
    expect(rescue.results[0]?.provider).toBe("bing");
    expect(primary.directBingQueries).toEqual([]);
    expect(rescue.directBingQueries).toEqual(["ống pvc d90"]);
    expect(cachedRescue.directBingQueries).toEqual(["ống pvc d90"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("cancels an in-flight direct Bing request", async () => {
    vi.stubEnv("SEARXNG_BASE_URL", "http://searxng.test");
    const controller = new AbortController();
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        markStarted?.();
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true },
          );
        });
      }),
    );

    const { searchBingForProduct } = await import("./material-web-search");
    const pending = searchBingForProduct(["Ống PVC D90"], controller.signal, {
      feature: "test",
    });
    await started;
    controller.abort();

    await expect(pending).rejects.toThrow("Đã hủy tìm kiếm web.");
  });

  it("misses the product-search cache when relevant configuration changes", async () => {
    vi.stubEnv("SEARXNG_BASE_URL", "http://searxng.test");
    vi.stubEnv("SEARXNG_SAFE_SEARCH", "0");
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
    await searchWebForProduct(["Ống PVC 90"]);
    vi.stubEnv("SEARXNG_SAFE_SEARCH", "1");
    await searchWebForProduct(["Ống PVC 90"]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache a response when configuration changes during execution", async () => {
    vi.stubEnv("SEARXNG_BASE_URL", "http://searxng.test");
    vi.stubEnv("SEARXNG_SAFE_SEARCH", "0");
    vi.stubEnv("ENRICHMENT_SEARCH_CACHE_TTL_MS", "60000");
    const fetchMock = vi.fn(async () => {
      vi.stubEnv("SEARXNG_SAFE_SEARCH", "1");
      return new Response(
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
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { searchWebForProduct } = await import("./material-web-search");
    await searchWebForProduct(["Ống PVC race"]);
    vi.stubEnv("SEARXNG_SAFE_SEARCH", "0");
    await searchWebForProduct(["Ống PVC race"]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
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

  it("does not compound ranking boosts when fetched results are ranked again", async () => {
    const { rankSearchResults } = await import("./material-web-search");
    const input = {
      name: "Tủ điện treo tường 600x400x200mm",
      specText: "Thép sơn tĩnh điện",
      profileSearch: true,
    };
    const policy = {
      boostDomains: [],
      penaltyDomains: [],
      blockDomains: [],
    };
    const once = rankSearchResults(
      [
        {
          title: "Tủ điện treo tường 600x400x200mm",
          url: "https://thietbidien.example/tu-dien-600x400x200",
          domain: "thietbidien.example",
          snippet: "Sản phẩm tủ điện bằng thép sơn tĩnh điện.",
          query: "Tủ điện treo tường 600x400x200mm sản phẩm",
          rankScore: 0.5,
        },
      ],
      input,
      policy,
    );
    const twice = rankSearchResults(once, input, policy);

    expect(twice[0]?.rankScore).toBeCloseTo(once[0]?.rankScore ?? 0);
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

  it("excludes the SearXNG API key from the web cache fingerprint", async () => {
    const { createWebSearchConfigurationFingerprint } =
      await import("./material-web-search");
    const policy = {
      boostDomains: [],
      penaltyDomains: [],
      blockDomains: [],
    };
    const config = {
      baseUrl: "http://searxng.test",
      apiKey: "secret-a",
      engines: ["google"],
      language: "vi-VN",
      safeSearch: 2 as const,
      timeRange: "" as const,
      requestTimeoutMs: 12_000,
      htmlFallback: true,
      resultLimitPerQuery: 8,
    };

    expect(createWebSearchConfigurationFingerprint(config, policy)).toBe(
      createWebSearchConfigurationFingerprint(
        { ...config, apiKey: "secret-b" },
        policy,
      ),
    );
    expect(
      createWebSearchConfigurationFingerprint(
        { ...config, engines: ["bing"] },
        policy,
      ),
    ).not.toBe(createWebSearchConfigurationFingerprint(config, policy));
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

describe("guarded fusion and safety", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("enforces strict safe search for profile search even in legacy mode", async () => {
    vi.stubEnv("SEARXNG_BASE_URL", "http://searxng.test");
    vi.stubEnv("SEARXNG_SAFE_SEARCH", "0");
    vi.stubEnv("SEARCH_RELEVANCE_PIPELINE_MODE", "legacy");
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        urls.push(requestUrl(input));
        return new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    const { searchQueryWithFallback } = await import("./material-web-search");
    await searchQueryWithFallback("tủ điện", undefined, {
      feature: "profile_search",
      overrideEngines: ["google"],
    });
    expect(new URL(urls[0]!).searchParams.get("safesearch")).toBe("2");
  });

  it("filters explicit domains before returning results", async () => {
    const { applyDomainPolicy } = await import("./material-web-search");
    const results = applyDomainPolicy(
      [
        {
          title: "Adult video",
          url: "https://pornhub.com/item",
          domain: "pornhub.com",
          snippet: "",
          query: "item",
          rankScore: 1,
        },
      ],
      { boostDomains: [], penaltyDomains: [], blockDomains: [] },
    );
    expect(results).toEqual([]);
  });
});
