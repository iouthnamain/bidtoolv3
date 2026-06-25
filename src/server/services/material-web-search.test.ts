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

  it("falls back to DuckDuckGo when SearXNG fails", async () => {
    vi.stubEnv("SEARXNG_BASE_URL", "http://searxng.test");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes("/search")) {
        throw new Error("fetch failed");
      }
      return new Response(
        `<a class="result__a" href="https://duck.example/item">Product</a><a class="result__snippet">Specs</a>`,
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { searchQueryWithFallback } = await import("./material-web-search");
    const { results, warnings } = await searchQueryWithFallback("ống PVC");

    expect(results).toHaveLength(1);
    expect(results[0]?.url).toBe("https://duck.example/item");
    expect(warnings.some((warning) => warning.includes("SearXNG"))).toBe(true);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        requestUrl(url).includes("duckduckgo"),
      ),
    ).toBe(true);
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
});
