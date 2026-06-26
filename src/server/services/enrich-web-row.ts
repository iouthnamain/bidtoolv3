import "server-only";

import type { FillableField } from "~/lib/materials/excel-enrich-fields";
import {
  ENRICHABLE_FIELDS,
  ENRICHABLE_TO_FILLABLE_FIELD,
  type MaterialEnrichmentEvidence,
  type MaterialEnrichmentInput,
} from "~/lib/materials/material-enrichment-types";
import { resolveAiProvider } from "~/server/services/app-settings";
import { buildSearchQueries } from "~/server/services/excel-research/query-builder";
import {
  extractProductFromSources,
  type ExtractedProductFields,
} from "~/server/services/material-enrichment-extract";
import { parseEnrichmentPrice } from "~/server/services/material-enrichment-commit";
import { createLogger, traceFn } from "~/server/lib/logger";
const log = createLogger("services-enrich-web-row");
import {
  enrichSearchResultsWithFetchedContent,
  rankSearchResults,
  searchWebForProduct,
  type WebSearchResult,
} from "~/server/services/material-web-search";

export type EnrichWebRowInput = {
  name: string;
  code?: string;
  manufacturer?: string;
  specText?: string;
  unit?: string;
  category?: string;
  originCountry?: string;
};

export type EnrichWebRowResult = {
  fields: Partial<Record<FillableField, string>>;
  sourceUrls: string[];
  evidence: MaterialEnrichmentEvidence[];
  catalogPdfUrls: string[];
};

export type EnrichWebRowHit = {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  query?: string;
  rankScore?: number;
};

function _mapExtractedToFillable(
  extracted: ExtractedProductFields,
  sourceUrls: string[],
): EnrichWebRowResult {
  const fields: Partial<Record<FillableField, string>> = {};
  const evidence: MaterialEnrichmentEvidence[] = [];

  for (const enrichable of ENRICHABLE_FIELDS) {
    const cell = extracted[enrichable];
    if (!cell?.value?.trim()) {
      continue;
    }
    const fillable = ENRICHABLE_TO_FILLABLE_FIELD[enrichable];
    let value = cell.value.trim();
    if (enrichable === "price") {
      const parsed = parseEnrichmentPrice(value);
      if (parsed != null) {
        value = String(parsed);
      }
    }
    fields[fillable] = value;
    evidence.push(...cell.evidence);
  }

  if (!fields.sourceUrl && sourceUrls.length > 0) {
    fields.sourceUrl = sourceUrls[0];
  }

  const catalogPdfUrls = [...new Set(extracted.catalogPdfUrls ?? [])];

  return { fields, sourceUrls, evidence, catalogPdfUrls };
}

function _webHitsToSearchResults(hits: EnrichWebRowHit[]): WebSearchResult[] {
  return hits.map((hit) => ({
    title: hit.title,
    url: hit.url,
    domain: hit.domain,
    snippet: hit.snippet,
    query: hit.query ?? "",
    rankScore: hit.rankScore ?? 0,
  }));
}

export function enrichmentInputFromRow(
  input: EnrichWebRowInput,
): MaterialEnrichmentInput {
  const unitTrimmed = input.unit?.trim();
  return {
    materialId: 0,
    name: input.name,
    unit: unitTrimmed && unitTrimmed.length > 0 ? unitTrimmed : "cái",
    code: input.code ?? null,
    category: input.category ?? null,
    specText: input.specText ?? "",
    manufacturer: input.manufacturer ?? null,
    originCountry: input.originCountry?.trim() ? input.originCountry : null,
    defaultUnitPrice: null,
    currency: "VND",
    sourceUrl: null,
    sku: input.code ?? null,
    model: input.code ?? null,
  };
}

async function extractFieldsFromRankedResults(
  input: EnrichWebRowInput,
  ranked: WebSearchResult[],
  signal?: AbortSignal,
): Promise<EnrichWebRowResult> {
  const sourceUrls = [
    ...new Set(ranked.map((result) => result.url).filter(Boolean)),
  ];

  if (ranked.length === 0) {
    return { fields: {}, sourceUrls: [], evidence: [], catalogPdfUrls: [] };
  }

  let provider;
  try {
    provider = await resolveAiProvider("enrichment");
  } catch {
    return {
      fields: sourceUrls.length > 0 ? { sourceUrl: sourceUrls[0] } : {},
      sourceUrls,
      evidence: [],
      catalogPdfUrls: [],
    };
  }

  const fetchedCandidates = await enrichSearchResultsWithFetchedContent(
    ranked,
    { fetchCount: 6, signal },
  );

  const extracted = await extractProductFromSources(
    enrichmentInputFromRow(input),
    fetchedCandidates,
    provider,
    signal,
  );

  return mapExtractedToFillable(extracted, sourceUrls);
}

async function _enrichRowFromWeb(
  input: EnrichWebRowInput,
  signal?: AbortSignal,
): Promise<EnrichWebRowResult> {
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

  if (queries.length === 0 || !input.name.trim()) {
    return { fields: {}, sourceUrls: [], evidence: [], catalogPdfUrls: [] };
  }

  const searchResponse = await searchWebForProduct(queries, signal);
  const ranked = rankSearchResults(searchResponse.results, {
    manufacturer: input.manufacturer ?? null,
    name: input.name,
    code: input.code ?? null,
    sourceUrl: null,
  }).slice(0, 8);

  return extractFieldsFromRankedResults(input, ranked, signal);
}

async function _enrichRowFromWebResults(
  input: EnrichWebRowInput & { webResults: EnrichWebRowHit[] },
  signal?: AbortSignal,
): Promise<EnrichWebRowResult> {
  const ranked = rankSearchResults(webHitsToSearchResults(input.webResults), {
    manufacturer: input.manufacturer ?? null,
    name: input.name,
    code: input.code ?? null,
    sourceUrl: null,
  }).slice(0, 8);

  return extractFieldsFromRankedResults(input, ranked, signal);
}

export const mapExtractedToFillable = traceFn(
  log,
  "mapExtractedToFillable",
  _mapExtractedToFillable,
);
export const webHitsToSearchResults = traceFn(
  log,
  "webHitsToSearchResults",
  _webHitsToSearchResults,
);
export const enrichRowFromWeb = traceFn(
  log,
  "enrichRowFromWeb",
  _enrichRowFromWeb,
);
export const enrichRowFromWebResults = traceFn(
  log,
  "enrichRowFromWebResults",
  _enrichRowFromWebResults,
);
