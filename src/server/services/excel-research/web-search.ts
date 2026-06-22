import { resolveSearxngBaseUrl } from "~/server/services/app-settings";
import { createLogger, traceFn } from "~/server/lib/logger";
const log = createLogger("services-excel-research-web-search");

export type RawSearchHit = {
  provider: string;
  query: string;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  imageUrl?: string;
  providerScore?: number;
};

type SearxResult = {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    score?: number;
  }>;
};

function domainFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function _searchWeb(
  query: string,
  limit = 8,
): Promise<{ hits: RawSearchHit[]; warning?: string }> {
  const baseUrl = (await resolveSearxngBaseUrl())?.trim();
  if (!baseUrl) {
    return {
      hits: [],
      warning: "Chưa cấu hình SEARXNG_BASE_URL — bỏ qua tìm kiếm web.",
    };
  }

  const url = new URL("/search", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("language", "vi-VN");

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    return {
      hits: [],
      warning: `SearXNG trả về ${response.status}.`,
    };
  }

  const data = (await response.json()) as SearxResult;
  const hits = (data.results ?? []).slice(0, limit).map((item) => ({
    provider: "searxng",
    query,
    title: item.title?.trim() ?? "",
    url: item.url?.trim() ?? "",
    domain: domainFromUrl(item.url ?? ""),
    snippet: item.content?.trim() ?? "",
    providerScore: item.score,
  }));

  return { hits: hits.filter((h) => h.url.length > 0) };
}

export const searchWeb = traceFn(log, "searchWeb", _searchWeb);
