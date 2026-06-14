import type { FillPlanCell, FillableField } from "~/lib/materials/excel-enrich-fields";
import type { db as appDb } from "~/server/db";
import { matchRows } from "~/server/services/excel-enrich";
import { buildSearchQueries } from "~/server/services/excel-research/query-builder";
import { rankSearchHits } from "~/server/services/excel-research/source-ranker";
import type {
  ExcelResearchJobConfig,
  FieldEvidence,
  RowResearchResult,
} from "~/server/services/excel-research/types";
import { searchWeb } from "~/server/services/excel-research/web-search";

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
    title: string;
    url: string;
    domain: string;
    snippet: string;
    rankScore: number;
    sourceTier: string;
  }>;
};

export async function processSingleRow(
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

  if (config.enableWebSearch) {
    const queries = buildSearchQueries({
      name: input.productName,
      manufacturer: fields.manufacturer,
      code: fields.code,
      specText: fields.specText,
    });

    for (const q of queries) {
      const { hits } = await searchWeb(q.query, 5);
      const ranked = rankSearchHits(
        hits,
        input.productName,
        fields.manufacturer,
      );
      for (const hit of ranked.slice(0, 3)) {
        webEvidence.push({
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
    matched_fields: Object.fromEntries(
      (match?.fillPlan ?? [])
        .filter((c) => c.action === "filled")
        .map((c) => [c.field, c.after]),
    ) as Partial<Record<FillableField, string>>,
    accepted_fields: acceptedFields,
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
