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
import { db } from "~/server/db";
import {
  materialEnrichmentItems,
  materialEnrichmentJobs,
  materialWebCandidates,
  materials,
} from "~/server/db/schema";
import {
  resolveOpenRouterApiKey,
  resolveOpenRouterDefaultModel,
} from "~/server/services/app-settings";
import { commitEnrichmentItem } from "~/server/services/material-enrichment-commit";
import { extractProductFromSources } from "~/server/services/material-enrichment-extract";
import {
  extractPdfUrlsFromResults,
  rankSearchResults,
  searchWebForProduct,
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
const ITEM_CONCURRENCY = 2;

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

function materialToInput(material: typeof materials.$inferSelect): MaterialEnrichmentInput {
  return {
    materialId: material.id,
    code: material.code,
    name: material.name,
    unit: material.unit,
    category: material.category,
    specText: material.specText,
    manufacturer: material.manufacturer,
    originCountry: material.originCountry,
    sourceUrl: material.sourceUrl,
    sku: null,
    model: null,
  };
}

function buildSearchQueries(input: MaterialEnrichmentInput, maxQueries: number) {
  const queries: string[] = [];
  const push = (value: string | null | undefined) => {
    const trimmed = value?.trim();
    if (!trimmed) {
      return;
    }
    if (!queries.includes(trimmed)) {
      queries.push(trimmed);
    }
  };

  push(`${input.name} ${input.manufacturer ?? ""} datasheet`.trim());
  push(`${input.name} catalog pdf`);
  push(input.manufacturer ? `${input.manufacturer} ${input.name}` : null);
  push(input.sku ? `${input.sku} ${input.name}` : null);
  push(input.model ? `${input.model} ${input.name}` : null);
  push(input.specText ? `${input.name} ${input.specText.slice(0, 120)}` : null);
  push(input.name);

  return queries.slice(0, maxQueries);
}

function overallConfidence(result: MaterialEnrichmentResult, fields: EnrichableField[]) {
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
        confidenceScore: Math.max(0, Math.min(100, Math.round((result.rankScore + 1) * 40))),
        matchReasons: result.rankScore > 0 ? [`rank:${result.rankScore.toFixed(2)}`] : [],
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
          ...new Set([
            ...((rows[0].catalogPdfUrls as string[]) ?? []),
            ...extractedPdfUrls,
          ]),
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
    catalogPdfUrls: [...new Set([...(extracted.catalogPdfUrls ?? []), ...pdfUrls])],
    overallConfidence: 0,
    status: "review",
  };
  result.overallConfidence = overallConfidence(result, targetFields);
  const band = classifyEnrichmentConfidence(result.overallConfidence);
  result.status = band === "auto" ? "auto" : band === "review" ? "review" : "skipped";
  return result;
}

export async function processEnrichmentItem(
  job: JobRow,
  item: ItemRow,
  signal?: AbortSignal,
) {
  throwIfAborted(signal);
  const options = parseJobOptions(job.optionsJson);
  const filterOptions = parseFilterOptions(job.filterSnapshotJson);
  const targetFields = options.fields?.length ? options.fields : [...ENRICHABLE_FIELDS];
  const now = new Date().toISOString();

  await db
    .update(materialEnrichmentItems)
    .set({ status: "processing", updatedAt: now })
    .where(eq(materialEnrichmentItems.id, item.id));

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

  try {
    const queries = buildSearchQueries(
      input,
      options.maxQueries ?? DEFAULT_MAX_QUERIES,
    );
    const rawResults = await searchWebForProduct(queries, signal);
    const ranked = rankSearchResults(rawResults, {
      manufacturer: input.manufacturer,
      name: input.name,
      sourceUrl: input.sourceUrl,
    }).slice(0, options.maxSearchResults ?? DEFAULT_MAX_SEARCH_RESULTS);
    const pdfUrls = extractPdfUrlsFromResults(ranked);
    const candidates = await saveWebCandidates(item, ranked, pdfUrls);

    const apiKey = await resolveOpenRouterApiKey();
    if (!apiKey) {
      throw new Error("Chưa cấu hình OpenRouter API key.");
    }
    const model = options.model ?? (await resolveOpenRouterDefaultModel());
    const extracted = await extractProductFromSources(
      input,
      ranked,
      apiKey,
      model,
      signal,
    );

    const result = buildResultFromExtraction(extracted, pdfUrls, targetFields);
    applyOptionMatching(result, filterOptions);
    result.overallConfidence = overallConfidence(result, targetFields);
    const band = classifyEnrichmentConfidence(result.overallConfidence);
    result.status = band === "auto" ? "auto" : band === "review" ? "review" : "skipped";
    result.selectedCandidateId = candidates[0]?.id ?? null;

    await db
      .update(materialEnrichmentItems)
      .set({
        status: result.status,
        resultJson: result,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(materialEnrichmentItems.id, item.id));

    if (options.autoCommitHighConfidence && result.status === "auto") {
      await commitEnrichmentItem(db, item.id, {
        autoCommitHighConfidence: true,
      });
    }

    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Lỗi không xác định khi enrichment.";
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
    return failedResult;
  }
}

async function loadJobProgress(jobId: string): Promise<MaterialEnrichmentJobProgress> {
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

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  let index = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      if (!current) {
        continue;
      }
      await worker(current);
    }
  });
  await Promise.all(runners);
}

export async function processEnrichmentJob(
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

  await runWithConcurrency(pendingItems, ITEM_CONCURRENCY, async (item) => {
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

    await processEnrichmentItem(job, item, signal);
    await refreshJobCounters(jobId);
    options.onProgress?.(await loadJobProgress(jobId));
  });
}
