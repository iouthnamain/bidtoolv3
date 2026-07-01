import "server-only";

import {
  resolveEnrichmentSearchCacheTtlMs,
  resolveEnrichmentWebConcurrency,
  resolveSearchDomainPolicy,
  resolveSearxngSearchConfig,
  type SearchDomainPolicy,
  type SearxngSearchConfig,
} from "~/server/services/app-settings";
import { createAsyncLimiter } from "~/server/services/concurrency";
import { createLogger, traceFn } from "~/server/lib/logger";
import { extractEnrichmentPageText } from "~/server/services/page-text-extract";
import {
  DEFAULT_SEARCH_BOOST_DOMAINS,
  DEFAULT_SEARCH_PENALTY_DOMAINS,
  domainMatchesAny,
} from "~/server/services/search-domain-policy";
import {
  recordSearchAuditLog,
  type SearchAuditFeature,
  type SearchAuditStatus,
} from "~/server/services/search-audit";

const log = createLogger("material-web-search");

export type WebSearchProvider = "searxng" | "known_source";

export type WebSearchResult = {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  query: string;
  rankScore: number;
  rankReasons?: string[];
  provider?: WebSearchProvider;
};

export type WebSearchResponse = {
  results: WebSearchResult[];
  warnings: string[];
  domainPolicy?: SearchDomainPolicy;
};

type ProviderSearchResponse = WebSearchResponse & {
  status: SearchAuditStatus;
};

type SearchOptions = {
  feature?: SearchAuditFeature;
};

const DEFAULT_DOMAIN_POLICY: SearchDomainPolicy = {
  boostDomains: DEFAULT_SEARCH_BOOST_DOMAINS,
  penaltyDomains: DEFAULT_SEARCH_PENALTY_DOMAINS,
  blockDomains: [],
};

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

type CachedSearchResponse = {
  expiresAt: number;
  response: WebSearchResponse;
};

const searchCache = new Map<string, CachedSearchResponse>();
const inFlightSearches = new Map<string, Promise<WebSearchResponse>>();
let webLimiterConcurrency = 0;
let webLimiter = createAsyncLimiter(12);

function normalizeCacheKey(query: string) {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

async function runWithWebLimit<T>(task: () => Promise<T>): Promise<T> {
  const concurrency = await resolveEnrichmentWebConcurrency();
  if (concurrency !== webLimiterConcurrency) {
    webLimiterConcurrency = concurrency;
    webLimiter = createAsyncLimiter(concurrency);
  }
  return webLimiter(task);
}

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
  return decodeHtmlEntities(
    value
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function extractDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function buildSearchHeaders(options?: {
  accept?: string;
  referer?: string;
  authHeaders?: Record<string, string>;
}): Record<string, string> {
  return {
    "User-Agent": BROWSER_USER_AGENT,
    Accept:
      options?.accept ??
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
    ...(options?.referer ? { Referer: options.referer } : {}),
    ...options?.authHeaders,
  };
}

function searchTimeoutSignal(timeoutMs: number, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) {
    return timeout;
  }
  return AbortSignal.any([signal, timeout]);
}

function searxngAuthHeaders(
  config: SearxngSearchConfig,
): Record<string, string> | undefined {
  if (!config.apiKey) {
    return undefined;
  }
  return { Authorization: `Bearer ${config.apiKey}` };
}

export function buildSearxngUrl(
  baseUrl: string,
  query: string,
  config: SearxngSearchConfig,
  format: "json" | "html",
) {
  const url = new URL("/search", `${baseUrl.replace(/\/$/, "")}/`);
  url.searchParams.set("q", query);
  if (format === "json") {
    url.searchParams.set("format", "json");
  }
  url.searchParams.set("language", config.language);
  url.searchParams.set("engines", config.engines.join(","));
  url.searchParams.set("safesearch", String(config.safeSearch));
  if (config.timeRange) {
    url.searchParams.set("time_range", config.timeRange);
  }
  return url;
}

function parseSearxngHtml(html: string, query: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const seen = new Set<string>();
  const articlePattern =
    /<article[^>]*class="[^"]*\bresult\b[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;

  let articleMatch: RegExpExecArray | null;
  while ((articleMatch = articlePattern.exec(html)) !== null) {
    const block = articleMatch[1] ?? "";
    const urlMatch =
      /href="([^"]+)"[^>]*class="[^"]*\burl_header\b[^"]*"/i.exec(block) ??
      /class="[^"]*\burl_header\b[^"]*"[^>]*href="([^"]+)"/i.exec(block);
    const titleMatch =
      /<h3[^>]*>[\s\S]*?<a[^>]*href="[^"]+"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    const snippetMatch =
      /<p[^>]*class="[^"]*\bcontent\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(block);

    const rawUrl = urlMatch?.[1]?.trim() ?? "";
    const title = stripHtmlTags(titleMatch?.[1] ?? "");
    const snippet = stripHtmlTags(snippetMatch?.[1] ?? "");
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
      rankReasons: [],
      provider: "searxng",
    });
  }

  return results;
}

function mapSearxngJsonResults(
  items: Array<{
    title?: string;
    url?: string;
    content?: string;
    score?: number;
  }>,
  query: string,
): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  for (const item of items) {
    const normalizedUrl = item.url?.trim() ?? "";
    const title = item.title?.trim() ?? "";
    if (!normalizedUrl || !title) continue;
    results.push({
      title,
      url: normalizedUrl,
      domain: extractDomain(normalizedUrl),
      snippet: item.content?.trim() ?? "",
      query,
      rankScore: typeof item.score === "number" ? item.score : 0,
      rankReasons: [],
      provider: "searxng",
    });
  }
  return results;
}

export function applyDomainPolicy(
  results: WebSearchResult[],
  policy: SearchDomainPolicy,
) {
  return results.filter(
    (result) =>
      !result.domain || !domainMatchesAny(result.domain, policy.blockDomains),
  );
}

function topAuditResults(results: WebSearchResult[]) {
  return results.slice(0, 8).map((result) => ({
    title: result.title,
    url: result.url,
    domain: result.domain,
    rankScore: result.rankScore,
    reasons: result.rankReasons ?? [],
  }));
}

async function auditSearxngSearch(input: {
  feature: SearchAuditFeature;
  query: string;
  config: SearxngSearchConfig;
  policy: SearchDomainPolicy;
  results: WebSearchResult[];
  durationMs: number;
  status: SearchAuditStatus;
  warnings: string[];
  errorText?: string;
}) {
  await recordSearchAuditLog({
    feature: input.feature,
    provider: "searxng",
    query: input.query,
    engines: input.config.engines,
    language: input.config.language,
    resultCount: input.results.length,
    selectedResultCount: input.results.length,
    durationMs: input.durationMs,
    status: input.status,
    warnings: input.warnings,
    errorText: input.errorText,
    topResults: topAuditResults(input.results),
    rankingPolicy: input.policy,
  });
}

async function searchSearxngQuery(
  query: string,
  signal?: AbortSignal,
  options?: SearchOptions,
): Promise<ProviderSearchResponse> {
  const startedAt = Date.now();
  const config = await resolveSearxngSearchConfig();
  const policy = await resolveSearchDomainPolicy();
  const feature = options?.feature ?? "interactive";
  const warnings: string[] = [];

  if (!config.baseUrl) {
    const warning = "SearXNG chưa được cấu hình base URL.";
    warnings.push(warning);
    await auditSearxngSearch({
      feature,
      query,
      config,
      policy,
      results: [],
      durationMs: Date.now() - startedAt,
      status: "skipped",
      warnings,
    });
    return { results: [], warnings, status: "skipped", domainPolicy: policy };
  }

  const base = config.baseUrl.replace(/\/$/, "");
  const referer = `${base}/`;
  const authHeaders = searxngAuthHeaders(config);
  const collected: WebSearchResult[] = [];

  try {
    const jsonUrl = buildSearxngUrl(base, query, config, "json");
    const jsonResponse = await fetch(jsonUrl.toString(), {
      headers: buildSearchHeaders({
        accept: "application/json, text/plain, */*",
        referer,
        authHeaders,
      }),
      signal: searchTimeoutSignal(config.requestTimeoutMs, signal),
    });

    if (jsonResponse.ok) {
      const data = (await jsonResponse.json()) as {
        results?: Array<{
          title?: string;
          url?: string;
          content?: string;
          score?: number;
        }>;
      };
      collected.push(...mapSearxngJsonResults(data.results ?? [], query));
    } else {
      warnings.push(`SearXNG (${base}): JSON HTTP ${jsonResponse.status}.`);
    }

    if (collected.length === 0 && config.htmlFallback) {
      const htmlUrl = buildSearxngUrl(base, query, config, "html");
      const htmlResponse = await fetch(htmlUrl.toString(), {
        headers: buildSearchHeaders({ referer, authHeaders }),
        signal: searchTimeoutSignal(config.requestTimeoutMs, signal),
      });

      if (htmlResponse.ok) {
        const html = await htmlResponse.text();
        collected.push(...parseSearxngHtml(html, query));
      } else {
        warnings.push(`SearXNG (${base}): HTML HTTP ${htmlResponse.status}.`);
      }
    }

    const filtered = applyDomainPolicy(collected, policy).slice(
      0,
      config.resultLimitPerQuery,
    );
    const status: SearchAuditStatus =
      filtered.length > 0 ? "success" : "no_results";
    if (filtered.length === 0 && warnings.length === 0) {
      warnings.push(`SearXNG (${base}): không có kết quả cho "${query}".`);
    }

    await auditSearxngSearch({
      feature,
      query,
      config,
      policy,
      results: filtered,
      durationMs: Date.now() - startedAt,
      status,
      warnings,
    });

    return {
      results: filtered,
      warnings,
      status,
      domainPolicy: policy,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Lỗi tìm kiếm không xác định.";
    warnings.push(`SearXNG (${base}): ${message}`);
    log.warn("searxng_warnings", { query, warnings });
    await auditSearxngSearch({
      feature,
      query,
      config,
      policy,
      results: [],
      durationMs: Date.now() - startedAt,
      status: "error",
      warnings,
      errorText: message,
    });
    return { results: [], warnings, status: "error", domainPolicy: policy };
  }
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

  const config = await resolveSearxngSearchConfig();
  try {
    const response = await fetch(trimmed, {
      headers: buildSearchHeaders({
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      }),
      signal: searchTimeoutSignal(config.requestTimeoutMs, signal),
      redirect: "follow",
    });

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (
      !contentType.includes("text/html") &&
      !contentType.includes("application/pdf")
    ) {
      return null;
    }

    const body = await response.text();
    const titlePattern = /<title[^>]*>([\s\S]*?)<\/title>/i;
    const titleMatch = titlePattern.exec(body);
    const title = stripHtmlTags(titleMatch?.[1] ?? "") || trimmed;
    const snippet = extractEnrichmentPageText(body);

    return {
      title,
      url: response.url || trimmed,
      domain: extractDomain(response.url || trimmed),
      snippet: snippet || stripHtmlTags(body).slice(0, 600),
      query,
      rankScore: 0.4,
      rankReasons: ["known_source"],
      provider: "known_source",
    };
  } catch {
    return null;
  }
}

async function _fetchKnownSourceCandidates(
  urls: string[],
  signal?: AbortSignal,
): Promise<WebSearchResult[]> {
  const seen = new Set<string>();
  const uniqueUrls = urls
    .map((url) => url.trim())
    .filter((url) => {
      if (!url || seen.has(url)) {
        return false;
      }
      seen.add(url);
      return true;
    });

  const candidates = await Promise.all(
    uniqueUrls.map((url) =>
      runWithWebLimit(() =>
        fetchUrlAsSearchResult(url, "known_source", signal),
      ),
    ),
  );

  return candidates.filter(
    (candidate): candidate is WebSearchResult => candidate != null,
  );
}

async function _searchQueryWithFallback(
  query: string,
  signal?: AbortSignal,
  options?: SearchOptions,
): Promise<WebSearchResponse> {
  const { results, warnings, domainPolicy } = await searchSearxngQuery(
    query,
    signal,
    options,
  );
  return { results, warnings, domainPolicy };
}

export function summarizeWebSearchFailures(warnings: string[]): string {
  if (warnings.length === 0) {
    return "Không tìm thấy kết quả tìm kiếm web.";
  }
  const unique = [...new Set(warnings.map((warning) => warning.trim()))];
  return unique.slice(0, 4).join(" | ");
}

async function _searchWebForProduct(
  queries: string[],
  signal?: AbortSignal,
  options?: SearchOptions,
): Promise<WebSearchResponse> {
  const uniqueQueries = [
    ...new Set(queries.map((query) => query.trim()).filter(Boolean)),
  ];
  const merged: WebSearchResult[] = [];
  const seenUrls = new Set<string>();
  const warnings: string[] = [];
  let domainPolicy: SearchDomainPolicy | undefined;

  const responses = await Promise.all(
    uniqueQueries.map(async (query) => {
      throwIfAborted(signal);
      return runWithWebLimit(() =>
        searchQueryWithCache(query, signal, options),
      );
    }),
  );

  for (const {
    results,
    warnings: queryWarnings,
    domainPolicy: policy,
  } of responses) {
    warnings.push(...queryWarnings);
    domainPolicy ??= policy;

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

  return { results: merged, warnings, domainPolicy };
}

async function searchQueryWithCache(
  query: string,
  signal?: AbortSignal,
  options?: SearchOptions,
): Promise<WebSearchResponse> {
  const key = `${options?.feature ?? "search"}:${normalizeCacheKey(query)}`;
  const ttlMs = await resolveEnrichmentSearchCacheTtlMs();
  const now = Date.now();
  const cached = searchCache.get(key);
  if (cached && cached.expiresAt > now) {
    return {
      results: cached.response.results.map((result) => ({ ...result })),
      warnings: [...cached.response.warnings],
      domainPolicy: cached.response.domainPolicy
        ? {
            boostDomains: [...cached.response.domainPolicy.boostDomains],
            penaltyDomains: [...cached.response.domainPolicy.penaltyDomains],
            blockDomains: [...cached.response.domainPolicy.blockDomains],
          }
        : undefined,
    };
  }

  if (!signal && inFlightSearches.has(key)) {
    return inFlightSearches.get(key)!;
  }

  const promise = searchQueryWithFallback(query, signal, options);
  if (!signal) {
    inFlightSearches.set(key, promise);
  }

  try {
    const response = await promise;
    if (ttlMs > 0 && options?.feature !== "test") {
      searchCache.set(key, {
        expiresAt: now + ttlMs,
        response: {
          results: response.results.map((result) => ({ ...result })),
          warnings: [...response.warnings],
          domainPolicy: response.domainPolicy
            ? {
                boostDomains: [...response.domainPolicy.boostDomains],
                penaltyDomains: [...response.domainPolicy.penaltyDomains],
                blockDomains: [...response.domainPolicy.blockDomains],
              }
            : undefined,
        },
      });
    }
    return response;
  } finally {
    inFlightSearches.delete(key);
  }
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

function isPenaltyDomain(domain: string, policy: SearchDomainPolicy) {
  return domainMatchesAny(domain, policy.penaltyDomains);
}

const SPEC_KEYWORDS = [
  "thông số",
  "datasheet",
  "catalog",
  "catalogue",
  "bảng giá",
  "specification",
];

function textContainsSpecKeyword(text: string) {
  const normalized = text.toLowerCase();
  return SPEC_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function codeTokensMatch(code: string, title: string, url: string) {
  const normalizedCode = code.trim().toLowerCase();
  if (!normalizedCode || normalizedCode.length < 2) return false;
  const haystack = `${title} ${url}`.toLowerCase();
  if (haystack.includes(normalizedCode)) return true;
  const parts = normalizedCode
    .split(/[^a-z0-9]+/i)
    .filter((part) => part.length >= 2);
  if (parts.length === 0) return false;
  const hits = parts.filter((part) => haystack.includes(part)).length;
  return hits / parts.length >= 0.6;
}

function _rankSearchResults(
  results: WebSearchResult[],
  input: {
    manufacturer?: string | null;
    name?: string | null;
    code?: string | null;
    sourceUrl?: string | null;
  },
  policy: SearchDomainPolicy = DEFAULT_DOMAIN_POLICY,
): WebSearchResult[] {
  const manufacturer = input.manufacturer?.trim() ?? "";
  const name = input.name?.trim().toLowerCase() ?? "";
  const code = input.code?.trim() ?? "";
  const sourceDomain = input.sourceUrl ? extractDomain(input.sourceUrl) : "";
  const filtered = applyDomainPolicy(results, policy);

  const scored = filtered.map((result) => {
    let score = result.rankScore || 0;
    const reasons: string[] = [...(result.rankReasons ?? [])];
    const domain = result.domain.toLowerCase();
    const title = result.title.toLowerCase();
    const snippet = result.snippet.toLowerCase();
    const combined = `${title} ${snippet}`;

    if (domainMatchesAny(domain, policy.boostDomains)) {
      score += 0.45;
      reasons.push("boost_domain");
    }
    if (manufacturer && hostnameMatchesManufacturer(domain, manufacturer)) {
      score += 0.35;
      reasons.push("manufacturer_domain");
    }
    const isPdf = /\.pdf(?:$|[?#])/i.test(result.url);
    if (isPdf) {
      score += 0.3;
      reasons.push("pdf");
      if (result.query?.includes("filetype:pdf")) {
        score += 0.1;
        reasons.push("filetype_pdf_query");
      }
    }
    if (domain.endsWith(".vn") && !isPenaltyDomain(domain, policy)) {
      score += 0.15;
      reasons.push("vn_domain");
    }
    if (sourceDomain && domain === sourceDomain) {
      score += 0.25;
      reasons.push("source_domain_match");
    }
    if (code && codeTokensMatch(code, title, result.url)) {
      score += 0.25;
      reasons.push("code_match");
    }
    if (textContainsSpecKeyword(combined)) {
      score += 0.1;
      reasons.push("spec_keyword");
    }
    if (name) {
      const nameTokens = name.split(/\s+/).filter((token) => token.length > 2);
      const hits = nameTokens.filter(
        (token) => title.includes(token) || snippet.includes(token),
      ).length;
      if (nameTokens.length > 0 && hits > 0) {
        score += (hits / nameTokens.length) * 0.25;
        reasons.push("name_token_match");
      }
    }
    if (isPenaltyDomain(domain, policy)) {
      score -= 0.35;
      reasons.push("penalty_domain");
    }

    return { ...result, rankScore: score, rankReasons: [...new Set(reasons)] };
  });

  return scored.sort((left, right) => right.rankScore - left.rankScore);
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

async function _enrichSearchResultsWithFetchedContent(
  results: WebSearchResult[],
  options?: { fetchCount?: number; signal?: AbortSignal },
): Promise<WebSearchResult[]> {
  const fetchCount = options?.fetchCount ?? 6;
  const toFetch = results.slice(0, fetchCount);
  const rest = results.slice(fetchCount);

  const enriched = await Promise.all(
    toFetch.map(async (result) => {
      const fetched = await fetchUrlAsSearchResult(
        result.url,
        result.query,
        options?.signal,
      );
      if (!fetched?.snippet.trim()) {
        return result;
      }
      return {
        ...result,
        title: fetched.title.trim() || result.title,
        snippet: fetched.snippet.trim() || result.snippet,
        domain: fetched.domain || result.domain,
        rankScore: Math.max(result.rankScore, fetched.rankScore),
        rankReasons: [
          ...new Set([
            ...(result.rankReasons ?? []),
            ...(fetched.rankReasons ?? []),
          ]),
        ],
      };
    }),
  );

  return [...enriched, ...rest];
}

export const enrichSearchResultsWithFetchedContent = traceFn(
  log,
  "enrichSearchResultsWithFetchedContent",
  _enrichSearchResultsWithFetchedContent,
);
export const fetchUrlAsSearchResult = traceFn(
  log,
  "fetchUrlAsSearchResult",
  _fetchUrlAsSearchResult,
);
export const fetchKnownSourceCandidates = traceFn(
  log,
  "fetchKnownSourceCandidates",
  _fetchKnownSourceCandidates,
);
export const searchQueryWithFallback = traceFn(
  log,
  "searchQueryWithFallback",
  _searchQueryWithFallback,
);
export const searchWebForProduct = traceFn(
  log,
  "searchWebForProduct",
  _searchWebForProduct,
);
export const rankSearchResults = traceFn(
  log,
  "rankSearchResults",
  _rankSearchResults,
);
export const extractPdfUrlsFromResults = traceFn(
  log,
  "extractPdfUrlsFromResults",
  _extractPdfUrlsFromResults,
);
