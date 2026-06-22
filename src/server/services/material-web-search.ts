import "server-only";

import { resolveSearxngBaseUrl } from "~/server/services/app-settings";
import { createLogger, traceFn } from "~/server/lib/logger";
const log = createLogger("material-web-search");

export type WebSearchResult = {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  query: string;
  rankScore: number;
};

const DUCKDUCKGO_HTML_URL = "https://html.duckduckgo.com/html/";
const DUCKDUCKGO_LITE_URL = "https://lite.duckduckgo.com/lite/";
const MARKETPLACE_DOMAINS = ["shopee.vn", "lazada.vn", "tiki.vn", "sendo.vn"];
const SEARCH_TIMEOUT_MS = 12_000;
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export type WebSearchResponse = {
  results: WebSearchResult[];
  warnings: string[];
};

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new Error("Đã hủy tìm kiếm web.");
  }
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripHtmlTags(value: string) {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function extractDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function unwrapDuckDuckGoRedirect(url: string) {
  try {
    const parsed = new URL(url, "https://duckduckgo.com");
    const uddg = parsed.searchParams.get("uddg");
    if (uddg) {
      return decodeURIComponent(uddg);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function parseDuckDuckGoLiteHtml(html: string, query: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const seen = new Set<string>();
  const linkPattern =
    /<a[^>]*rel="nofollow"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(html)) !== null) {
    const rawUrl = unwrapDuckDuckGoRedirect(match[1] ?? "");
    const title = stripHtmlTags(match[2] ?? "");
    if (!rawUrl || !title || rawUrl.includes("duckduckgo.com")) {
      continue;
    }
    if (seen.has(rawUrl)) {
      continue;
    }
    seen.add(rawUrl);
    results.push({
      title,
      url: rawUrl,
      domain: extractDomain(rawUrl),
      snippet: "",
      query,
      rankScore: 0,
    });
  }

  return results;
}

function parseDuckDuckGoHtml(html: string, query: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const seen = new Set<string>();
  const blockPattern =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>|<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>)/gi;

  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(html)) !== null) {
    const rawUrl = unwrapDuckDuckGoRedirect(match[1] ?? "");
    const title = stripHtmlTags(match[2] ?? "");
    const snippet = stripHtmlTags(match[3] ?? match[4] ?? "");
    if (!rawUrl || !title) {
      continue;
    }
    const normalizedUrl = rawUrl.trim();
    if (seen.has(normalizedUrl)) {
      continue;
    }
    seen.add(normalizedUrl);
    results.push({
      title,
      url: normalizedUrl,
      domain: extractDomain(normalizedUrl),
      snippet,
      query,
      rankScore: 0,
    });
  }

  if (results.length > 0) {
    return results;
  }

  const fallbackPattern =
    /<a[^>]*class="[^"]*result__url[^"]*"[^>]*href="([^"]+)"[^>]*>[\s\S]*?<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  while ((match = fallbackPattern.exec(html)) !== null) {
    const rawUrl = unwrapDuckDuckGoRedirect(match[2] ?? match[1] ?? "");
    const title = stripHtmlTags(match[3] ?? "");
    const snippet = stripHtmlTags(match[4] ?? "");
    if (!rawUrl || !title || seen.has(rawUrl)) {
      continue;
    }
    seen.add(rawUrl);
    results.push({
      title,
      url: rawUrl,
      domain: extractDomain(rawUrl),
      snippet,
      query,
      rankScore: 0,
    });
  }

  return results;
}

function searchTimeoutSignal(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
  if (!signal) {
    return timeout;
  }
  return AbortSignal.any([signal, timeout]);
}

async function searxngBaseUrls(): Promise<string[]> {
  const configured = (await resolveSearxngBaseUrl())?.trim();
  if (configured) {
    return [configured.replace(/\/$/, "")];
  }
  // Fallback: try common local ports
  return ["http://localhost:8888", "http://127.0.0.1:8888"];
}

async function searchSearxngQuery(
  query: string,
  signal?: AbortSignal,
): Promise<WebSearchResult[]> {
  const warnings: string[] = [];

  for (const base of await searxngBaseUrls()) {
    try {
      const url = new URL("/search", `${base}/`);
      url.searchParams.set("q", query);
      url.searchParams.set("format", "json");
      url.searchParams.set("language", "vi-VN");
      url.searchParams.set("engines", "google,bing");

      const response = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        signal: searchTimeoutSignal(signal),
      });

      if (!response.ok) {
        warnings.push(`SearXNG (${base}): HTTP ${response.status}.`);
        continue;
      }

      const data = (await response.json()) as {
        results?: Array<{
          title?: string;
          url?: string;
          content?: string;
        }>;
      };

      const results = (data.results ?? [])
        .map((item) => {
          const normalizedUrl = item.url?.trim() ?? "";
          const title = item.title?.trim() ?? "";
          if (!normalizedUrl || !title) {
            return null;
          }
          return {
            title,
            url: normalizedUrl,
            domain: extractDomain(normalizedUrl),
            snippet: item.content?.trim() ?? "",
            query,
            rankScore: 0,
          } satisfies WebSearchResult;
        })
        .filter((item): item is WebSearchResult => item != null);

      if (results.length > 0) {
        return results;
      }
      warnings.push(`SearXNG (${base}): không có kết quả cho "${query}".`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Lỗi tìm kiếm không xác định.";
      warnings.push(`SearXNG (${base}): ${message}`);
    }
  }

  if (warnings.length > 0) {
    log.warn("searxng_warnings", { query, warnings });
  }

  return [];
}

async function searchDuckDuckGoEndpoint(
  endpoint: string,
  query: string,
  parser: (html: string, query: string) => WebSearchResult[],
  signal?: AbortSignal,
): Promise<WebSearchResult[]> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": DEFAULT_USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
    body: new URLSearchParams({ q: query }).toString(),
    signal: searchTimeoutSignal(signal),
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo search failed (${response.status}) for: ${query}`);
  }

  const html = await response.text();
  return parser(html, query);
}

async function searchDuckDuckGoQuery(
  query: string,
  signal?: AbortSignal,
): Promise<WebSearchResult[]> {
  const attempts: Array<{
    label: string;
    run: () => Promise<WebSearchResult[]>;
  }> = [
    {
      label: "DuckDuckGo Lite",
      run: () =>
        searchDuckDuckGoEndpoint(
          DUCKDUCKGO_LITE_URL,
          query,
          parseDuckDuckGoLiteHtml,
          signal,
        ),
    },
    {
      label: "DuckDuckGo HTML",
      run: () =>
        searchDuckDuckGoEndpoint(
          DUCKDUCKGO_HTML_URL,
          query,
          parseDuckDuckGoHtml,
          signal,
        ),
    },
  ];

  const warnings: string[] = [];
  for (const attempt of attempts) {
    try {
      const results = await attempt.run();
      if (results.length > 0) {
        return results;
      }
      warnings.push(`${attempt.label}: không có kết quả cho "${query}".`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Lỗi tìm kiếm không xác định.";
      warnings.push(`${attempt.label}: ${message}`);
    }
  }

  if (warnings.length > 0) {
    log.warn("duckduckgo_warnings", { query, warnings });
  }

  return [];
}

async function _fetchUrlAsSearchResult(
  url: string,
  query = "known_source",
  signal?: AbortSignal,
): Promise<WebSearchResult | null> {
  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const response = await fetch(trimmed, {
      headers: {
        "User-Agent": DEFAULT_USER_AGENT,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      },
      signal: searchTimeoutSignal(signal),
      redirect: "follow",
    });

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/pdf")) {
      return null;
    }

    const body = await response.text();
    const titlePattern = /<title[^>]*>([\s\S]*?)<\/title>/i;
    const titleMatch = titlePattern.exec(body);
    const title = stripHtmlTags(titleMatch?.[1] ?? "") || trimmed;
    const snippet = stripHtmlTags(body).slice(0, 600);

    return {
      title,
      url: response.url || trimmed,
      domain: extractDomain(response.url || trimmed),
      snippet,
      query,
      rankScore: 0.4,
    };
  } catch {
    return null;
  }
}

async function _fetchKnownSourceCandidates(
  urls: string[],
  signal?: AbortSignal,
): Promise<WebSearchResult[]> {
  const results: WebSearchResult[] = [];
  const seen = new Set<string>();

  for (const url of urls) {
    const trimmed = url.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    const candidate = await fetchUrlAsSearchResult(trimmed, "known_source", signal);
    if (candidate) {
      results.push(candidate);
    }
  }

  return results;
}

async function _searchQueryWithFallback(
  query: string,
  signal?: AbortSignal,
): Promise<WebSearchResponse> {
  const warnings: string[] = [];
  const providers: Array<{
    name: string;
    run: () => Promise<WebSearchResult[]>;
  }> = [
    {
      name: "SearXNG",
      run: () => searchSearxngQuery(query, signal),
    },
    {
      name: "DuckDuckGo",
      run: () => searchDuckDuckGoQuery(query, signal),
    },
  ];

  for (const provider of providers) {
    try {
      const results = await provider.run();
      if (results.length > 0) {
        return { results, warnings };
      }
      warnings.push(`${provider.name}: không có kết quả cho "${query}".`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Lỗi tìm kiếm không xác định.";
      warnings.push(`${provider.name}: ${message}`);
    }
  }

  return { results: [], warnings };
}

async function _searchWebForProduct(
  queries: string[],
  signal?: AbortSignal,
): Promise<WebSearchResponse> {
  const uniqueQueries = [
    ...new Set(queries.map((query) => query.trim()).filter(Boolean)),
  ];
  const merged: WebSearchResult[] = [];
  const seenUrls = new Set<string>();
  const warnings: string[] = [];

  for (const query of uniqueQueries) {
    throwIfAborted(signal);
    const { results, warnings: queryWarnings } = await searchQueryWithFallback(
      query,
      signal,
    );
    warnings.push(...queryWarnings);

    for (const result of results) {
      if (seenUrls.has(result.url)) {
        continue;
      }
      seenUrls.add(result.url);
      merged.push(result);
    }
  }

  if (merged.length === 0 && warnings.length > 0) {
    log.warn("web_search_no_results", { warnings });
  }

  return { results: merged, warnings };
}

function hostnameMatchesManufacturer(domain: string, manufacturer: string) {
  const normalizedDomain = domain.toLowerCase();
  const tokens = manufacturer
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
  return tokens.some((token) => normalizedDomain.includes(token));
}

function isMarketplaceDomain(domain: string) {
  const normalized = domain.toLowerCase();
  return MARKETPLACE_DOMAINS.some(
    (marketplace) =>
      normalized === marketplace || normalized.endsWith(`.${marketplace}`),
  );
}

function _rankSearchResults(
  results: WebSearchResult[],
  input: { manufacturer?: string | null; name?: string | null; sourceUrl?: string | null },
): WebSearchResult[] {
  const manufacturer = input.manufacturer?.trim() ?? "";
  const name = input.name?.trim().toLowerCase() ?? "";
  const sourceDomain = input.sourceUrl ? extractDomain(input.sourceUrl) : "";

  const scored = results.map((result) => {
    let score = 0;
    const domain = result.domain.toLowerCase();
    const title = result.title.toLowerCase();
    const snippet = result.snippet.toLowerCase();

    if (manufacturer && hostnameMatchesManufacturer(domain, manufacturer)) {
      score += 0.35;
    }
    if (/\.pdf(?:$|[?#])/i.test(result.url)) {
      score += 0.3;
    }
    if (sourceDomain && domain === sourceDomain) {
      score += 0.2;
    }
    if (name) {
      const nameTokens = name.split(/\s+/).filter((token) => token.length > 2);
      const hits = nameTokens.filter(
        (token) => title.includes(token) || snippet.includes(token),
      ).length;
      if (nameTokens.length > 0) {
        score += (hits / nameTokens.length) * 0.25;
      }
    }
    if (isMarketplaceDomain(domain)) {
      score -= 0.25;
    }

    return { ...result, rankScore: score };
  });

  const nonMarketplace = scored.filter(
    (result) => !isMarketplaceDomain(result.domain),
  );
  const pool = nonMarketplace.length > 0 ? nonMarketplace : scored;

  return [...pool].sort((left, right) => right.rankScore - left.rankScore);
}

function _extractPdfUrlsFromResults(results: WebSearchResult[]) {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const result of results) {
    if (!/\.pdf(?:$|[?#])/i.test(result.url)) {
      continue;
    }
    if (seen.has(result.url)) {
      continue;
    }
    seen.add(result.url);
    urls.push(result.url);
  }
  return urls;
}

export const fetchUrlAsSearchResult = traceFn(log, "fetchUrlAsSearchResult", _fetchUrlAsSearchResult);
export const fetchKnownSourceCandidates = traceFn(log, "fetchKnownSourceCandidates", _fetchKnownSourceCandidates);
export const searchQueryWithFallback = traceFn(log, "searchQueryWithFallback", _searchQueryWithFallback);
export const searchWebForProduct = traceFn(log, "searchWebForProduct", _searchWebForProduct);
export const rankSearchResults = traceFn(log, "rankSearchResults", _rankSearchResults);
export const extractPdfUrlsFromResults = traceFn(log, "extractPdfUrlsFromResults", _extractPdfUrlsFromResults);
