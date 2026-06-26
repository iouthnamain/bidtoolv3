import type {
  AiSearchStoredResult,
  RowDecisionLike,
  WebLinkResult,
} from "~/lib/materials/enrich-gap-fill";
import { isExportableDecision } from "~/lib/materials/enrich-gap-fill";
import {
  FILLABLE_FIELDS,
  type FillableField,
} from "~/lib/materials/excel-enrich-fields";
import type { MaterialEnrichmentEvidence } from "~/lib/materials/material-enrichment-types";

export type WebSearchStatus = "idle" | "pending" | "done" | "error";

export type RowDecision = RowDecisionLike;

export type SerializedRowDecision = {
  materialId: number | null;
  acceptedFields: FillableField[];
  overwriteFields?: FillableField[];
  editedValues?: Partial<Record<FillableField, string>>;
  webProposedFields?: Partial<Record<FillableField, string>>;
  webEvidence?: MaterialEnrichmentEvidence[];
  webSearchStatus?: WebSearchStatus;
  webLinkResults?: WebLinkResult[];
  webLinksStatus?: WebSearchStatus;
  aiSearchResult?: AiSearchStoredResult;
  aiSearchCandidates?: AiSearchStoredResult[];
  aiSearchStatus?: WebSearchStatus;
  selectedSource?: "catalog" | "web" | "ai";
  selectedSearchCandidateKey?: string;
  catalogPdfUrls?: string[];
  skipped?: boolean;
};

export type WorkspaceItemLike = {
  id: number;
  originalRowIndex: number;
  materialId: number | null;
  matchStatus: "matched" | "manual" | "candidates_found" | "unmatched";
  reviewDecisionJson: unknown;
  enrichedSnapshotJson: unknown;
};

export type SnapshotStatus = "auto" | "review" | "unmatched";

function isFillableField(value: string): value is FillableField {
  return (FILLABLE_FIELDS as readonly string[]).includes(value);
}

function filterFillableFields(values: unknown): FillableField[] {
  if (!Array.isArray(values)) return [];
  return values.filter(
    (value): value is FillableField =>
      typeof value === "string" && isFillableField(value),
  );
}

function filterStringRecord(
  value: unknown,
): Partial<Record<FillableField, string>> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const result: Partial<Record<FillableField, string>> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isFillableField(key) || typeof raw !== "string") continue;
    result[key] = raw;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function filterEvidence(value: unknown): MaterialEnrichmentEvidence[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: MaterialEnrichmentEvidence[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const field = typeof record.field === "string" ? record.field : "";
    if (!field) continue;
    result.push({
      field,
      value: typeof record.value === "string" ? record.value : "",
      snippet: typeof record.snippet === "string" ? record.snippet : "",
      sourceUrl:
        typeof record.sourceUrl === "string" ? record.sourceUrl : "",
    });
  }
  return result.length > 0 ? result : undefined;
}

function parseWebSearchStatus(value: unknown): WebSearchStatus | undefined {
  if (
    value === "idle" ||
    value === "pending" ||
    value === "done" ||
    value === "error"
  ) {
    return value;
  }
  return undefined;
}

function filterWebLinkResults(value: unknown): WebLinkResult[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: WebLinkResult[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title : "";
    const url = typeof record.url === "string" ? record.url : "";
    const domain = typeof record.domain === "string" ? record.domain : "";
    const snippet = typeof record.snippet === "string" ? record.snippet : "";
    if (!url) continue;
    result.push({
      title,
      url,
      domain,
      snippet,
      query: typeof record.query === "string" ? record.query : undefined,
      rankScore:
        typeof record.rankScore === "number" && Number.isFinite(record.rankScore)
          ? record.rankScore
          : undefined,
    });
  }
  return result.length > 0 ? result : undefined;
}

function filterCatalogPdfUrls(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const urls = value.filter(
    (url): url is string => typeof url === "string" && url.trim().length > 0,
  );
  return urls.length > 0 ? urls : undefined;
}

function filterFieldConfidences(
  value: unknown,
): Partial<Record<FillableField, number>> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const result: Partial<Record<FillableField, number>> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isFillableField(key) || typeof raw !== "number" || !Number.isFinite(raw)) {
      continue;
    }
    result[key] = raw;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function filterAiSearchResult(value: unknown): AiSearchStoredResult | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const fields = filterStringRecord(record.fields) ?? {};
  const evidence = filterEvidence(record.evidence) ?? [];
  const sourceUrls = Array.isArray(record.sourceUrls)
    ? record.sourceUrls.filter(
        (url): url is string => typeof url === "string" && url.length > 0,
      )
    : [];
  if (
    Object.keys(fields).length === 0 &&
    evidence.length === 0 &&
    sourceUrls.length === 0 &&
    !filterCatalogPdfUrls(record.catalogPdfUrls)
  ) {
    return undefined;
  }
  return {
    fields,
    sourceUrls,
    evidence,
    catalogPdfUrls: filterCatalogPdfUrls(record.catalogPdfUrls),
    fieldConfidences: filterFieldConfidences(record.fieldConfidences),
    title: typeof record.title === "string" ? record.title : undefined,
    url: typeof record.url === "string" ? record.url : undefined,
    snippet: typeof record.snippet === "string" ? record.snippet : undefined,
    rankScore:
      typeof record.rankScore === "number" && Number.isFinite(record.rankScore)
        ? record.rankScore
        : undefined,
  };
}

function filterAiSearchCandidates(
  value: unknown,
): AiSearchStoredResult[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: AiSearchStoredResult[] = [];
  for (const item of value) {
    const parsed = filterAiSearchResult(item);
    if (parsed) result.push(parsed);
  }
  return result.length > 0 ? result : undefined;
}

function parseSelectedSource(
  value: unknown,
): "catalog" | "web" | "ai" | undefined {
  if (value === "catalog" || value === "web" || value === "ai") {
    return value;
  }
  return undefined;
}

export function emptySerializedRowDecision(): SerializedRowDecision {
  return {
    materialId: null,
    acceptedFields: [],
  };
}

export function isEmptySerializedRowDecision(
  value: unknown,
): value is SerializedRowDecision | Record<string, never> {
  if (!value || typeof value !== "object") return true;
  const record = value as Partial<SerializedRowDecision>;
  if (record.skipped) return false;
  if (record.materialId != null) return false;
  if (Array.isArray(record.acceptedFields) && record.acceptedFields.length > 0) {
    return false;
  }
  if (
    record.editedValues &&
    Object.keys(record.editedValues).length > 0
  ) {
    return false;
  }
  if (
    record.webProposedFields &&
    Object.keys(record.webProposedFields).length > 0
  ) {
    return false;
  }
  if (record.webLinkResults && record.webLinkResults.length > 0) {
    return false;
  }
  if (record.aiSearchResult || (record.aiSearchCandidates?.length ?? 0) > 0) {
    return false;
  }
  return true;
}

export function serializeRowDecision(decision: RowDecision): SerializedRowDecision {
  return {
    materialId: decision.materialId,
    acceptedFields: Array.from(decision.acceptedFields),
    overwriteFields:
      decision.overwriteFields && decision.overwriteFields.size > 0
        ? Array.from(decision.overwriteFields)
        : undefined,
    editedValues: decision.editedValues,
    webProposedFields: decision.webProposedFields,
    webEvidence: decision.webEvidence,
    webSearchStatus: decision.webSearchStatus,
    webLinkResults: decision.webLinkResults,
    webLinksStatus: decision.webLinksStatus,
    aiSearchResult: decision.aiSearchResult,
    aiSearchCandidates: decision.aiSearchCandidates,
    aiSearchStatus: decision.aiSearchStatus,
    selectedSource: decision.selectedSource,
    selectedSearchCandidateKey: decision.selectedSearchCandidateKey,
    catalogPdfUrls: decision.catalogPdfUrls,
    skipped: decision.skipped ? true : undefined,
  };
}

export function deserializeRowDecision(
  value: unknown,
): RowDecision | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<SerializedRowDecision>;
  if (
    record.materialId != null &&
    (typeof record.materialId !== "number" || !Number.isFinite(record.materialId))
  ) {
    return null;
  }
  const aiSearchCandidates =
    filterAiSearchCandidates(record.aiSearchCandidates) ??
    (filterAiSearchResult(record.aiSearchResult)
      ? [filterAiSearchResult(record.aiSearchResult)!]
      : undefined);
  const aiSearchResult =
    filterAiSearchResult(record.aiSearchResult) ?? aiSearchCandidates?.[0];

  let selectedSearchCandidateKey =
    typeof record.selectedSearchCandidateKey === "string" &&
    record.selectedSearchCandidateKey.length > 0
      ? record.selectedSearchCandidateKey
      : undefined;
  const selectedSource = parseSelectedSource(record.selectedSource);
  if (!selectedSearchCandidateKey && selectedSource === "web") {
    const firstUrl = filterWebLinkResults(record.webLinkResults)?.[0]?.url;
    if (firstUrl) selectedSearchCandidateKey = `web:${firstUrl}`;
  }
  if (!selectedSearchCandidateKey && selectedSource === "ai") {
    selectedSearchCandidateKey = "ai:0";
  }

  return {
    materialId: record.materialId ?? null,
    acceptedFields: new Set(filterFillableFields(record.acceptedFields)),
    overwriteFields: new Set(filterFillableFields(record.overwriteFields)),
    editedValues: filterStringRecord(record.editedValues),
    webProposedFields: filterStringRecord(record.webProposedFields),
    webEvidence: filterEvidence(record.webEvidence),
    webSearchStatus: parseWebSearchStatus(record.webSearchStatus),
    webLinkResults: filterWebLinkResults(record.webLinkResults),
    webLinksStatus: parseWebSearchStatus(record.webLinksStatus),
    aiSearchResult,
    aiSearchCandidates,
    aiSearchStatus: parseWebSearchStatus(record.aiSearchStatus),
    selectedSource,
    selectedSearchCandidateKey,
    catalogPdfUrls: filterCatalogPdfUrls(record.catalogPdfUrls),
    skipped: record.skipped === true,
  };
}

function snapshotStatus(item: WorkspaceItemLike): SnapshotStatus {
  const snapshot =
    item.enrichedSnapshotJson && typeof item.enrichedSnapshotJson === "object"
      ? (item.enrichedSnapshotJson as { status?: unknown })
      : null;
  if (
    snapshot?.status === "auto" ||
    snapshot?.status === "review" ||
    snapshot?.status === "unmatched"
  ) {
    return snapshot.status;
  }
  if (item.matchStatus === "matched") return "auto";
  if (item.matchStatus === "candidates_found") return "review";
  return "unmatched";
}

function fillPlanFromSnapshot(item: WorkspaceItemLike) {
  const snapshot =
    item.enrichedSnapshotJson && typeof item.enrichedSnapshotJson === "object"
      ? (item.enrichedSnapshotJson as {
          fillPlan?: Array<{ action?: string; field?: string }>;
        })
      : null;
  return snapshot?.fillPlan ?? [];
}

export function seedDecisionFromItem(item: WorkspaceItemLike): RowDecision {
  const stored = deserializeRowDecision(item.reviewDecisionJson);
  if (stored && !isEmptySerializedRowDecision(item.reviewDecisionJson)) {
    return stored;
  }

  const status = snapshotStatus(item);
  const fillPlan = fillPlanFromSnapshot(item);
  const acceptedFields = new Set<FillableField>(
    fillPlan
      .filter((cell) => cell.action === "filled" && isFillableField(cell.field ?? ""))
      .map((cell) => cell.field as FillableField),
  );

  if (status === "auto" && item.materialId != null) {
    return {
      materialId: item.materialId,
      acceptedFields,
    };
  }

  if (item.materialId != null) {
    return {
      materialId: item.materialId,
      acceptedFields:
        acceptedFields.size > 0 ? acceptedFields : new Set<FillableField>(),
    };
  }

  return {
    materialId: null,
    acceptedFields: new Set<FillableField>(),
  };
}

export function deriveMatchStatus(
  decision: RowDecision,
  snapshotStatusValue: SnapshotStatus,
  topCandidateMaterialId: number | null,
): "matched" | "manual" | "candidates_found" | "unmatched" {
  if (decision.skipped) return "unmatched";
  if (decision.materialId != null) {
    if (
      snapshotStatusValue === "auto" &&
      decision.materialId === topCandidateMaterialId
    ) {
      return "matched";
    }
    return "manual";
  }
  if (isExportableDecision(decision)) {
    return "manual";
  }
  if (snapshotStatusValue === "review") return "candidates_found";
  return "unmatched";
}

/** UI row badge status after applying the current review decision. */
export function deriveReviewRowStatus(
  decision: RowDecision | undefined,
  snapshotStatus: SnapshotStatus,
  topCandidateMaterialId: number | null,
): SnapshotStatus {
  const resolved = decision ?? { materialId: null, acceptedFields: new Set() };
  if (resolved.skipped) return "unmatched";
  if (isExportableDecision(resolved)) {
    if (
      resolved.materialId != null &&
      snapshotStatus === "auto" &&
      resolved.materialId === topCandidateMaterialId
    ) {
      return "auto";
    }
    return "review";
  }
  if (resolved.materialId != null || resolved.acceptedFields.size > 0) {
    return "review";
  }
  return snapshotStatus;
}

export function seedDecisionsFromItems(
  items: WorkspaceItemLike[],
): Map<number, RowDecision> {
  const map = new Map<number, RowDecision>();
  for (const item of items) {
    map.set(item.originalRowIndex, seedDecisionFromItem(item));
  }
  return map;
}
