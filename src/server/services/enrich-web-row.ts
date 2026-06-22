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
};

export type EnrichWebRowResult = {
  fields: Partial<Record<FillableField, string>>;
  sourceUrls: string[];
  evidence: MaterialEnrichmentEvidence[];
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

  return { fields, sourceUrls, evidence };
}

function _webHitsToSearchResults(
  hits: Array<{
    title: string;
    url: string;
    domain: string;
    snippet: string;
    query?: string;
    rankScore?: number;
  }>,
): WebSearchResult[] {
  return hits.map((hit) => ({
    title: hit.title,
    url: hit.url,
    domain: hit.domain,
    snippet: hit.snippet,
    query: hit.query ?? "",
    rankScore: hit.rankScore ?? 0,
  }));
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
  }).map((query) => query.query);

  if (queries.length === 0 || !input.name.trim()) {
    return { fields: {}, sourceUrls: [], evidence: [] };
  }

  const searchResponse = await searchWebForProduct(queries, signal);
  const ranked = rankSearchResults(searchResponse.results, {
    manufacturer: input.manufacturer ?? null,
    name: input.name,
    sourceUrl: null,
  }).slice(0, 8);

  const sourceUrls = [...new Set(ranked.map((result) => result.url).filter(Boolean))];

  if (ranked.length === 0) {
    return { fields: {}, sourceUrls: [], evidence: [] };
  }

  let provider;
  try {
    provider = await resolveAiProvider("enrichment");
  } catch {
    return {
      fields: sourceUrls.length > 0 ? { sourceUrl: sourceUrls[0] } : {},
      sourceUrls,
      evidence: [],
    };
  }

  const unitTrimmed = input.unit?.trim();
  const enrichmentInput: MaterialEnrichmentInput = {
    materialId: 0,
    name: input.name,
    unit: unitTrimmed && unitTrimmed.length > 0 ? unitTrimmed : "cái",
    code: input.code ?? null,
    category: input.category ?? null,
    specText: input.specText ?? "",
    manufacturer: input.manufacturer ?? null,
    originCountry: null,
    defaultUnitPrice: null,
    currency: "VND",
    sourceUrl: null,
    sku: input.code ?? null,
    model: input.code ?? null,
  };

  const extracted = await extractProductFromSources(
    enrichmentInput,
    ranked,
    provider,
    signal,
  );

  return mapExtractedToFillable(extracted, sourceUrls);
}

export const mapExtractedToFillable = traceFn(log, "mapExtractedToFillable", _mapExtractedToFillable);
export const webHitsToSearchResults = traceFn(log, "webHitsToSearchResults", _webHitsToSearchResults);
export const enrichRowFromWeb = traceFn(log, "enrichRowFromWeb", _enrichRowFromWeb);
