import type { EnrichCandidate } from "~/app/_components/enrich/product-candidate-card";
import type { ReviewRow } from "~/app/_components/materials/review/review-types";
import type {
  FillableField,
  FillPlanCell,
} from "~/lib/materials/excel-enrich-fields";
import type { SnapshotStatus } from "~/lib/materials/review-decision";

export type WorkspaceItemForReview = {
  id: number;
  originalRowIndex: number;
  productName: string;
  specText: string;
  unit: string;
  vendorHint: string | null;
  originHint: string | null;
  unitPrice: number | null;
  currency: string;
  originalDataJson: unknown;
  enrichedSnapshotJson: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

function normalizeCandidate(value: unknown): EnrichCandidate | null {
  const record = asRecord(value);
  if (!record || typeof record.materialId !== "number") return null;
  return {
    materialId: record.materialId,
    name: stringValue(record.name),
    code: typeof record.code === "string" ? record.code : null,
    unit: stringValue(record.unit),
    category: typeof record.category === "string" ? record.category : null,
    specText: typeof record.specText === "string" ? record.specText : null,
    manufacturer:
      typeof record.manufacturer === "string" ? record.manufacturer : null,
    originCountry:
      typeof record.originCountry === "string" ? record.originCountry : null,
    defaultUnitPrice:
      typeof record.defaultUnitPrice === "number"
        ? record.defaultUnitPrice
        : null,
    currency: typeof record.currency === "string" ? record.currency : "VND",
    sourceUrl: typeof record.sourceUrl === "string" ? record.sourceUrl : null,
    score: typeof record.score === "number" ? record.score : 0,
    breakdown: (record.breakdown ?? null) as EnrichCandidate["breakdown"],
  };
}

export function sheetFieldsFromWorkspaceItem(
  item: WorkspaceItemForReview,
): Partial<Record<FillableField, string>> {
  const original = asRecord(item.originalDataJson) ?? {};
  return {
    code: stringValue(original.code),
    unit: stringValue(original.unit, item.unit ?? ""),
    category: stringValue(original.category),
    specText: stringValue(original.specText, item.specText ?? ""),
    manufacturer: stringValue(original.manufacturer, item.vendorHint ?? ""),
    originCountry: stringValue(original.originCountry, item.originHint ?? ""),
    defaultUnitPrice: stringValue(
      original.defaultUnitPrice,
      item.unitPrice == null ? "" : String(item.unitPrice),
    ),
    currency: stringValue(original.currency, item.currency ?? "VND"),
    sourceUrl: stringValue(original.sourceUrl),
  };
}

function parseFillPlan(value: unknown): FillPlanCell[] {
  if (!Array.isArray(value)) return [];
  return value as FillPlanCell[];
}

export function snapshotStatusFromItem(
  item: WorkspaceItemForReview,
): SnapshotStatus {
  const snapshot = asRecord(item.enrichedSnapshotJson);
  const status = snapshot?.status;
  if (status === "auto" || status === "review" || status === "unmatched") {
    return status;
  }
  return "unmatched";
}

export function topCandidateMaterialIdFromItem(
  item: WorkspaceItemForReview,
): number | null {
  const snapshot = asRecord(item.enrichedSnapshotJson);
  const top = asRecord(snapshot?.topCandidate);
  return typeof top?.materialId === "number" ? top.materialId : null;
}

export function workspaceItemToReviewRow(
  item: WorkspaceItemForReview,
): ReviewRow {
  const snapshot = asRecord(item.enrichedSnapshotJson);
  const candidatesRaw = snapshot?.candidates;
  const candidates = Array.isArray(candidatesRaw)
    ? candidatesRaw
        .map((candidate) => normalizeCandidate(candidate))
        .filter((candidate): candidate is EnrichCandidate => candidate != null)
    : [];
  const topCandidate = normalizeCandidate(snapshot?.topCandidate);
  const sheetFields =
    asRecord(snapshot?.sheetFields) != null
      ? (snapshot!.sheetFields as Partial<Record<FillableField, string>>)
      : sheetFieldsFromWorkspaceItem(item);
  const status = snapshotStatusFromItem(item);

  return {
    key: item.id,
    originalRowIndex: item.originalRowIndex,
    name: item.productName,
    status,
    sheetFields,
    candidates,
    topCandidate,
    fillPlan: parseFillPlan(snapshot?.fillPlan),
  };
}

export function matchRowToReviewRow(row: {
  originalRowIndex: number;
  name: string;
  status: SnapshotStatus;
  sheetFields: Partial<Record<FillableField, string>>;
  candidates: EnrichCandidate[];
  topCandidate: EnrichCandidate | null;
  fillPlan: FillPlanCell[];
}): ReviewRow {
  return {
    key: row.originalRowIndex,
    originalRowIndex: row.originalRowIndex,
    name: row.name,
    status: row.status,
    sheetFields: row.sheetFields,
    candidates: row.candidates,
    topCandidate: row.topCandidate,
    fillPlan: row.fillPlan,
  };
}

export function reviewSummaryFromRows(rows: ReviewRow[]): {
  auto: number;
  review: number;
  unmatched: number;
} {
  return rows.reduce(
    (acc, row) => {
      acc[row.status] += 1;
      return acc;
    },
    { auto: 0, review: 0, unmatched: 0 },
  );
}
