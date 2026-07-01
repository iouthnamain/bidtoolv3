import type {
  FillPlanCell,
  FillableField,
} from "~/lib/materials/excel-enrich-fields";
import type { db as appDb } from "~/server/db";
import {
  mapExtractedToFillable,
  webHitsToSearchResults,
} from "~/server/services/enrich-web-row";
import { matchRows } from "~/server/services/excel-enrich";
import { buildSearchQueries } from "~/server/services/excel-research/query-builder";
import { rankSearchHits } from "~/server/services/excel-research/source-ranker";
import type {
  ExcelResearchJobConfig,
  FieldEvidence,
  RowResearchResult,
} from "~/server/services/excel-research/types";
import { searchWeb } from "~/server/services/excel-research/web-search";
import {
  resolveAiProvider,
  resolveSearchDomainPolicy,
  resolveSearchQueryControls,
} from "~/server/services/app-settings";
import { extractProductFromSources } from "~/server/services/material-enrichment-extract";
import type { MaterialEnrichmentInput } from "~/lib/materials/material-enrichment-types";
import { createLogger, traceFn } from "~/server/lib/logger";
const log = createLogger("services-excel-research-row-research");

type AppDb = typeof appDb;

export type RowResearchInput = {
  rowNumber: number;
  productName: string;
  fields: Partial<Record<FillableField, string>> & { name?: string };
};

export type RowResearchOutput = {
  rowStatus: "matched" | "needs_review" | "error";
  matchedMaterialId: number | null;
  confidenceScore: number;
  fillPlan: FillPlanCell[];
  result: RowResearchResult;
  catalogEvidence: Array<{
    materialId: number;
    title: string;
    url: string;
    score: number;
    breakdown: unknown;
  }>;
  webEvidence: Array<{
    provider: string;
    title: string;
    url: string;
    domain: string;
    snippet: string;
    rankScore: number;
    sourceTier: string;
  }>;
};

async function _processSingleRow(
  db: AppDb,
  input: RowResearchInput,
  config: ExcelResearchJobConfig,
): Promise<RowResearchOutput> {
  const fields = { ...input.fields };
  delete fields.name;

  const matchResults = await matchRows(
    db,
    [
      {
        originalRowIndex: input.rowNumber,
        name: input.productName,
        fields,
      },
    ],
    {
      minSimilarity: config.minSimilarity,
      limit: config.candidateLimit,
    },
  );

  const match = matchResults[0];
  const top = match?.topCandidate ?? null;
  const catalogScore = top?.score ?? 0;

  const catalogEvidence =
    match?.candidates.map((c) => ({
      materialId: c.materialId,
      title: c.name,
      url: c.sourceUrl ?? "",
      score: c.score ?? 0,
      breakdown: c.breakdown,
    })) ?? [];

  const webEvidence: RowResearchOutput["webEvidence"] = [];
  let bestWebRank = 0;

  const shouldSearchWeb =
    config.enableWebSearch && catalogScore < config.autoThreshold;

  if (shouldSearchWeb) {
    const [domainPolicy, queryControls] = await Promise.all([
      resolveSearchDomainPolicy(),
      resolveSearchQueryControls(),
    ]);
    const queries = buildSearchQueries(
      {
        name: input.productName,
        manufacturer: fields.manufacturer,
        code: fields.code,
        specText: fields.specText,
      },
      {
        context: "excel_research",
        domainPolicy,
        queryControls,
      },
    );

    const searchResults = await Promise.all(
      queries.map((q) => searchWeb(q.query, 5)),
    );

    for (const { hits } of searchResults) {
      const ranked = rankSearchHits(
        hits,
        input.productName,
        fields.manufacturer,
      );
      for (const hit of ranked.slice(0, 3)) {
        webEvidence.push({
          provider: hit.provider,
          title: hit.title,
          url: hit.url,
          domain: hit.domain,
          snippet: hit.snippet,
          rankScore: hit.rankScore,
          sourceTier: hit.sourceTier,
        });
        bestWebRank = Math.max(bestWebRank, hit.rankScore);
      }
    }
  }

  const acceptedFields = (match?.fillPlan ?? [])
    .filter((cell) => cell.action === "filled")
    .map((cell) => cell.field);

  const catalogFilledFields = new Set(acceptedFields);

  const evidence: FieldEvidence[] = [];
  if (top) {
    for (const cell of match?.fillPlan ?? []) {
      if (cell.action !== "filled") continue;
      evidence.push({
        field: cell.field,
        value: cell.after,
        source_url: top.sourceUrl ?? "",
        source_type: "catalog_match",
        confidence: catalogScore,
        note: "Ghép catalog nội bộ",
      });
    }
  }

  for (const web of webEvidence.slice(0, 2)) {
    evidence.push({
      field: "sourceUrl",
      value: web.url,
      source_url: web.url,
      source_type: "web_search",
      confidence: Math.min(0.7, web.rankScore / 100),
      note: web.snippet.slice(0, 200),
    });
  }

  const matchedFields: Partial<Record<FillableField, string>> =
    Object.fromEntries(
      (match?.fillPlan ?? [])
        .filter((cell) => cell.action === "filled")
        .map((cell) => [cell.field, cell.after]),
    ) as Partial<Record<FillableField, string>>;

  const webAcceptedFields: FillableField[] = [];

  if (shouldSearchWeb && webEvidence.length > 0) {
    try {
      const provider = await resolveAiProvider("enrichment");
      const rankedHits = webHitsToSearchResults(webEvidence);
      const unitTrimmed = fields.unit?.trim();
      const enrichmentInput: MaterialEnrichmentInput = {
        materialId: top?.materialId ?? 0,
        name: input.productName,
        unit: unitTrimmed && unitTrimmed.length > 0 ? unitTrimmed : "cái",
        code: fields.code ?? null,
        category: fields.category ?? null,
        specText: fields.specText ?? "",
        manufacturer: fields.manufacturer ?? null,
        originCountry: fields.originCountry ?? null,
        defaultUnitPrice: null,
        currency: "VND",
        sourceUrl: null,
        sku: fields.code ?? null,
        model: fields.code ?? null,
      };

      const extracted = await extractProductFromSources(
        enrichmentInput,
        rankedHits,
        provider,
      );
      const sourceUrls = [
        ...new Set(webEvidence.map((hit) => hit.url).filter(Boolean)),
      ];
      const webMapped = mapExtractedToFillable(extracted, sourceUrls);

      for (const [field, value] of Object.entries(webMapped.fields)) {
        const fillable = field as FillableField;
        const trimmed = value?.trim() ?? "";
        if (!trimmed) continue;
        if (catalogFilledFields.has(fillable)) continue;

        if (fillable === "code") {
          const existingCode =
            (fields.code ?? "").trim() || (matchedFields.code ?? "").trim();
          if (existingCode) continue;
        }

        matchedFields[fillable] = trimmed;
        webAcceptedFields.push(fillable);
        evidence.push({
          field: fillable,
          value: trimmed,
          source_url: webMapped.fields.sourceUrl ?? sourceUrls[0] ?? "",
          source_type: "web_search",
          confidence: Math.min(0.75, bestWebRank / 100),
          note: "Trích xuất từ kết quả web",
        });
      }

      for (const item of webMapped.evidence) {
        evidence.push({
          field: item.field,
          value: item.value,
          source_url: item.sourceUrl,
          source_type: "web_search",
          confidence: Math.min(0.75, bestWebRank / 100),
          note: item.snippet.slice(0, 200),
        });
      }
    } catch {
      // Missing AI provider or extraction failure — keep today's URL-only evidence.
    }
  }

  const allAcceptedFields = [
    ...new Set([...acceptedFields, ...webAcceptedFields]),
  ];

  const webOnly = catalogScore < config.reviewThreshold && bestWebRank > 0;
  const confidenceScore = webOnly
    ? Math.min(0.75, bestWebRank / 100)
    : catalogScore;

  let rowStatus: RowResearchOutput["rowStatus"] = "error";
  let needsReview = true;
  let reviewReason = "Không tìm thấy nguồn phù hợp.";

  if (catalogScore >= config.autoThreshold) {
    rowStatus = "matched";
    needsReview = false;
    reviewReason = "";
  } else if (catalogScore >= config.reviewThreshold || webOnly) {
    rowStatus = "needs_review";
    needsReview = true;
    reviewReason = webOnly
      ? "Chỉ có kết quả web — cần duyệt thủ công."
      : "Độ tin cậy catalog ở mức trung bình.";
  }

  const resultStatus: RowResearchResult["status"] =
    rowStatus === "matched"
      ? "matched"
      : rowStatus === "needs_review"
        ? "needs_review"
        : "failed";

  const result: RowResearchResult = {
    row_number: input.rowNumber,
    status: resultStatus,
    input_product_data: {
      name: input.productName,
      ...Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [k, v ?? ""]),
      ),
    },
    matched_product: top
      ? {
          name: top.name,
          brand: top.manufacturer ?? "",
          model: top.code ?? "",
          sku: top.code ?? "",
          category: top.category ?? "",
          material_id: top.materialId,
          source: webOnly ? "web" : "catalog",
        }
      : null,
    matched_fields: matchedFields,
    accepted_fields: allAcceptedFields,
    catalog_pdf_url: top?.sourceUrl ?? webEvidence[0]?.url ?? "",
    source_urls: [
      ...catalogEvidence.map((c) => c.url).filter(Boolean),
      ...webEvidence.map((w) => w.url),
    ],
    evidence,
    confidence_score: confidenceScore,
    needs_review: needsReview,
    review_reason: reviewReason,
  };

  return {
    rowStatus,
    matchedMaterialId: top?.materialId ?? null,
    confidenceScore,
    fillPlan: match?.fillPlan ?? [],
    result,
    catalogEvidence,
    webEvidence,
  };
}

export const processSingleRow = traceFn(
  log,
  "processSingleRow",
  _processSingleRow,
);
