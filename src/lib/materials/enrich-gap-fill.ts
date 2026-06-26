import {
  buildFillPlan,
  buildFillPlanWithEdits,
  candidateToFields,
  FILLABLE_FIELDS,
  type FillableField,
  type FillPlanCell,
} from "~/lib/materials/excel-enrich-fields";
import type { CandidateFieldSource } from "~/lib/materials/excel-enrich-fields";
import type { MaterialEnrichmentEvidence } from "~/lib/materials/material-enrichment-types";

export type WebSearchStatus = "idle" | "pending" | "done" | "error";

export type WebLinkResult = {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  query?: string;
  rankScore?: number;
};

export type AiSearchStoredResult = {
  fields: Partial<Record<FillableField, string>>;
  sourceUrls: string[];
  evidence: MaterialEnrichmentEvidence[];
  catalogPdfUrls?: string[];
  fieldConfidences?: Partial<Record<FillableField, number>>;
  title?: string;
  url?: string;
  snippet?: string;
  rankScore?: number;
};

export type AiSearchCandidateStored = AiSearchStoredResult;

export type RowDecisionLike = {
  materialId: number | null;
  acceptedFields: Set<FillableField>;
  overwriteFields?: Set<FillableField>;
  editedValues?: Partial<Record<FillableField, string>>;
  webProposedFields?: Partial<Record<FillableField, string>>;
  webEvidence?: MaterialEnrichmentEvidence[];
  webSearchStatus?: WebSearchStatus;
  webLinkResults?: WebLinkResult[];
  webLinksStatus?: WebSearchStatus;
  aiSearchResult?: AiSearchStoredResult;
  aiSearchCandidates?: AiSearchCandidateStored[];
  aiSearchStatus?: WebSearchStatus;
  selectedSource?: "catalog" | "web" | "ai";
  selectedSearchCandidateKey?: string;
  catalogPdfUrls?: string[];
  skipped?: boolean;
};

/** Fields the catalog candidate would fill into blank sheet cells. */
export function getCatalogFilledFields(
  sheetFields: Partial<Record<FillableField, string>>,
  catalogFields: Partial<Record<FillableField, string>> | null,
): Set<FillableField> {
  if (!catalogFields) return new Set();
  const plan = buildFillPlan(sheetFields, catalogFields);
  return new Set(
    plan.filter((cell) => cell.action === "filled").map((cell) => cell.field),
  );
}

/**
 * Merge catalog fill values with web-extracted fields. Web values apply only
 * when the catalog would not fill that field (mirrors row-research gap-fill).
 */
export function mergeWebGapFill(
  sheetFields: Partial<Record<FillableField, string>>,
  catalogFields: Partial<Record<FillableField, string>> | null,
  webFields: Partial<Record<FillableField, string>>,
): Partial<Record<FillableField, string>> {
  const catalogFilled = getCatalogFilledFields(sheetFields, catalogFields);
  const result: Partial<Record<FillableField, string>> = {};

  if (catalogFields) {
    const plan = buildFillPlan(sheetFields, catalogFields);
    for (const cell of plan) {
      if (cell.action === "filled") {
        result[cell.field] = cell.after;
      }
    }
  }

  for (const field of FILLABLE_FIELDS) {
    const webValue = webFields[field]?.trim() ?? "";
    if (!webValue) continue;
    if (catalogFilled.has(field)) continue;
    if (field === "code") {
      const existingCode =
        (sheetFields.code ?? "").trim() || (result.code ?? "").trim();
      if (existingCode) continue;
    }
    result[field] = webValue;
  }

  return result;
}

/** Web fields that would actually contribute after catalog gap-fill rules. */
export function webFieldsAfterGapFill(
  sheetFields: Partial<Record<FillableField, string>>,
  catalogFields: Partial<Record<FillableField, string>> | null,
  webFields: Partial<Record<FillableField, string>>,
): Partial<Record<FillableField, string>> {
  const merged = mergeWebGapFill(sheetFields, catalogFields, webFields);
  const catalogOnly = catalogFields
    ? mergeWebGapFill(sheetFields, catalogFields, {})
    : {};
  const result: Partial<Record<FillableField, string>> = {};
  for (const field of FILLABLE_FIELDS) {
    const mergedValue = merged[field]?.trim() ?? "";
    const catalogValue = catalogOnly[field]?.trim() ?? "";
    if (mergedValue && mergedValue !== catalogValue) {
      result[field] = mergedValue;
    } else if (!catalogFields && mergedValue) {
      result[field] = mergedValue;
    }
  }
  return result;
}

/** Accept every non-empty proposed field (profile review: map all extracted values). */
export function applyAllProposedFields(
  fields: Partial<Record<FillableField, string>>,
): {
  acceptedFields: Set<FillableField>;
  editedValues: Partial<Record<FillableField, string>>;
} {
  const acceptedFields = new Set<FillableField>();
  const editedValues: Partial<Record<FillableField, string>> = {};
  for (const field of FILLABLE_FIELDS) {
    if (field === "currency") continue;
    const value = fields[field]?.trim() ?? "";
    if (!value) continue;
    acceptedFields.add(field);
    editedValues[field] = value;
  }
  return { acceptedFields, editedValues };
}

/** Profile select: map all fields and default currency when price is present. */
export function applyAllProposedFieldsWithCurrency(
  fields: Partial<Record<FillableField, string>>,
): {
  acceptedFields: Set<FillableField>;
  editedValues: Partial<Record<FillableField, string>>;
} {
  const result = applyAllProposedFields(fields);
  if (result.editedValues.defaultUnitPrice?.trim()) {
    result.editedValues.currency = "VND";
    result.acceptedFields.add("currency");
  }
  return result;
}

/** Profile review: effective "Sau" values from edits overlaid on proposed/catalog base. */
export function profileEffectiveFieldValues(
  sheetFields: Partial<Record<FillableField, string>>,
  catalogFields: Partial<Record<FillableField, string>> | null,
  decision: Pick<RowDecisionLike, "editedValues" | "webProposedFields">,
): Partial<Record<FillableField, string>> {
  const baseFields: Partial<Record<FillableField, string>> =
    catalogFields != null
      ? mergeWebGapFill(
          sheetFields,
          catalogFields,
          decision.webProposedFields ?? {},
        )
      : { ...(decision.webProposedFields ?? {}) };
  const result: Partial<Record<FillableField, string>> = {};
  for (const field of FILLABLE_FIELDS) {
    if (field === "currency") continue;
    const value = (
      decision.editedValues?.[field] ??
      baseFields[field] ??
      ""
    ).trim();
    if (value) result[field] = value;
  }
  const price = result.defaultUnitPrice?.trim();
  if (price && !result.currency) {
    const editedCurrency = decision.editedValues?.currency?.trim();
    const sheetCurrency = sheetFields.currency?.trim();
    result.currency =
      (editedCurrency && editedCurrency.length > 0
        ? editedCurrency
        : undefined) ??
      (sheetCurrency && sheetCurrency.length > 0 ? sheetCurrency : undefined) ??
      "VND";
  }
  return result;
}

export function profileAcceptedFields(
  sheetFields: Partial<Record<FillableField, string>>,
  catalogFields: Partial<Record<FillableField, string>> | null,
  decision: Pick<RowDecisionLike, "editedValues" | "webProposedFields">,
): Set<FillableField> {
  return new Set(
    Object.keys(
      profileEffectiveFieldValues(sheetFields, catalogFields, decision),
    ) as FillableField[],
  );
}

export type WebSearchRowResult = {
  fields: Partial<Record<FillableField, string>>;
  evidence: MaterialEnrichmentEvidence[];
  sourceUrls?: string[];
  catalogPdfUrls?: string[];
};

/** Effective values for accepted fields after catalog + web gap-fill + edits. */
export function effectiveAcceptedFieldValues(
  sheetFields: Partial<Record<FillableField, string>>,
  catalogFields: Partial<Record<FillableField, string>> | null,
  decision: Pick<
    RowDecisionLike,
    "acceptedFields" | "editedValues" | "webProposedFields" | "overwriteFields"
  >,
): Partial<Record<FillableField, string>> {
  const baseFields = mergeWebGapFill(
    sheetFields,
    catalogFields,
    decision.webProposedFields ?? {},
  );
  const plan = buildFillPlanWithEdits(
    sheetFields,
    baseFields,
    decision.editedValues ?? {},
    decision.overwriteFields ?? new Set(),
  );
  const result: Partial<Record<FillableField, string>> = {};
  for (const cell of plan) {
    if (decision.acceptedFields.has(cell.field)) {
      result[cell.field] = cell.after;
    }
  }
  return result;
}

/** Merge a completed web-search result into an existing row decision. */
export function applyWebSearchToDecision(
  current: RowDecisionLike,
  sheetFields: Partial<Record<FillableField, string>>,
  catalogFields: Partial<Record<FillableField, string>> | null,
  result: WebSearchRowResult,
): RowDecisionLike {
  const mergedWeb = {
    ...(current.webProposedFields ?? {}),
    ...result.fields,
  };
  const gapFields = webFieldsAfterGapFill(
    sheetFields,
    catalogFields,
    result.fields,
  );
  const nextEdited = { ...(current.editedValues ?? {}) };
  const nextAccepted = new Set(current.acceptedFields);
  for (const [field, value] of Object.entries(gapFields)) {
    const fillable = field as FillableField;
    nextEdited[fillable] = value;
    nextAccepted.add(fillable);
  }
  return {
    materialId: current.materialId,
    acceptedFields: nextAccepted,
    overwriteFields: current.overwriteFields ?? new Set(),
    editedValues: nextEdited,
    webProposedFields: mergedWeb,
    webEvidence: result.evidence,
    webSearchStatus: "done",
    webLinkResults: current.webLinkResults,
    webLinksStatus: current.webLinksStatus,
    aiSearchResult: current.aiSearchResult,
    aiSearchCandidates: current.aiSearchCandidates,
    aiSearchStatus: current.aiSearchStatus,
    selectedSource: current.selectedSource ?? "ai",
    selectedSearchCandidateKey: current.selectedSearchCandidateKey,
    skipped: current.skipped,
  };
}

/** Point a row decision at a saved catalog material and tick saved fields. */
export function applySavedMaterialToDecision(
  materialId: number,
  values: Partial<Record<FillableField, string>>,
  current?: RowDecisionLike,
): RowDecisionLike {
  const nextAccepted = new Set<FillableField>();
  for (const field of FILLABLE_FIELDS) {
    if (field === "currency") continue;
    const value = values[field]?.trim() ?? "";
    if (value) nextAccepted.add(field);
  }
  return {
    materialId,
    acceptedFields: nextAccepted,
    overwriteFields: new Set(),
    editedValues: {},
    webProposedFields: {},
    webEvidence: [],
    webSearchStatus:
      current?.webSearchStatus === "pending" ? "pending" : undefined,
    webLinkResults: current?.webLinkResults,
    webLinksStatus: current?.webLinksStatus,
    aiSearchResult: current?.aiSearchResult,
    aiSearchCandidates: current?.aiSearchCandidates,
    aiSearchStatus: current?.aiSearchStatus,
    selectedSource: "catalog",
    selectedSearchCandidateKey: current?.selectedSearchCandidateKey,
    skipped: false,
  };
}

/** Whether a row decision can be exported (catalog match or full overrides). */
export function isExportableDecision(decision: RowDecisionLike): boolean {
  if (decision.skipped) return false;
  if (decision.acceptedFields.size === 0) return false;
  if (decision.materialId != null) return true;
  const overrides = decision.editedValues ?? {};
  return Array.from(decision.acceptedFields).every(
    (field) => (overrides[field]?.trim() ?? "").length > 0,
  );
}

export function countFieldsToFill(decisions: Iterable<RowDecisionLike>): number {
  let count = 0;
  for (const decision of decisions) {
    if (isExportableDecision(decision)) {
      count += decision.acceptedFields.size;
    }
  }
  return count;
}

export function countResolvedRows(decisions: Iterable<RowDecisionLike>): number {
  let count = 0;
  for (const decision of decisions) {
    if (decision.skipped) continue;
    if (decision.materialId != null || decision.acceptedFields.size > 0) {
      count += 1;
    }
  }
  return count;
}

export type ExportPreviewRow = {
  originalRowIndex: number;
  productName: string;
  cells: FillPlanCell[];
};

export type SheetEdits = Record<string, Partial<Record<FillableField, string>>>;

const EXPORT_PREVIEW_ROW_LIMIT = 50;

/**
 * Build client-side export preview rows from match results + user decisions.
 */
export function buildExportPreviewRows(
  rows: Array<{
    originalRowIndex: number;
    name: string;
    sheetFields: Partial<Record<FillableField, string>>;
    candidates: Array<CandidateFieldSource & { materialId: number }>;
  }>,
  decisions: Map<number, RowDecisionLike>,
  options?: { fillsOnly?: boolean; limit?: number; sheetEdits?: SheetEdits },
): { rows: ExportPreviewRow[]; truncated: boolean; totalExportable: number } {
  const fillsOnly = options?.fillsOnly ?? true;
  const limit = options?.limit ?? EXPORT_PREVIEW_ROW_LIMIT;
  const previewRows: ExportPreviewRow[] = [];
  let totalExportable = 0;

  for (const row of rows) {
    const decision = decisions.get(row.originalRowIndex);
    if (!decision || !isExportableDecision(decision)) continue;
    totalExportable += 1;

    const candidate =
      decision.materialId != null
        ? row.candidates.find((c) => c.materialId === decision.materialId) ??
          null
        : null;
    const catalogFields = candidate ? candidateToFields(candidate) : null;
    const baseFields = mergeWebGapFill(
      row.sheetFields,
      catalogFields,
      decision.webProposedFields ?? {},
    );
    const plan = buildFillPlanWithEdits(
      row.sheetFields,
      baseFields,
      {
        ...(decision.editedValues ?? {}),
        ...(options?.sheetEdits?.[String(row.originalRowIndex)] ?? {}),
      },
      decision.overwriteFields ?? new Set(),
    ).filter((cell) => decision.acceptedFields.has(cell.field));

    const cells = fillsOnly
      ? plan.filter(
          (cell) => cell.action === "filled" || cell.action === "overwritten",
        )
      : plan;

    if (cells.length === 0) continue;
    if (previewRows.length < limit) {
      previewRows.push({
        originalRowIndex: row.originalRowIndex,
        productName: row.name,
        cells,
      });
    }
  }

  return {
    rows: previewRows,
    truncated: totalExportable > previewRows.length,
    totalExportable,
  };
}
