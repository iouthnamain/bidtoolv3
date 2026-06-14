import ExcelJS from "exceljs";
import { inArray } from "drizzle-orm";

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

type AppDb = typeof appDb;
type MaterialRow = typeof materials.$inferSelect;

// ---------------------------------------------------------------------------
// Field model
// ---------------------------------------------------------------------------

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

/** Maps a fillable material field to the Excel column key used for mapping. */
export const FIELD_TO_COLUMN_KEY: Record<FillableField, ColumnKey> = {
  code: "code",
  unit: "unit",
  category: "category",
  specText: "specText",
  manufacturer: "vendorHint",
  originCountry: "originHint",
  defaultUnitPrice: "unitPrice",
  currency: "unit", // currency has no dedicated column; never auto-filled into a column
  sourceUrl: "sourceUrl",
};

const NUMERIC_FIELDS = new Set<FillableField>(["defaultUnitPrice"]);

// ---------------------------------------------------------------------------
// Thresholds (single tunable block)
// ---------------------------------------------------------------------------

export const ENRICH_THRESHOLDS = {
  auto: 0.85,
  review: 0.5,
} as const;

export const MAX_ENRICH_ROWS = 2000;
export const MATCH_CONCURRENCY = 10;

export type EnrichStatus = "auto" | "review" | "unmatched";

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

export type FillAction = "filled" | "kept" | "missing-both" | "overwritten";

export type FillPlanCell = {
  field: FillableField;
  before: string;
  after: string;
  action: FillAction;
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
    .where(inArray(materials.id, ids));
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

export function buildFillPlan(
  rowFields: Partial<Record<FillableField, string>>,
  material: MaterialRow | null,
  forceOverwrite = new Set<FillableField>(),
): FillPlanCell[] {
  const plan: FillPlanCell[] = [];

  for (const field of FILLABLE_FIELDS) {
    const sheetRaw = rowFields[field]?.trim() ?? "";
    const materialRaw = material ? materialFieldValue(material, field) : "";

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

    // Only surface fields that have something interesting to show.
    if (action === "missing-both") continue;

    plan.push({ field, before: sheetRaw, after, action });
  }

  return plan;
}

// ---------------------------------------------------------------------------
// Match all rows
// ---------------------------------------------------------------------------

function classify(score: number | undefined): EnrichStatus {
  if (score != null && score >= ENRICH_THRESHOLDS.auto) return "auto";
  if (score != null && score >= ENRICH_THRESHOLDS.review) return "review";
  return "unmatched";
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
};

export type ExportMode = "preserve" | "clean";

function decodeBase64(workbookBase64: string): Buffer {
  const base64 = workbookBase64.includes(",")
    ? workbookBase64.split(",").pop()!
    : workbookBase64;
  return Buffer.from(base64, "base64");
}

function columnKeyForField(field: FillableField): ColumnKey {
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
    if (field === "currency") continue; // not written as its own column
    const mappedHeader = opts.mapping[columnKeyForField(field)];
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
    headerCell.value = APPENDED_HEADER_LABEL[field];
    columnForField.set(field, colNumber);
    return colNumber;
  };

  for (const [rowIndex, decision] of decisionByRow) {
    if (decision.materialId == null || decision.fields.length === 0) continue;
    const material = opts.materialsById.get(decision.materialId);
    if (!material) continue;

    const row = sheet.getRow(rowIndex);
    for (const field of decision.fields) {
      if (field === "currency") continue;
      const value = materialCellValue(material, field);
      if (value == null || value === "") continue;
      const colNumber = ensureColumnForField(field);
      // Preserve mode never destroys existing data: only fill cells that are
      // currently blank. The review UI offers fills only for blank fields, but
      // we guard here too so the sheet stays the source of truth.
      const targetCell = row.getCell(colNumber);
      if (cellToText(targetCell.value).length > 0) continue;
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
    ...CLEAN_COLUMN_ORDER.map((field) => APPENDED_HEADER_LABEL[field]),
  ]);

  for (const decision of opts.decisions) {
    if (decision.materialId == null) continue;
    const material = opts.materialsById.get(decision.materialId);
    if (!material) continue;

    sheet.addRow([
      material.name,
      ...CLEAN_COLUMN_ORDER.map((field) => materialCellValue(material, field) ?? ""),
    ]);
  }

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}

const APPENDED_HEADER_LABEL: Record<FillableField, string> = {
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
        if (field === "currency") continue;
        fields[field] = valueOf(columnKeyForField(field));
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
