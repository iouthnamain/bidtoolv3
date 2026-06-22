import ExcelJS from "exceljs";
import { and, inArray, isNull } from "drizzle-orm";

import type { db as appDb } from "~/server/db";
import { materials } from "~/server/db/schema";
import {
  findFuzzyCandidates,
  type ScoreBreakdown,
} from "~/server/services/ai-product-matcher";
import type { ScrapedShopProduct } from "~/server/services/shop-material-scraper";
import {
  columnKeys,
  parseOptionalNumber,
  type ColumnKey,
  type ColumnMapping,
  type ParsedWorkbookSheet,
} from "~/server/services/excel-workbook";
import {
  FILLABLE_FIELDS,
  FIELD_TO_COLUMN_KEY,
  NUMERIC_FIELDS,
  ENRICH_THRESHOLDS,
  MAX_ENRICH_ROWS,
  FIELD_LABELS,
  classifyStatus,
  buildFillPlan as buildFillPlanPure,
  type FillableField,
  type FillAction,
  type FillPlanCell,
  type EnrichStatus,
} from "~/lib/materials/excel-enrich-fields";

type AppDb = typeof appDb;
type MaterialRow = typeof materials.$inferSelect;

// ---------------------------------------------------------------------------
// Field model — single source of truth lives in the client-safe lib. We import
// the pure pieces and re-export them here for back-compat with existing server
// imports. There must be exactly ONE definition of each of these.
// ---------------------------------------------------------------------------

export {
  FILLABLE_FIELDS,
  FIELD_TO_COLUMN_KEY,
  NUMERIC_FIELDS,
  ENRICH_THRESHOLDS,
  MAX_ENRICH_ROWS,
  FIELD_LABELS,
  classifyStatus,
};
export type { FillableField, FillAction, FillPlanCell, EnrichStatus };
export type { ColumnMapping };

export const MATCH_CONCURRENCY = 10;

export type EnrichCandidate = {
  materialId: number;
  name: string;
  code: string | null;
  unit: string;
  category: string | null;
  manufacturer: string | null;
  originCountry: string | null;
  defaultUnitPrice: number | null;
  currency: string;
  imageUrl: string | null;
  sourceUrl: string | null;
  specSnippet: string;
  score: number;
  breakdown: ScoreBreakdown | null;
};

export type EnrichRowInput = {
  originalRowIndex: number;
  fields: Partial<Record<FillableField, string>>;
};

export type EnrichRowResult = {
  originalRowIndex: number;
  status: EnrichStatus;
  topCandidate: EnrichCandidate | null;
  candidates: EnrichCandidate[];
  fillPlan: FillPlanCell[];
};

// ---------------------------------------------------------------------------
// Row → ScrapedShopProduct shape (the matcher's input)
// ---------------------------------------------------------------------------

export function rowToScrapedProduct(
  fields: Partial<Record<FillableField, string>> & { name?: string },
): ScrapedShopProduct {
  return {
    name: (fields.name ?? "").trim(),
    unit: emptyToNull(fields.unit),
    category: emptyToNull(fields.category),
    specText: fields.specText?.trim() ?? "",
    manufacturer: emptyToNull(fields.manufacturer),
    originCountry: emptyToNull(fields.originCountry),
    price: fields.defaultUnitPrice
      ? parseOptionalNumber(fields.defaultUnitPrice)
      : null,
    priceText: emptyToNull(fields.defaultUnitPrice),
    currency: emptyToNull(fields.currency) ?? "VND",
    sourceUrl: emptyToNull(fields.sourceUrl) ?? "enrich://row",
    imageUrl: null,
    sku: emptyToNull(fields.code),
    model: null,
    availability: null,
    shopCategory: emptyToNull(fields.category),
    catalogPdfUrls: [],
  };
}

// The match key is the product name; rows carry it under a reserved "name" key.

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

// ---------------------------------------------------------------------------
// Candidate hydration
// ---------------------------------------------------------------------------

function specSnippet(specText: string | null): string {
  if (!specText) return "";
  const clean = specText.replace(/\s+/g, " ").trim();
  return clean.length > 120 ? `${clean.slice(0, 117)}…` : clean;
}

function toCandidate(
  row: MaterialRow,
  score: number,
  breakdown: ScoreBreakdown | null,
): EnrichCandidate {
  return {
    materialId: row.id,
    name: row.name,
    code: row.code,
    unit: row.unit,
    category: row.category,
    manufacturer: row.manufacturer,
    originCountry: row.originCountry,
    defaultUnitPrice: row.defaultUnitPrice,
    currency: row.currency,
    imageUrl: row.imageUrl,
    sourceUrl: row.sourceUrl,
    specSnippet: specSnippet(row.specText),
    score,
    breakdown,
  };
}

async function hydrateCandidates(
  db: AppDb,
  ids: number[],
): Promise<Map<number, MaterialRow>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select()
    .from(materials)
    .where(and(inArray(materials.id, ids), isNull(materials.deletedAt)));
  return new Map(rows.map((row) => [row.id, row]));
}

// ---------------------------------------------------------------------------
// Fill plan
// ---------------------------------------------------------------------------

function materialFieldValue(
  material: MaterialRow,
  field: FillableField,
): string {
  const value = material[field as keyof MaterialRow];
  if (value == null) return "";
  if (typeof value === "number") return String(value).trim();
  if (typeof value === "string") return value.trim();
  return "";
}

/** Project a material row onto the fillable-field string map the pure planner expects. */
function materialToFields(
  material: MaterialRow,
): Partial<Record<FillableField, string>> {
  const fields: Partial<Record<FillableField, string>> = {};
  for (const field of FILLABLE_FIELDS) {
    fields[field] = materialFieldValue(material, field);
  }
  return fields;
}

/**
 * Server wrapper over the canonical pure `buildFillPlan` in the lib. Maps the
 * DB row to the field-map shape the pure planner expects and delegates, so the
 * fill logic has exactly one implementation.
 */
export function buildFillPlan(
  rowFields: Partial<Record<FillableField, string>>,
  material: MaterialRow | null,
  forceOverwrite = new Set<FillableField>(),
): FillPlanCell[] {
  return buildFillPlanPure(
    rowFields,
    material ? materialToFields(material) : null,
    forceOverwrite,
  );
}

// ---------------------------------------------------------------------------
// Match all rows
// ---------------------------------------------------------------------------

function classify(score: number | undefined): EnrichStatus {
  return classifyStatus(score);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]!, index);
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

export async function matchRows(
  db: AppDb,
  rows: Array<EnrichRowInput & { name?: string }>,
  opts: { minSimilarity?: number; limit?: number } = {},
): Promise<EnrichRowResult[]> {
  const minSimilarity = opts.minSimilarity ?? 0.1;
  const limit = opts.limit ?? 8;

  const rawResults = await mapWithConcurrency(
    rows,
    MATCH_CONCURRENCY,
    async (row) => {
      const product = rowToScrapedProduct({ ...row.fields, name: row.name });
      if (!product.name) {
        return {
          originalRowIndex: row.originalRowIndex,
          candidateIds: [] as number[],
          scored: [] as Array<{ id: number; score: number; breakdown: ScoreBreakdown }>,
        };
      }
      const candidates = await findFuzzyCandidates(
        db,
        product,
        minSimilarity,
        limit,
      );
      return {
        originalRowIndex: row.originalRowIndex,
        candidateIds: candidates.map((c) => c.materialId),
        scored: candidates.map((c) => ({
          id: c.materialId,
          score: c.score,
          breakdown: c.breakdown,
        })),
      };
    },
  );

  const allIds = Array.from(
    new Set(rawResults.flatMap((r) => r.candidateIds)),
  );
  const hydrated = await hydrateCandidates(db, allIds);

  return rawResults.map((raw, i) => {
    const row = rows[i]!;
    const candidates: EnrichCandidate[] = raw.scored
      .map((s) => {
        const material = hydrated.get(s.id);
        return material ? toCandidate(material, s.score, s.breakdown) : null;
      })
      .filter((c): c is EnrichCandidate => c !== null);

    const top = candidates[0] ?? null;
    const status = classify(top?.score);
    const matchedMaterial =
      status !== "unmatched" && top ? (hydrated.get(top.materialId) ?? null) : null;

    return {
      originalRowIndex: row.originalRowIndex,
      status,
      topCandidate: top,
      candidates,
      fillPlan: buildFillPlan(row.fields, matchedMaterial),
    };
  });
}

// ---------------------------------------------------------------------------
// Workbook writing
// ---------------------------------------------------------------------------

export type ExportDecision = {
  originalRowIndex: number;
  materialId: number | null;
  /** Accepted fills, keyed to fillable fields the user kept ticked. */
  fields: FillableField[];
  /**
   * Fields to write even when the target cell already has a value (write-through).
   * Fields not listed here keep the fill-blanks-only behavior. Defined here as
   * the server contract; the catalog UI sends this under the same name.
   */
  overwriteFields?: FillableField[];
  /**
   * Per-field user-typed values that take precedence over the matched material's
   * value (inline edits). Lets a row write a value not present on any catalog
   * material — including web-research rows that never matched a material
   * (`materialId == null`), so long as the override covers the accepted field.
   */
  valueOverrides?: Partial<Record<FillableField, string>>;
};

export type ExportMode = "preserve" | "clean";

function decodeBase64(workbookBase64: string): Buffer {
  const base64 = workbookBase64.includes(",")
    ? workbookBase64.split(",").pop()!
    : workbookBase64;
  return Buffer.from(base64, "base64");
}

/** Test-only re-export of the internal base64 decoder. */
export const decodeBase64ForTest = decodeBase64;

function columnKeyForField(field: FillableField): ColumnKey | null {
  return FIELD_TO_COLUMN_KEY[field];
}

export type WriteWorkbookOptions = {
  workbookBase64: string;
  sheetName: string;
  mapping: ColumnMapping;
  headerRowIndex: number;
  decisions: ExportDecision[];
  materialsById: Map<number, MaterialRow>;
  mode: ExportMode;
};

/**
 * Build the enriched workbook. In "preserve" mode the original file is loaded
 * and filled values are written into the existing data rows. In "clean" mode a
 * fresh workbook with the canonical column order is emitted.
 */
export async function writeEnrichedWorkbook(
  opts: WriteWorkbookOptions,
): Promise<Buffer> {
  return opts.mode === "clean"
    ? writeCleanWorkbook(opts)
    : writePreservedWorkbook(opts);
}

/**
 * "preserve" mode: load the original file and write filled values into the
 * existing data rows, matched by originalRowIndex. Columns that the material
 * fills but the sheet lacked are appended at the right.
 */
async function writePreservedWorkbook(
  opts: WriteWorkbookOptions,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    decodeBase64(opts.workbookBase64) as unknown as Parameters<
      typeof workbook.xlsx.load
    >[0],
  );

  const sheet =
    workbook.getWorksheet(opts.sheetName) ?? workbook.worksheets[0];
  if (!sheet) {
    throw new Error("Không tìm thấy trang tính để ghi dữ liệu.");
  }

  // Resolve header text → column number for mapped columns.
  const headerRow = sheet.getRow(opts.headerRowIndex);
  const headerColumnByText = new Map<string, number>();
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const text = cellToText(cell.value);
    if (text) headerColumnByText.set(text, colNumber);
  });

  // For fields whose mapped column is missing, append a new column.
  let nextColumn = sheet.columnCount + 1;
  const columnForField = new Map<FillableField, number>();

  for (const field of FILLABLE_FIELDS) {
    const columnKey = columnKeyForField(field);
    if (columnKey == null) continue; // e.g. currency: not written as its own column
    const mappedHeader = opts.mapping[columnKey];
    if (mappedHeader && headerColumnByText.has(mappedHeader)) {
      columnForField.set(field, headerColumnByText.get(mappedHeader)!);
    }
  }

  const decisionByRow = new Map<number, ExportDecision>();
  for (const decision of opts.decisions) {
    decisionByRow.set(decision.originalRowIndex, decision);
  }

  const ensureColumnForField = (field: FillableField): number => {
    const existing = columnForField.get(field);
    if (existing != null) return existing;
    const colNumber = nextColumn++;
    const headerCell = headerRow.getCell(colNumber);
    headerCell.value = FIELD_LABELS[field];
    columnForField.set(field, colNumber);
    return colNumber;
  };

  for (const [rowIndex, decision] of decisionByRow) {
    if (decision.fields.length === 0) continue;
    // A catalog match supplies values for un-edited fields; web-only rows carry
    // all their values in `valueOverrides` and have no material.
    const material =
      decision.materialId == null
        ? undefined
        : opts.materialsById.get(decision.materialId);
    if (decision.materialId != null && !material) continue;

    const overwriteFields = new Set(decision.overwriteFields ?? []);
    const row = sheet.getRow(rowIndex);
    for (const field of decision.fields) {
      if (columnKeyForField(field) == null) continue; // currency has no column
      const value = resolveCellValue(material, field, decision.valueOverrides);
      if (value == null || value === "") continue;
      const colNumber = ensureColumnForField(field);
      const targetCell = row.getCell(colNumber);
      // Preserve mode keeps the sheet as the source of truth: blank cells are
      // filled. A cell that already has a value is only replaced when its field
      // was explicitly force-overwritten in this decision; otherwise sheet wins.
      if (
        cellToText(targetCell.value).length > 0 &&
        !overwriteFields.has(field)
      ) {
        continue;
      }
      targetCell.value = value;
    }
    row.commit();
  }
  headerRow.commit();

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}

/**
 * "clean" mode: emit a fresh workbook in canonical column order. For each
 * decision row, write the matched material's values across all fillable
 * fields. Rows without a match are skipped (clean export is a catalog dump of
 * the matched products, one row per decision that has a material).
 */
const CLEAN_COLUMN_ORDER: FillableField[] = [
  "code",
  "unit",
  "category",
  "specText",
  "manufacturer",
  "originCountry",
  "defaultUnitPrice",
  "currency",
  "sourceUrl",
];

async function writeCleanWorkbook(
  opts: WriteWorkbookOptions,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(opts.sheetName || "Enriched");

  sheet.addRow([
    "Tên vật tư",
    ...CLEAN_COLUMN_ORDER.map((field) => FIELD_LABELS[field]),
  ]);

  for (const decision of opts.decisions) {
    if (decision.fields.length === 0) continue;
    const material =
      decision.materialId == null
        ? undefined
        : opts.materialsById.get(decision.materialId);
    if (decision.materialId != null && !material) continue;

    sheet.addRow([
      material?.name ?? "",
      ...CLEAN_COLUMN_ORDER.map(
        (field) => resolveCellValue(material, field, decision.valueOverrides) ?? "",
      ),
    ]);
  }

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}

function materialCellValue(
  material: MaterialRow,
  field: FillableField,
): string | number | null {
  const raw = material[field as keyof MaterialRow];
  if (raw == null) return null;
  if (NUMERIC_FIELDS.has(field)) {
    const num = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(num) ? num : null;
  }
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") return raw;
  return null;
}

/**
 * Resolve the value to write for a field: a user inline-edit override wins over
 * the matched material's value. Numeric fields are coerced to numbers so Excel
 * formats them. `material` may be undefined for web-only rows that carry their
 * values entirely in `valueOverrides`.
 */
function resolveCellValue(
  material: MaterialRow | undefined,
  field: FillableField,
  valueOverrides: Partial<Record<FillableField, string>> | undefined,
): string | number | null {
  const override = valueOverrides?.[field];
  if (override != null && override.trim().length > 0) {
    if (NUMERIC_FIELDS.has(field)) {
      const num = Number(override.replace(/[^\d.-]/g, ""));
      return Number.isFinite(num) ? num : null;
    }
    return override;
  }
  return material ? materialCellValue(material, field) : null;
}

function cellToText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const record = value as unknown as Record<string, unknown>;
    if (typeof record.text === "string") return cellToText(record.text);
    if ("result" in record) return cellToText(record.result as ExcelJS.CellValue);
    if (Array.isArray(record.richText)) {
      return record.richText
        .map((part) =>
          typeof part === "object" && part !== null
            ? cellToText((part as { text?: unknown }).text as ExcelJS.CellValue)
            : "",
        )
        .join("")
        .replace(/\s+/g, " ")
        .trim();
    }
  }
  return "";
}

/**
 * Resolve the row field map for a sheet given its mapping, keyed by the
 * fillable field set. The product name lives under the reserved `name` key.
 */
export function extractRowFields(
  sheet: ParsedWorkbookSheet,
  mapping: ColumnMapping,
): Array<EnrichRowInput & { name: string }> {
  const nameColumn = mapping.materialName;
  if (!nameColumn) {
    throw new Error("Cần chọn cột tên vật tư để đối chiếu.");
  }

  const getColumn = (key: ColumnKey): string | null => mapping[key] ?? null;

  return sheet.rows
    .map((row) => {
      const valueOf = (key: ColumnKey): string => {
        const column = getColumn(key);
        return column ? (row.values[column] ?? "") : "";
      };

      const fields: Partial<Record<FillableField, string>> = {};
      for (const field of FILLABLE_FIELDS) {
        const columnKey = columnKeyForField(field);
        if (columnKey == null) continue; // currency has no source column
        fields[field] = valueOf(columnKey);
      }

      return {
        originalRowIndex: row.originalRowIndex,
        name: (row.values[nameColumn] ?? "").trim(),
        fields,
      };
    })
    .filter((row) => row.name.length > 0);
}

export { columnKeys };
