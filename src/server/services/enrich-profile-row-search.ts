import "server-only";

import type { FillableField } from "~/lib/materials/excel-enrich-fields";
import { scoreAiCandidateCompletion } from "~/lib/materials/search-candidate-match";
import type {
  AiSearchStoredResult,
  WebLinkResult,
} from "~/lib/materials/enrich-gap-fill";
import {
  ENRICHABLE_FIELDS,
  ENRICHABLE_TO_FILLABLE_FIELD,
} from "~/lib/materials/material-enrichment-types";
import { createLogger, traceFn } from "~/server/lib/logger";
import { resolveAiProvider } from "~/server/services/app-settings";
import { buildSearchQueries } from "~/server/services/excel-research/query-builder";
import {
  enrichmentInputFromRow,
  mapExtractedToFillable,
  type EnrichWebRowInput,
} from "~/server/services/enrich-web-row";
import { extractProductFromSources } from "~/server/services/material-enrichment-extract";
import {
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

export type EnrichProfileRowSearchResult = {
  webLinkResults: WebLinkResult[];
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
    title: fetched.title.trim() || link.title,
    snippet: fetched.snippet.trim() || link.snippet,
    domain: fetched.domain || link.domain,
  };
}

async function _enrichProfileRowSearch(
  input: EnrichWebRowInput,
  signal?: AbortSignal,
): Promise<EnrichProfileRowSearchResult> {
  const warnings: string[] = [];

  if (!input.name.trim()) {
    return {
      webLinkResults: [],
      aiSearchCandidates: [],
      warnings: ["Tên vật tư trống."],
    };
  }

  const queries = buildSearchQueries({
    name: input.name,
    manufacturer: input.manufacturer,
    code: input.code,
    specText: input.specText,
    unit: input.unit,
    category: input.category,
    originCountry: input.originCountry,
    maxQueries: 6,
  }).map((query) => query.query);

  if (queries.length === 0) {
    return {
      webLinkResults: [],
      aiSearchCandidates: [],
      warnings: ["Không tạo được truy vấn tìm kiếm."],
    };
  }

  const searchResponse = await searchWebForProduct(queries, signal);
  warnings.push(...searchResponse.warnings);

  const ranked = rankSearchResults(searchResponse.results, {
    manufacturer: input.manufacturer ?? null,
    name: input.name,
    code: input.code ?? null,
    sourceUrl: null,
  }).slice(0, PROFILE_TOP_LINKS);

  const webLinkResults: WebLinkResult[] = ranked.map((hit) => ({
    title: hit.title,
    url: hit.url,
    domain: hit.domain,
    snippet: hit.snippet,
    query: hit.query,
    rankScore: hit.rankScore,
  }));

  if (ranked.length === 0) {
    return { webLinkResults, aiSearchCandidates: [], warnings };
  }

  let provider;
  try {
    provider = await resolveAiProvider("enrichment");
  } catch (error) {
    warnings.push(
      error instanceof Error ? error.message : "Không cấu hình AI enrichment.",
    );
    return { webLinkResults, aiSearchCandidates: [], warnings };
  }

  const linksToFetch = ranked.slice(0, PROFILE_FETCH_LINKS);
  const enrichedLinks = await runPool(
    linksToFetch,
    FETCH_CONCURRENCY,
    (link) => enrichLinkWithFetch(link, signal),
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
        const hasFields = Object.keys(mapped.fields).length > 0;
        const hasPdfs = mapped.catalogPdfUrls.length > 0;
        if (!hasFields && !hasPdfs) {
          return null;
        }
        const candidate: AiSearchStoredResult = {
          fields: mapped.fields,
          sourceUrls: mapped.sourceUrls,
          evidence: mapped.evidence,
          catalogPdfUrls:
            mapped.catalogPdfUrls.length > 0 ? mapped.catalogPdfUrls : undefined,
          fieldConfidences,
          title: link.title,
          url: link.url,
          snippet: link.snippet,
          rankScore: link.rankScore,
        };
        return candidate;
      } catch {
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
      scoreAiCandidateCompletion(right, sheetFields) -
      scoreAiCandidateCompletion(left, sheetFields),
  );

  const recommendedCandidateKey =
    aiSearchCandidates.length > 0 ? "ai:0" : undefined;

  return {
    webLinkResults,
    aiSearchCandidates,
    recommendedCandidateKey,
    warnings,
  };
}

export const enrichProfileRowSearch = traceFn(
  log,
  "enrichProfileRowSearch",
  _enrichProfileRowSearch,
);
