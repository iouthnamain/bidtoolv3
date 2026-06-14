import "server-only";

export type WebSearchResult = {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  query: string;
  rankScore: number;
};

const DUCKDUCKGO_HTML_URL = "https://html.duckduckgo.com/html/";
const MARKETPLACE_DOMAINS = ["shopee.vn", "lazada.vn", "tiki.vn", "sendo.vn"];

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

async function searchDuckDuckGoQuery(
  query: string,
  signal?: AbortSignal,
): Promise<WebSearchResult[]> {
  const response = await fetch(DUCKDUCKGO_HTML_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent":
        "Mozilla/5.0 (compatible; BidToolMaterialEnrichment/1.0; +https://localhost)",
    },
    body: new URLSearchParams({ q: query }).toString(),
    signal,
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo search failed (${response.status}) for: ${query}`);
  }

  const html = await response.text();
  return parseDuckDuckGoHtml(html, query);
}

export async function searchWebForProduct(
  queries: string[],
  signal?: AbortSignal,
): Promise<WebSearchResult[]> {
  const uniqueQueries = [
    ...new Set(queries.map((query) => query.trim()).filter(Boolean)),
  ];
  const merged: WebSearchResult[] = [];
  const seenUrls = new Set<string>();

  for (const query of uniqueQueries) {
    throwIfAborted(signal);
    const batch = await searchDuckDuckGoQuery(query, signal);
    for (const result of batch) {
      if (seenUrls.has(result.url)) {
        continue;
      }
      seenUrls.add(result.url);
      merged.push(result);
    }
  }

  return merged;
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

export function rankSearchResults(
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

export function extractPdfUrlsFromResults(results: WebSearchResult[]) {
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
