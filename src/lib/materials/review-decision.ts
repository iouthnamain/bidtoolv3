import type { RowDecisionLike } from "~/lib/materials/enrich-gap-fill";
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
  return {
    materialId: record.materialId ?? null,
    acceptedFields: new Set(filterFillableFields(record.acceptedFields)),
    overwriteFields: new Set(filterFillableFields(record.overwriteFields)),
    editedValues: filterStringRecord(record.editedValues),
    webProposedFields: filterStringRecord(record.webProposedFields),
    webEvidence: filterEvidence(record.webEvidence),
    webSearchStatus: parseWebSearchStatus(record.webSearchStatus),
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
  if (decision.materialId == null) {
    if (snapshotStatusValue === "review") return "candidates_found";
    return "unmatched";
  }
  if (
    snapshotStatusValue === "auto" &&
    decision.materialId === topCandidateMaterialId
  ) {
    return "matched";
  }
  return "manual";
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
