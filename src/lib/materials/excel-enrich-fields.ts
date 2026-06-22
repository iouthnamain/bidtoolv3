/**
 * Client-safe field model for the Excel enrich & export feature.
 *
 * This module holds the pure pieces shared by the server enrich service and the
 * browser review UI: the fillable-field set, field↔column mapping, VN labels,
 * thresholds, and the pure `buildFillPlan` used to preview what a chosen
 * candidate would write into a row. It must stay free of `exceljs`, the DB, and
 * the matcher (which transitively pulls Playwright) so it is safe to import from
 * client components. The only cross-import is a type-only `ColumnKey`, which is
 * erased at compile time.
 */
import type { ColumnKey } from "~/server/services/excel-workbook";

/** Fields that can be filled into the uploaded sheet from a matched material. */
export const FILLABLE_FIELDS = [
  "code",
  "unit",
  "category",
  "specText",
  "manufacturer",
  "originCountry",
  "defaultUnitPrice",
  "currency",
  "sourceUrl",
] as const;

export type FillableField = (typeof FILLABLE_FIELDS)[number];

/**
 * Maps a fillable material field to the Excel column key used for mapping.
 * `currency` has no dedicated column, so it maps to `null`: consumers must skip
 * it rather than silently writing it into another column. The `null` makes the
 * compiler enforce that skip at every call site.
 */
export const FIELD_TO_COLUMN_KEY: Record<FillableField, ColumnKey | null> = {
  code: "code",
  unit: "unit",
  category: "category",
  specText: "specText",
  manufacturer: "vendorHint",
  originCountry: "originHint",
  defaultUnitPrice: "unitPrice",
  currency: null,
  sourceUrl: "sourceUrl",
};

/** Numeric fields are written back as numbers so Excel formats them. */
export const NUMERIC_FIELDS = new Set<FillableField>(["defaultUnitPrice"]);

/** Fields the review UI never offers as a fillable column of its own. */
export const NON_COLUMN_FIELDS = new Set<FillableField>(["currency"]);

/** Vietnamese-first labels, reused for appended export headers and UI chips. */
export const FIELD_LABELS: Record<FillableField, string> = {
  code: "Mã vật tư",
  unit: "ĐVT",
  category: "Nhóm",
  specText: "Thông số",
  manufacturer: "Nhà sản xuất",
  originCountry: "Xuất xứ",
  defaultUnitPrice: "Đơn giá",
  currency: "Tiền tệ",
  sourceUrl: "Nguồn",
};

// ---------------------------------------------------------------------------
// Thresholds (single tunable block, shared client + server)
// ---------------------------------------------------------------------------

export const ENRICH_THRESHOLDS = {
  auto: 0.85,
  review: 0.5,
} as const;

export const MAX_ENRICH_ROWS = 2000;

export type EnrichStatus = "auto" | "review" | "unmatched";

export function classifyStatus(score: number | null | undefined): EnrichStatus {
  if (score != null && score >= ENRICH_THRESHOLDS.auto) return "auto";
  if (score != null && score >= ENRICH_THRESHOLDS.review) return "review";
  return "unmatched";
}

// ---------------------------------------------------------------------------
// Fill plan (pure)
// ---------------------------------------------------------------------------

export type FillAction = "filled" | "kept" | "missing-both" | "overwritten";

export type FillPlanCell = {
  field: FillableField;
  before: string;
  after: string;
  action: FillAction;
};

/**
 * Compute, for each fillable field, what would happen if the given material
 * field values were applied to the row. The uploaded sheet is the source of
 * truth: we only fill blanks unless the field is force-overwritten.
 *
 * `missing-both` cells (no sheet value and no material value) are omitted.
 */
export function buildFillPlan(
  rowFields: Partial<Record<FillableField, string>>,
  materialFields: Partial<Record<FillableField, string>> | null,
  forceOverwrite: Set<FillableField> = new Set<FillableField>(),
): FillPlanCell[] {
  const plan: FillPlanCell[] = [];

  for (const field of FILLABLE_FIELDS) {
    const sheetRaw = rowFields[field]?.trim() ?? "";
    const materialRaw = materialFields?.[field]?.trim() ?? "";

    const sheetHasValue = sheetRaw.length > 0;
    const materialHasValue = materialRaw.length > 0;

    let action: FillAction;
    let after = sheetRaw;

    if (forceOverwrite.has(field) && materialHasValue) {
      action = sheetHasValue ? "overwritten" : "filled";
      after = materialRaw;
    } else if (!sheetHasValue && materialHasValue) {
      action = "filled";
      after = materialRaw;
    } else if (sheetHasValue) {
      action = "kept";
      after = sheetRaw;
    } else {
      action = "missing-both";
      after = "";
    }

    if (action === "missing-both") continue;
    plan.push({ field, before: sheetRaw, after, action });
  }

  return plan;
}

/**
 * Like {@link buildFillPlan}, but overlays user inline-edits on top of the base
 * material/found values before planning. An edited value wins over the
 * candidate's value for that field; an edit is treated as a real value, so a
 * field the user typed into fills (or overwrites) even when the base source had
 * nothing. Blank edits ("") fall through to the base value rather than clearing
 * it — to intentionally skip a field the UI unticks it instead.
 */
export function buildFillPlanWithEdits(
  rowFields: Partial<Record<FillableField, string>>,
  materialFields: Partial<Record<FillableField, string>> | null,
  editedValues: Partial<Record<FillableField, string>> = {},
  forceOverwrite: Set<FillableField> = new Set<FillableField>(),
): FillPlanCell[] {
  const overlaid: Partial<Record<FillableField, string>> = {
    ...(materialFields ?? {}),
  };
  for (const field of FILLABLE_FIELDS) {
    const edited = editedValues[field]?.trim();
    if (edited != null && edited.length > 0) {
      overlaid[field] = edited;
    }
  }
  return buildFillPlan(rowFields, overlaid, forceOverwrite);
}

// ---------------------------------------------------------------------------
// Candidate → field map (so the client can recompute a fill plan on the fly)
// ---------------------------------------------------------------------------

/** The display fields a candidate card carries, used to derive a fill plan. */
export type CandidateFieldSource = {
  code: string | null;
  unit: string;
  category: string | null;
  specSnippet: string;
  manufacturer: string | null;
  originCountry: string | null;
  defaultUnitPrice: number | null;
  currency: string;
  sourceUrl: string | null;
};

/**
 * Map a hydrated candidate's display fields onto the fillable-field shape so the
 * browser can preview a fill plan without another server round-trip.
 *
 * Note: `specSnippet` is a truncated preview; the authoritative full `specText`
 * is applied server-side at export time. The preview is good enough to show the
 * user that the field would be filled.
 */
export function candidateToFields(
  candidate: CandidateFieldSource,
): Partial<Record<FillableField, string>> {
  return {
    code: candidate.code ?? "",
    unit: candidate.unit ?? "",
    category: candidate.category ?? "",
    specText: candidate.specSnippet ?? "",
    manufacturer: candidate.manufacturer ?? "",
    originCountry: candidate.originCountry ?? "",
    defaultUnitPrice:
      candidate.defaultUnitPrice == null
        ? ""
        : String(candidate.defaultUnitPrice),
    currency: candidate.currency ?? "",
    sourceUrl: candidate.sourceUrl ?? "",
  };
}

// ---------------------------------------------------------------------------
// "Why it matched" chips (derived from the score breakdown)
// ---------------------------------------------------------------------------

export type MatchScoreBreakdown = {
  nameSimilarity: number;
  unitMatch: number;
  manufacturerMatch: number;
  originMatch: number;
  specMatch: number;
  dimensionMatch: number;
};

/** Turn a score breakdown into short VN chips explaining the match. */
export function matchReasonChips(
  breakdown: MatchScoreBreakdown | null | undefined,
): string[] {
  if (!breakdown) return [];
  const chips: string[] = [];

  if (breakdown.nameSimilarity > 0) {
    chips.push(`tên ${Math.round(breakdown.nameSimilarity * 100)}%`);
  }
  if (breakdown.unitMatch >= 1) chips.push("cùng ĐVT");
  if (breakdown.manufacturerMatch >= 0.9) chips.push("NSX khớp");
  if (breakdown.originMatch >= 1) chips.push("xuất xứ khớp");
  if (breakdown.specMatch >= 0.7) chips.push("thông số khớp");
  if (breakdown.dimensionMatch > 0.5) chips.push("kích thước khớp");

  return chips;
}
