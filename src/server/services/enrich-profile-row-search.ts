import "server-only";

import type { FillableField } from "~/lib/materials/excel-enrich-fields";
import {
  RELIABLE_SEARCH_MATCH_THRESHOLD,
  scoreAiCandidateCompletion,
} from "~/lib/materials/search-candidate-match";
import type {
  AiSearchStoredResult,
  WebLinkResult,
} from "~/lib/materials/enrich-gap-fill";
import {
  ENRICHABLE_FIELDS,
  ENRICHABLE_TO_FILLABLE_FIELD,
} from "~/lib/materials/material-enrichment-types";
import { createLogger, traceFn } from "~/server/lib/logger";
import {
  resolveAiProvider,
  resolveSearchDomainPolicy,
  resolveSearchQueryControls,
} from "~/server/services/app-settings";
import { buildSearchQueries } from "~/server/services/excel-research/query-builder";
import {
  enrichmentInputFromRow,
  mapExtractedToFillable,
  type EnrichWebRowInput,
} from "~/server/services/enrich-web-row";
import { extractProductFromSources } from "~/server/services/material-enrichment-extract";
import {
  enrichSearchResultsWithFetchedContent,
  fetchUrlAsSearchResult,
  rankSearchResults,
  searchWebForProduct,
  type WebSearchResult,
} from "~/server/services/material-web-search";

const log = createLogger("services-enrich-profile-row-search");

const PROFILE_TOP_LINKS = 8;
const PROFILE_FETCH_LINKS = 6;
const FETCH_CONCURRENCY = 3;
const EXTRACT_CONCURRENCY = 3;
const PROFILE_AI_WARNING_LIMIT = 6;

export type EnrichProfileRowSearchResult = {
  webLinkResults: WebLinkResult[];
  aiSearchCandidates: AiSearchStoredResult[];
  recommendedCandidateKey?: string;
  warnings: string[];
};

export type ProfileWebLinksSearchResult = {
  webLinkResults: WebLinkResult[];
  queries: string[];
  warnings: string[];
};

export type ProfileAiCandidatesSearchResult = {
  aiSearchCandidates: AiSearchStoredResult[];
  recommendedCandidateKey?: string;
  warnings: string[];
};

function fieldConfidencesFromExtracted(
  extracted: Awaited<ReturnType<typeof extractProductFromSources>>,
): Partial<Record<FillableField, number>> {
  const result: Partial<Record<FillableField, number>> = {};
  for (const enrichable of ENRICHABLE_FIELDS) {
    const cell = extracted[enrichable];
    if (cell?.confidence == null || !Number.isFinite(cell.confidence)) {
      continue;
    }
    result[ENRICHABLE_TO_FILLABLE_FIELD[enrichable]] = cell.confidence;
  }
  return result;
}

function verifiedCatalogUrlsFromSources(
  urls: string[],
  sources: WebSearchResult[],
) {
  const normalize = (value: string) => {
    try {
      const parsed = new URL(value);
      parsed.hash = "";
      return parsed.toString().replace(/\/$/, "");
    } catch {
      return "";
    }
  };
  return urls.filter((url) => {
    const normalized = normalize(url);
    if (!normalized) return false;
    return sources.some((source) => {
      const discovered = source.discoveredPdfUrls ?? [];
      return (
        normalize(source.url) === normalized ||
        source.snippet.includes(url) ||
        discovered.some((candidate) => normalize(candidate) === normalized)
      );
    });
  });
}

async function runPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await worker(items[index]!, index);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

async function enrichLinkWithFetch(
  link: WebSearchResult,
  signal?: AbortSignal,
): Promise<WebSearchResult> {
  const fetched = await fetchUrlAsSearchResult(
    link.url,
    link.query ?? "profile_search",
    signal,
  );
  if (!fetched) return link;
  return {
    ...link,
    url: fetched.url || link.url,
    title: fetched.title.trim() || link.title,
    snippet: fetched.snippet.trim() || link.snippet,
    domain: fetched.domain || link.domain,
    discoveredPdfUrls: fetched.discoveredPdfUrls ?? link.discoveredPdfUrls,
  };
}

function webLinkToSearchResult(link: WebLinkResult): WebSearchResult {
  return {
    title: link.title,
    url: link.url,
    domain: link.domain,
    snippet: link.snippet,
    query: link.query ?? "profile_search",
    rankScore: link.rankScore ?? 0,
  };
}

function sourceLabel(link: WebSearchResult) {
  const domain = link.domain.trim();
  if (domain) return domain;
  try {
    return new URL(link.url).hostname;
  } catch {
    return link.url;
  }
}

function extractionErrorMessage(error: unknown) {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "lỗi không xác định";
  return message.length > 160 ? `${message.slice(0, 160)}...` : message;
}

function pushAiExtractionWarning(warnings: string[], warning: string) {
  if (warnings.length >= PROFILE_AI_WARNING_LIMIT) return;
  warnings.push(warning);
}

async function _searchProfileRowWebLinks(
  input: EnrichWebRowInput,
  signal?: AbortSignal,
): Promise<ProfileWebLinksSearchResult> {
  const warnings: string[] = [];

  if (!input.name.trim()) {
    return {
      webLinkResults: [],
      queries: [],
      warnings: ["Tên vật tư trống."],
    };
  }

  const [domainPolicy, queryControls] = await Promise.all([
    resolveSearchDomainPolicy(),
    resolveSearchQueryControls(),
  ]);
  const queries = buildSearchQueries(
    {
      name: input.name,
      manufacturer: input.manufacturer,
      code: input.code,
      specText: input.specText,
      unit: input.unit,
      category: input.category,
      originCountry: input.originCountry,
      maxQueries: 6,
    },
    {
      context: "profile_search",
      domainPolicy,
      queryControls,
    },
  ).map((query) => query.query);

  if (queries.length === 0) {
    return {
      webLinkResults: [],
      queries: [],
      warnings: ["Không tạo được truy vấn tìm kiếm."],
    };
  }

  const searchResponse = await searchWebForProduct(queries, signal, {
    feature: "profile_search",
  });
  warnings.push(...searchResponse.warnings);

  const rankingInput = {
    manufacturer: input.manufacturer ?? null,
    name: input.name,
    code: input.code ?? null,
    specText: input.specText ?? null,
    unit: input.unit ?? null,
    category: input.category ?? null,
    originCountry: input.originCountry ?? null,
    sourceUrl: null,
    profileSearch: true,
  };
  const initialRanked = rankSearchResults(
    searchResponse.results,
    rankingInput,
    searchResponse.domainPolicy ?? domainPolicy,
  );
  const fetchedRanked = await enrichSearchResultsWithFetchedContent(
    initialRanked,
    { fetchCount: PROFILE_FETCH_LINKS, signal },
  );
  const ranked = rankSearchResults(
    fetchedRanked,
    rankingInput,
    searchResponse.domainPolicy ?? domainPolicy,
  ).slice(0, PROFILE_TOP_LINKS);

  const webLinkResults: WebLinkResult[] = ranked.map((hit) => ({
    title: hit.title,
    url: hit.url,
    domain: hit.domain,
    snippet: hit.snippet,
    query: hit.query,
    rankScore: hit.rankScore,
  }));

  if (ranked.length === 0) {
    return { webLinkResults, queries, warnings };
  }

  return { webLinkResults, queries, warnings };
}

async function _extractProfileRowAiCandidates(
  input: EnrichWebRowInput,
  webLinkResults: WebLinkResult[],
  signal?: AbortSignal,
): Promise<ProfileAiCandidatesSearchResult> {
  if (webLinkResults.length === 0) {
    return {
      aiSearchCandidates: [],
      warnings: ["Không có nguồn web để trích xuất AI."],
    };
  }

  const provider = await resolveAiProvider("enrichment");
  const extractionWarnings: string[] = [];
  const ranked = webLinkResults.map(webLinkToSearchResult);
  const linksToFetch = ranked.slice(0, PROFILE_FETCH_LINKS);
  const enrichedLinks = await runPool(linksToFetch, FETCH_CONCURRENCY, (link) =>
    enrichLinkWithFetch(link, signal),
  );

  const enrichmentInput = enrichmentInputFromRow(input);
  const extractedCandidates = await runPool(
    enrichedLinks,
    EXTRACT_CONCURRENCY,
    async (link) => {
      try {
        const extracted = await extractProductFromSources(
          enrichmentInput,
          [link],
          provider,
          signal,
        );
        const mapped = mapExtractedToFillable(extracted, [link.url]);
        const fieldConfidences = fieldConfidencesFromExtracted(extracted);
        const catalogEvidenceUrls = verifiedCatalogUrlsFromSources(
          mapped.catalogPdfUrls,
          [link],
        );
        const hasFields = Object.keys(mapped.fields).some(
          (field) => field !== "sourceUrl",
        );
        const hasPdfs = mapped.catalogPdfUrls.length > 0;
        if (!hasFields && !hasPdfs) {
          pushAiExtractionWarning(
            extractionWarnings,
            `AI không tìm thấy trường/PDF dùng được từ ${sourceLabel(link)}.`,
          );
          return null;
        }
        const candidate: AiSearchStoredResult = {
          fields: mapped.fields,
          sourceUrls: mapped.sourceUrls,
          evidence: mapped.evidence,
          catalogPdfUrls:
            mapped.catalogPdfUrls.length > 0
              ? mapped.catalogPdfUrls
              : undefined,
          catalogEvidenceUrls:
            catalogEvidenceUrls.length > 0 ? catalogEvidenceUrls : undefined,
          fieldConfidences,
          title: link.title,
          url: link.url,
          snippet: link.snippet,
          rankScore: link.rankScore,
        };
        return candidate;
      } catch (error) {
        pushAiExtractionWarning(
          extractionWarnings,
          `AI không trích xuất được nguồn ${sourceLabel(link)}: ${extractionErrorMessage(error)}.`,
        );
        return null;
      }
    },
  );

  const aiSearchCandidates = extractedCandidates.filter(
    (item): item is AiSearchStoredResult => item != null,
  );

  const sheetFields: Partial<Record<FillableField, string>> = {
    code: input.code,
    manufacturer: input.manufacturer,
    unit: input.unit,
    category: input.category,
    specText: input.specText,
    originCountry: input.originCountry,
  };

  aiSearchCandidates.sort(
    (left, right) =>
      scoreAiCandidateCompletion(right, sheetFields, input.name) -
      scoreAiCandidateCompletion(left, sheetFields, input.name),
  );

  const bestScore =
    aiSearchCandidates.length > 0
      ? scoreAiCandidateCompletion(
          aiSearchCandidates[0]!,
          sheetFields,
          input.name,
        )
      : 0;
  const recommendedCandidateKey =
    bestScore >= RELIABLE_SEARCH_MATCH_THRESHOLD ? "ai:0" : undefined;
  const warnings =
    aiSearchCandidates.length > 0 && !recommendedCandidateKey
      ? ["Có kết quả nhưng chưa đạt ngưỡng tin cậy 75%."]
      : [];

  return {
    aiSearchCandidates,
    recommendedCandidateKey,
    warnings: [...warnings, ...extractionWarnings],
  };
}

async function _enrichProfileRowSearch(
  input: EnrichWebRowInput,
  signal?: AbortSignal,
): Promise<EnrichProfileRowSearchResult> {
  const web = await searchProfileRowWebLinks(input, signal);
  if (web.webLinkResults.length === 0) {
    return {
      webLinkResults: web.webLinkResults,
      aiSearchCandidates: [],
      warnings: web.warnings,
    };
  }

  try {
    const ai = await extractProfileRowAiCandidates(
      input,
      web.webLinkResults,
      signal,
    );
    return {
      webLinkResults: web.webLinkResults,
      aiSearchCandidates: ai.aiSearchCandidates,
      recommendedCandidateKey: ai.recommendedCandidateKey,
      warnings: [...web.warnings, ...ai.warnings],
    };
  } catch (error) {
    return {
      webLinkResults: web.webLinkResults,
      aiSearchCandidates: [],
      warnings: [
        ...web.warnings,
        error instanceof Error
          ? error.message
          : "Không cấu hình AI enrichment.",
      ],
    };
  }
}

export const searchProfileRowWebLinks = traceFn(
  log,
  "searchProfileRowWebLinks",
  _searchProfileRowWebLinks,
);
export const extractProfileRowAiCandidates = traceFn(
  log,
  "extractProfileRowAiCandidates",
  _extractProfileRowAiCandidates,
);

export const enrichProfileRowSearch = traceFn(
  log,
  "enrichProfileRowSearch",
  _enrichProfileRowSearch,
);
