import { createLogger, traceFn } from "~/server/lib/logger";
import {
  searchQueryWithFallback,
  type WebSearchResult,
} from "~/server/services/material-web-search";
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

async function _searchWeb(
  query: string,
  limit = 8,
): Promise<{ hits: RawSearchHit[]; warning?: string }> {
  const { results, warnings } = await searchQueryWithFallback(query);
  const hits = results.slice(0, limit).map((item: WebSearchResult) => ({
    provider: "searxng",
    query,
    title: item.title,
    url: item.url,
    domain: item.domain,
    snippet: item.snippet,
    providerScore: item.rankScore,
  }));

  return { hits, warning: warnings[0] };
}

export const searchWeb = traceFn(log, "searchWeb", _searchWeb);
