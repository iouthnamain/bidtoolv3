import "server-only";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import {
  classifyEnrichmentConfidence,
  ENRICHABLE_FIELDS,
  type EnrichableField,
  type MaterialEnrichmentFilterOptions,
  type MaterialEnrichmentInput,
  type MaterialEnrichmentJobOptions,
  type MaterialEnrichmentResult,
} from "~/lib/materials/material-enrichment-types";
import { findClosestOption } from "~/lib/materials/option-matcher";
import { normalizeMaterialMetadata } from "~/lib/material-price-sources";
import { db } from "~/server/db";
import {
  materialEnrichmentItems,
  materialEnrichmentJobs,
  materialWebCandidates,
  materials,
} from "~/server/db/schema";
import {
  resolveAiProvider,
  resolveEnrichmentItemConcurrency,
  type ResolvedAiProvider,
} from "~/server/services/app-settings";
import { listCatalogDocumentsForMaterial } from "~/server/services/catalog-documents";
import { runWithConcurrency } from "~/server/services/concurrency";
import { buildSearchQueries } from "~/server/services/excel-research/query-builder";
import { publishMaterialEnrichmentItemEvent } from "~/server/services/material-enrichment-events";
import { commitEnrichmentItem } from "~/server/services/material-enrichment-commit";
import { extractProductFromSources } from "~/server/services/material-enrichment-extract";
import { createLogger, traceFn } from "~/server/lib/logger";
const log = createLogger("services-material-enrichment-runner");
import {
  enrichSearchResultsWithFetchedContent,
  extractPdfUrlsFromResults,
  fetchKnownSourceCandidates,
  rankSearchResults,
  searchWebForProduct,
  summarizeWebSearchFailures,
  type WebSearchResult,
} from "~/server/services/material-web-search";

type JobRow = typeof materialEnrichmentJobs.$inferSelect;
type ItemRow = typeof materialEnrichmentItems.$inferSelect;

export type MaterialEnrichmentJobProgress = {
  processed: number;
  total: number;
  matched: number;
  needsReview: number;
  pdfsFound: number;
  pdfsGenerated: number;
  failed: number;
  currentMaterialId: number | null;
  currentMaterialName: string | null;
  message?: string | null;
};

const DEFAULT_MAX_SEARCH_RESULTS = 12;
const DEFAULT_MAX_QUERIES = 4;

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new Error("Đã hủy job enrichment.");
  }
}

function parseJobOptions(value: unknown): MaterialEnrichmentJobOptions {
  if (!value || typeof value !== "object") {
    return {};
  }
  const record = value as Record<string, unknown>;
  const fields = Array.isArray(record.fields)
    ? record.fields.filter((field): field is EnrichableField =>
        ENRICHABLE_FIELDS.includes(field as EnrichableField),
      )
    : undefined;

  return {
    autoCommitHighConfidence: record.autoCommitHighConfidence === true,
    skipWellFilled: record.skipWellFilled === true,
    generatePdfIfMissing: record.generatePdfIfMissing === true,
    model: typeof record.model === "string" ? record.model : undefined,
    maxSearchResults:
      typeof record.maxSearchResults === "number"
        ? record.maxSearchResults
        : undefined,
    maxQueries:
      typeof record.maxQueries === "number" ? record.maxQueries : undefined,
    fields,
  };
}

function parseFilterOptions(value: unknown): MaterialEnrichmentFilterOptions {
  const empty = {
    categories: [] as string[],
    manufacturers: [] as string[],
    origins: [] as string[],
    units: [] as string[],
  };
  if (!value || typeof value !== "object") {
    return empty;
  }
  const record = value as Record<string, unknown>;
  return {
    categories: Array.isArray(record.categories)
      ? record.categories.map(String).filter(Boolean)
      : [],
    manufacturers: Array.isArray(record.manufacturers)
      ? record.manufacturers.map(String).filter(Boolean)
      : [],
    origins: Array.isArray(record.origins)
      ? record.origins.map(String).filter(Boolean)
      : [],
    units: Array.isArray(record.units)
      ? record.units.map(String).filter(Boolean)
      : [],
  };
}

function materialToInput(
  material: typeof materials.$inferSelect,
): MaterialEnrichmentInput {
  const metadata = normalizeMaterialMetadata(material.metadataJson);
  return {
    materialId: material.id,
    code: material.code,
    name: material.name,
    unit: material.unit,
    category: material.category,
    specText: material.specText,
    manufacturer: material.manufacturer,
    originCountry: material.originCountry,
    defaultUnitPrice: material.defaultUnitPrice,
    currency: material.currency,
    sourceUrl: material.sourceUrl,
    sku: metadata.shopScrape?.sku ?? null,
    model: metadata.shopScrape?.model ?? null,
  };
}

function knownSourceUrls(
  input: MaterialEnrichmentInput,
  material: typeof materials.$inferSelect,
) {
  const metadata = normalizeMaterialMetadata(material.metadataJson);
  const urls = [
    input.sourceUrl,
    ...metadata.priceSources.map((source) => source.url),
  ];
  return [
    ...new Set(urls.map((url) => url?.trim()).filter(Boolean) as string[]),
  ];
}

function buildSkippedError(searchWarnings: string[]) {
  const hint =
    "Không tìm thấy nguồn web. Kiểm tra SEARXNG_BASE_URL (và SEARXNG_API_KEY nếu có) trên Vercel, hoặc thêm sourceUrl cho vật tư.";
  if (searchWarnings.length === 0) {
    return hint;
  }
  return `${hint} Chi tiết: ${summarizeWebSearchFailures(searchWarnings)}`;
}

function resolveItemStatus(
  band: ReturnType<typeof classifyEnrichmentConfidence>,
): MaterialEnrichmentResult["status"] {
  if (band === "auto") {
    return "auto";
  }
  return "review";
}

function overallConfidence(
  result: MaterialEnrichmentResult,
  fields: EnrichableField[],
) {
  const scores = fields
    .map((field) => result.fields[field]?.confidence ?? 0)
    .filter((score) => score > 0);
  if (scores.length === 0) {
    return 0;
  }
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

function applyOptionMatching(
  result: MaterialEnrichmentResult,
  filterOptions: MaterialEnrichmentFilterOptions,
) {
  const optionMap: Partial<
    Record<EnrichableField, { options: string[]; useMatch: boolean }>
  > = {
    category: { options: filterOptions.categories, useMatch: true },
    manufacturer: { options: filterOptions.manufacturers, useMatch: true },
    originCountry: { options: filterOptions.origins, useMatch: true },
    unit: { options: filterOptions.units, useMatch: true },
  };

  for (const field of ENRICHABLE_FIELDS) {
    const fieldResult = result.fields[field];
    if (!fieldResult?.value) {
      continue;
    }
    const config = optionMap[field];
    if (!config?.useMatch || config.options.length === 0) {
      continue;
    }
    const match = findClosestOption(fieldResult.value, config.options);
    if (match) {
      fieldResult.matchedOption = match.option;
      fieldResult.confidence = Math.max(
        fieldResult.confidence,
        match.score * fieldResult.confidence,
      );
    }
  }
}

async function saveWebCandidates(
  item: ItemRow,
  results: WebSearchResult[],
  extractedPdfUrls: string[],
) {
  if (results.length === 0) {
    return [];
  }

  const now = new Date().toISOString();
  const rows = await db
    .insert(materialWebCandidates)
    .values(
      results.map((result, index) => ({
        enrichmentItemId: item.id,
        materialId: item.materialId,
        provider: "duckduckgo",
        query: result.query,
        title: result.title,
        url: result.url,
        domain: result.domain,
        snippet: result.snippet,
        rawEvidence: result.snippet,
        catalogPdfUrls: extractPdfUrlsFromResults([result]),
        confidenceScore: Math.max(
          0,
          Math.min(100, Math.round((result.rankScore + 1) * 40)),
        ),
        matchReasons:
          result.rankScore > 0 ? [`rank:${result.rankScore.toFixed(2)}`] : [],
        isSelected: index === 0,
        fetchedAt: now,
      })),
    )
    .returning();

  if (extractedPdfUrls.length > 0 && rows[0]) {
    await db
      .update(materialWebCandidates)
      .set({
        catalogPdfUrls: [
          ...new Set([...(rows[0].catalogPdfUrls ?? []), ...extractedPdfUrls]),
        ],
      })
      .where(eq(materialWebCandidates.id, rows[0].id));
  }

  return rows;
}

function buildResultFromExtraction(
  extracted: Awaited<ReturnType<typeof extractProductFromSources>>,
  pdfUrls: string[],
  targetFields: EnrichableField[],
): MaterialEnrichmentResult {
  const fields: MaterialEnrichmentResult["fields"] = {};
  for (const field of targetFields) {
    const value = extracted[field];
    if (!value) {
      continue;
    }
    fields[field] = {
      value: value.value,
      confidence: value.confidence,
      evidence: value.evidence,
    };
  }

  const result: MaterialEnrichmentResult = {
    fields,
    catalogPdfUrls: [
      ...new Set([...(extracted.catalogPdfUrls ?? []), ...pdfUrls]),
    ],
    overallConfidence: 0,
    status: "review",
  };
  result.overallConfidence = overallConfidence(result, targetFields);
  const band = classifyEnrichmentConfidence(result.overallConfidence);
  result.status = resolveItemStatus(band);
  return result;
}

/**
 * Decide whether a material is already "well filled" for the target fields, so a
 * `skipWellFilled` job can avoid spending web/LLM budget on it. Considers the
 * core enrichable text fields (category, specText, manufacturer, originCountry)
 * present; price/unit/sourceUrl are excluded because most catalog rows already
 * have a unit and many never carry a sourceUrl.
 */
function isMaterialWellFilled(
  material: typeof materials.$inferSelect,
  targetFields: EnrichableField[],
): boolean {
  const considered: EnrichableField[] = [
    "category",
    "specText",
    "manufacturer",
    "originCountry",
  ].filter((field): field is EnrichableField =>
    targetFields.includes(field as EnrichableField),
  );
  if (considered.length === 0) {
    return false;
  }
  const valueFor = (field: EnrichableField): string | null => {
    switch (field) {
      case "code":
        return material.code;
      case "category":
        return material.category;
      case "specText":
        return material.specText;
      case "manufacturer":
        return material.manufacturer;
      case "originCountry":
        return material.originCountry;
      default:
        return null;
    }
  };
  return considered.every((field) => (valueFor(field) ?? "").trim().length > 0);
}

async function _processEnrichmentItem(
  job: JobRow,
  item: ItemRow,
  loadProvider?: () => Promise<ResolvedAiProvider>,
  signal?: AbortSignal,
) {
  throwIfAborted(signal);
  const options = parseJobOptions(job.optionsJson);
  const filterOptions = parseFilterOptions(job.filterSnapshotJson);
  const targetFields = options.fields?.length
    ? options.fields
    : [...ENRICHABLE_FIELDS];
  const now = new Date().toISOString();

  await db
    .update(materialEnrichmentItems)
    .set({ status: "processing", updatedAt: now })
    .where(eq(materialEnrichmentItems.id, item.id));
  await publishMaterialEnrichmentItemEvent(item.id, "item.processing");

  const [material] = await db
    .select()
    .from(materials)
    .where(and(eq(materials.id, item.materialId), isNull(materials.deletedAt)))
    .limit(1);

  if (!material) {
    const failedResult: MaterialEnrichmentResult = {
      fields: {},
      catalogPdfUrls: [],
      overallConfidence: 0,
      status: "failed",
      error: "Không tìm thấy vật tư.",
    };
    await db
      .update(materialEnrichmentItems)
      .set({
        status: "failed",
        resultJson: failedResult,
        updatedAt: now,
      })
      .where(eq(materialEnrichmentItems.id, item.id));
    await publishMaterialEnrichmentItemEvent(item.id, "item.failed");
    return failedResult;
  }

  const input = materialToInput(material);
  await db
    .update(materialEnrichmentItems)
    .set({
      originalSnapshotJson: input,
      updatedAt: now,
    })
    .where(eq(materialEnrichmentItems.id, item.id));
  await publishMaterialEnrichmentItemEvent(item.id, "item.snapshot");

  // `skipWellFilled`: when the material already has its core enrichable fields,
  // mark the item "skipped" (matches the existing enum + the UI "Bỏ qua" label)
  // and don't spend web/LLM budget on it. But the UI checkbox also promises it
  // considers catalog PDF presence ("...NCC, thông số VÀ catalog PDF"): when
  // `generatePdfIfMissing` is on, a well-filled material with NO linked catalog
  // doc must still be processed so PDF generation can fire. So only skip when the
  // material is well-filled AND (PDF generation is off OR it already has a doc).
  // The catalog-doc lookup is gated behind the well-filled check so we never run
  // an extra query for items we'd process anyway.
  let skipBecauseWellFilled =
    options.skipWellFilled && isMaterialWellFilled(material, targetFields);
  if (skipBecauseWellFilled && options.generatePdfIfMissing) {
    const existingDocs = await listCatalogDocumentsForMaterial(db, material.id);
    if (existingDocs.length === 0) {
      skipBecauseWellFilled = false;
    }
  }
  if (skipBecauseWellFilled) {
    const skippedResult: MaterialEnrichmentResult = {
      fields: {},
      catalogPdfUrls: [],
      overallConfidence: 0,
      status: "skipped",
      error: "Đã đủ thông tin — bỏ qua theo tùy chọn.",
    };
    await db
      .update(materialEnrichmentItems)
      .set({
        status: skippedResult.status,
        resultJson: skippedResult,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(materialEnrichmentItems.id, item.id));
    await publishMaterialEnrichmentItemEvent(item.id, "item.skipped");
    return skippedResult;
  }

  try {
    const queries = buildSearchQueries({
      name: input.name,
      manufacturer: input.manufacturer,
      code: input.code,
      specText: input.specText,
      sku: input.sku,
      model: input.model,
      maxQueries: options.maxQueries ?? DEFAULT_MAX_QUERIES,
    }).map((query) => query.query);
    const searchResponse = await searchWebForProduct(queries, signal);
    let ranked = rankSearchResults(searchResponse.results, {
      manufacturer: input.manufacturer,
      name: input.name,
      sourceUrl: input.sourceUrl,
    }).slice(0, options.maxSearchResults ?? DEFAULT_MAX_SEARCH_RESULTS);

    if (ranked.length === 0) {
      const knownSources = await fetchKnownSourceCandidates(
        knownSourceUrls(input, material),
        signal,
      );
      if (knownSources.length > 0) {
        ranked = rankSearchResults(knownSources, {
          manufacturer: input.manufacturer,
          name: input.name,
          sourceUrl: input.sourceUrl,
        });
      }
    }

    if (ranked.length === 0) {
      const skippedResult: MaterialEnrichmentResult = {
        fields: {},
        catalogPdfUrls: [],
        overallConfidence: 0,
        status: "skipped",
        error: buildSkippedError(searchResponse.warnings),
      };
      await db
        .update(materialEnrichmentItems)
        .set({
          status: skippedResult.status,
          resultJson: skippedResult,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(materialEnrichmentItems.id, item.id));
      await publishMaterialEnrichmentItemEvent(item.id, "item.skipped");
      return skippedResult;
    }

    const pdfUrls = extractPdfUrlsFromResults(ranked);
    const candidates = await saveWebCandidates(item, ranked, pdfUrls);

    const fetchedRanked = await enrichSearchResultsWithFetchedContent(ranked, {
      fetchCount: options.maxSearchResults ?? DEFAULT_MAX_SEARCH_RESULTS,
      signal,
    });

    const provider =
      loadProvider?.() ?? resolveAiProvider("enrichment", options.model);
    const extracted = await extractProductFromSources(
      input,
      fetchedRanked,
      await provider,
      signal,
    );

    const result = buildResultFromExtraction(extracted, pdfUrls, targetFields);
    applyOptionMatching(result, filterOptions);
    result.overallConfidence = overallConfidence(result, targetFields);
    const band = classifyEnrichmentConfidence(result.overallConfidence);
    result.status = resolveItemStatus(band);
    result.selectedCandidateId = candidates[0]?.id ?? null;

    await db
      .update(materialEnrichmentItems)
      .set({
        status: result.status,
        resultJson: result,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(materialEnrichmentItems.id, item.id));
    await publishMaterialEnrichmentItemEvent(item.id, "item.completed");

    if (options.autoCommitHighConfidence && result.status === "auto") {
      await commitEnrichmentItem(db, item.id, {
        autoCommitHighConfidence: true,
      });
      await publishMaterialEnrichmentItemEvent(item.id, "item.committed");
    }

    return result;
  } catch (error) {
    // A cancelled job aborts the in-flight fetch, which surfaces here as an
    // AbortError. That is not a genuine enrichment failure: writing status
    // "failed" would inflate the failed count and prevent a resume. Leave the
    // item as "pending" so it can be picked up again, and don't record it as a
    // failure.
    if (
      signal?.aborted === true ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      await db
        .update(materialEnrichmentItems)
        .set({ status: "pending", updatedAt: new Date().toISOString() })
        .where(eq(materialEnrichmentItems.id, item.id));
      await publishMaterialEnrichmentItemEvent(item.id, "item.pending");
      throw error;
    }
    const message =
      error instanceof Error
        ? error.message
        : "Lỗi không xác định khi enrichment.";
    const failedResult: MaterialEnrichmentResult = {
      fields: {},
      catalogPdfUrls: [],
      overallConfidence: 0,
      status: "failed",
      error: message,
    };
    await db
      .update(materialEnrichmentItems)
      .set({
        status: "failed",
        resultJson: failedResult,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(materialEnrichmentItems.id, item.id));
    await publishMaterialEnrichmentItemEvent(item.id, "item.failed");
    return failedResult;
  }
}

async function loadJobProgress(
  jobId: string,
): Promise<MaterialEnrichmentJobProgress> {
  const [job] = await db
    .select()
    .from(materialEnrichmentJobs)
    .where(eq(materialEnrichmentJobs.id, jobId))
    .limit(1);

  return {
    processed: job?.processed ?? 0,
    total: job?.total ?? 0,
    matched: job?.matched ?? 0,
    needsReview: job?.needsReview ?? 0,
    pdfsFound: job?.pdfsFound ?? 0,
    pdfsGenerated: job?.pdfsGenerated ?? 0,
    failed: job?.failed ?? 0,
    currentMaterialId: job?.currentMaterialId ?? null,
    currentMaterialName: job?.currentMaterialName ?? null,
    message: job?.message,
  };
}

async function refreshJobCounters(jobId: string) {
  const [stats] = await db
    .select({
      processed: sql<number>`count(*) filter (where ${materialEnrichmentItems.status} <> 'pending' and ${materialEnrichmentItems.status} <> 'processing')::int`,
      matched: sql<number>`count(*) filter (where ${materialEnrichmentItems.status} in ('auto', 'committed'))::int`,
      needsReview: sql<number>`count(*) filter (where ${materialEnrichmentItems.status} = 'review')::int`,
      failed: sql<number>`count(*) filter (where ${materialEnrichmentItems.status} = 'failed')::int`,
      pdfsFound: sql<number>`coalesce(sum(jsonb_array_length((${materialEnrichmentItems.resultJson}->'catalogPdfUrls')::jsonb)), 0)::int`,
    })
    .from(materialEnrichmentItems)
    .where(eq(materialEnrichmentItems.jobId, jobId));

  await db
    .update(materialEnrichmentJobs)
    .set({
      processed: stats?.processed ?? 0,
      matched: stats?.matched ?? 0,
      needsReview: stats?.needsReview ?? 0,
      failed: stats?.failed ?? 0,
      pdfsFound: stats?.pdfsFound ?? 0,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(materialEnrichmentJobs.id, jobId));
}

async function _processEnrichmentJob(
  jobId: string,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: MaterialEnrichmentJobProgress) => void;
  } = {},
) {
  const signal = options.signal;
  throwIfAborted(signal);
  const [job] = await db
    .select()
    .from(materialEnrichmentJobs)
    .where(eq(materialEnrichmentJobs.id, jobId))
    .limit(1);

  if (!job) {
    throw new Error("Không tìm thấy job enrichment.");
  }

  const now = new Date().toISOString();
  await db
    .update(materialEnrichmentJobs)
    .set({
      status: "running",
      message: "Đang enrichment vật tư.",
      lastProgressAt: now,
      updatedAt: now,
    })
    .where(eq(materialEnrichmentJobs.id, jobId));

  options.onProgress?.(await loadJobProgress(jobId));

  const pendingItems = await db
    .select()
    .from(materialEnrichmentItems)
    .where(
      and(
        eq(materialEnrichmentItems.jobId, jobId),
        inArray(materialEnrichmentItems.status, ["pending", "processing"]),
      ),
    )
    .orderBy(asc(materialEnrichmentItems.sortOrder));

  const jobOptions = parseJobOptions(job.optionsJson);
  let providerPromise: Promise<ResolvedAiProvider> | undefined;
  const loadProvider = () => {
    providerPromise ??= resolveAiProvider("enrichment", jobOptions.model);
    return providerPromise;
  };

  const itemConcurrency = await resolveEnrichmentItemConcurrency();
  await runWithConcurrency(pendingItems, itemConcurrency, async (item) => {
    throwIfAborted(signal);
    const [currentJob] = await db
      .select({ status: materialEnrichmentJobs.status })
      .from(materialEnrichmentJobs)
      .where(eq(materialEnrichmentJobs.id, jobId))
      .limit(1);
    if (currentJob?.status === "cancelled") {
      throw new Error("Job enrichment đã bị hủy.");
    }

    const [material] = await db
      .select({ id: materials.id, name: materials.name })
      .from(materials)
      .where(eq(materials.id, item.materialId))
      .limit(1);

    await db
      .update(materialEnrichmentJobs)
      .set({
        currentMaterialId: material?.id ?? item.materialId,
        currentMaterialName: material?.name ?? null,
        lastProgressAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(materialEnrichmentJobs.id, jobId));

    await processEnrichmentItem(job, item, loadProvider, signal);
    await refreshJobCounters(jobId);
    options.onProgress?.(await loadJobProgress(jobId));
  });
}

export const processEnrichmentItem = traceFn(
  log,
  "processEnrichmentItem",
  _processEnrichmentItem,
);
export const processEnrichmentJob = traceFn(
  log,
  "processEnrichmentJob",
  _processEnrichmentJob,
);
