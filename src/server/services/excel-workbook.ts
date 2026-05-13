import ExcelJS from "exceljs";

import {
  standardColumnKeys,
  type StandardColumnKey,
  type StandardColumnMapping,
  type WorkspaceTerm,
} from "~/lib/excel-workspace-standard";
import type { ExtractedProductSpec } from "~/server/services/product-web-search";

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_COLS = 80;
const HEADER_SCAN_ROWS = 40;

export const columnKeys = standardColumnKeys;
export type ColumnKey = StandardColumnKey;
export type ColumnMapping = StandardColumnMapping;

export type ParsedWorkbookRow = {
  originalRowIndex: number;
  values: Record<string, string>;
};

export type ParsedWorkbookSheet = {
  name: string;
  detectedHeaderRowIndex: number;
  activeHeaderRowIndex: number;
  headerRowIndex: number;
  rawRows: string[][];
  headers: string[];
  rows: ParsedWorkbookRow[];
  previewRows: Array<Record<string, string>>;
  suggestedMapping: StandardColumnMapping;
  warnings: string[];
};

export type ParsedWorkbook = {
  sheets: ParsedWorkbookSheet[];
  warnings: string[];
};

export type ImportedWorkbookRow = {
  originalRowIndex: number;
  originalDataJson: Record<string, string>;
  productName: string;
  materialName: string;
  specText: string;
  unit: string;
  term: WorkspaceTerm;
  quantity: number | null;
  targetPrice: number | null;
  currency: string;
  vendorHint: string | null;
  originHint: string | null;
  notes: string;
  qtyTotal: number | null;
  qtyInStock: number | null;
  depreciation: number;
  reusePct: number;
  inspectionQtyTerm1: number | null;
  inspectionQtyTerm2: number | null;
  unitPrice: number | null;
  sourceUrl: string | null;
  searchKeywords: string[];
};

type ExportRowInput = {
  originalDataJson: Record<string, unknown>;
  enrichedSnapshotJson: Record<string, unknown>;
  matchStatus: "unmatched" | "candidates_found" | "matched" | "manual";
  selectedCandidate?: {
    confidenceScore: number;
    provider: string;
    rawEvidence: string;
  } | null;
};

const REQUIRED_PRODUCT_KEY: StandardColumnKey = "materialName";

const aliases: Record<StandardColumnKey, string[]> = {
  materialName: [
    "product",
    "product name",
    "item",
    "item name",
    "name",
    "ten",
    "ten hang",
    "ten san pham",
    "ten vat tu",
    "ten qui cach vat tu",
    "ten quy cach vat tu",
    "hang hoa",
    "vat tu",
  ],
  specText: [
    "description",
    "desc",
    "spec",
    "specification",
    "quy cach",
    "qui cach",
    "thong so",
    "thong so ky thuat",
    "thong so ki thuat",
    "mo ta",
  ],
  unit: ["unit", "uom", "don vi", "don vi tinh", "dvt"],
  term: ["term", "hoc ky", "hocky", "semester", "ky"],
  qtyTotal: [
    "qty",
    "quantity",
    "so luong",
    "sl",
    "so luong tong hop",
    "tong hop",
    "so luong can mua",
  ],
  qtyInStock: [
    "ton",
    "ton kho",
    "con ton",
    "so luong con ton",
    "sl ton",
    "inventory",
    "stock",
  ],
  depreciation: ["khau hao", "depreciation"],
  reusePct: ["su dung lai", "% su dung lai", "reuse", "reuse pct"],
  inspectionQtyTerm1: [
    "kiem tra ky i",
    "kiem tra hoc ky i",
    "bb ky i",
    "sl kiem tra ky i",
    "inspection term 1",
  ],
  inspectionQtyTerm2: [
    "kiem tra ky ii",
    "kiem tra hoc ky ii",
    "bb ky ii",
    "sl kiem tra ky ii",
    "inspection term 2",
  ],
  unitPrice: [
    "price",
    "target price",
    "budget",
    "don gia",
    "gia",
    "don gia goc",
    "don gia da giam",
  ],
  vendorHint: [
    "vendor",
    "supplier",
    "nha cung cap",
    "nha san xuat",
    "manufacturer",
  ],
  originHint: ["origin", "xuat xu", "nuoc san xuat"],
  sourceUrl: ["link", "url", "source", "nguon", "link sp"],
  notes: ["note", "notes", "ghi chu", "luu y"],
};

function normalizeHeader(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value).replace(/\s+/g, " ").trim();
  }
  if (value instanceof Date) {
    return value.toISOString().replace(/\s+/g, " ").trim();
  }
  return "";
}

export function normalizeToken(value: string): string {
  return value
    .replace(/[đĐ]/g, (match) => (match === "Đ" ? "D" : "d"))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanCell(value: unknown): string {
  if (value == null) {
    return "";
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value).replace(/\s+/g, " ").trim();
  }
  if (value instanceof Date) {
    return value.toISOString().replace(/\s+/g, " ").trim();
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") {
      return cleanCell(record.text);
    }
    if ("result" in record) {
      return cleanCell(record.result);
    }
    if (Array.isArray(record.richText)) {
      return record.richText
        .map((part) =>
          typeof part === "object" && part !== null
            ? cleanCell((part as { text?: unknown }).text)
            : "",
        )
        .join("")
        .replace(/\s+/g, " ")
        .trim();
    }
  }
  return "";
}

export function parseOptionalNumber(value: string): number | null {
  const cleaned = value.replace(/[^\d,.-]/g, "").replace(/,/g, "");
  if (!cleaned) {
    return null;
  }

  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function uniqueHeaders(values: unknown[]): string[] {
  const seen = new Map<string, number>();
  return values.map((value, index) => {
    const base = normalizeHeader(value) || `Column ${index + 1}`;
    const current = seen.get(base) ?? 0;
    seen.set(base, current + 1);
    return current === 0 ? base : `${base} (${current + 1})`;
  });
}

function rowHasData(row: unknown[]): boolean {
  return row.some((cell) => cleanCell(cell).length > 0);
}

function matchHeader(headers: string[], keywords: string[]): string | null {
  const normalized = headers.map((header) => ({
    raw: header,
    normalized: normalizeToken(header),
  }));

  const normalizedKeywords = keywords.map(normalizeToken);
  const exact = normalized.find((header) =>
    normalizedKeywords.some((keyword) => header.normalized === keyword),
  );
  if (exact) {
    return exact.raw;
  }

  return (
    normalized.find((header) =>
      normalizedKeywords.some((keyword) => header.normalized.includes(keyword)),
    )?.raw ?? null
  );
}

function headerScore(row: unknown[]): number {
  const headers = uniqueHeaders(row);
  const mapping = suggestColumnMapping(headers);
  const mappedCount = Object.values(mapping).filter(Boolean).length;
  const hasName = mapping.materialName ? 4 : 0;
  const hasUnit = mapping.unit ? 2 : 0;
  const hasQty = mapping.qtyTotal ? 2 : 0;
  const nonEmpty = row.filter((cell) => cleanCell(cell).length > 0).length;
  return mappedCount * 5 + hasName + hasUnit + hasQty + Math.min(nonEmpty, 8);
}

export function detectHeaderIndex(rows: unknown[][]): number {
  let bestIndex = 0;
  let bestScore = -1;

  rows.slice(0, HEADER_SCAN_ROWS).forEach((row, index) => {
    const score = headerScore(row);
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  });

  if (bestScore <= 0) {
    const fallback = rows.findIndex((row) => row.filter(Boolean).length >= 2);
    return fallback >= 0 ? fallback : 0;
  }

  return bestIndex;
}

export function suggestColumnMapping(headers: string[]): StandardColumnMapping {
  return Object.fromEntries(
    standardColumnKeys.map((key) => [key, matchHeader(headers, aliases[key])]),
  ) as StandardColumnMapping;
}

function buildSheetFromMatrix(input: {
  name: string;
  matrix: string[][];
  detectedHeaderIndex: number;
  activeHeaderIndex?: number;
  warnings?: string[];
}): ParsedWorkbookSheet {
  const activeHeaderIndex = Math.max(
    0,
    Math.min(
      input.activeHeaderIndex ?? input.detectedHeaderIndex,
      input.matrix.length - 1,
    ),
  );
  const headers = uniqueHeaders(input.matrix[activeHeaderIndex] ?? []);
  const rows = input.matrix
    .slice(activeHeaderIndex + 1)
    .map((row, index) => ({
      originalRowIndex: activeHeaderIndex + index + 2,
      values: headers.reduce<Record<string, string>>((record, header, i) => {
        record[header] = cleanCell(row[i]);
        return record;
      }, {}),
    }))
    .filter((row) => rowHasData(Object.values(row.values)));

  return {
    name: input.name,
    detectedHeaderRowIndex: input.detectedHeaderIndex + 1,
    activeHeaderRowIndex: activeHeaderIndex + 1,
    headerRowIndex: activeHeaderIndex + 1,
    rawRows: input.matrix,
    headers,
    rows,
    previewRows: rows.slice(0, 20).map((row) => row.values),
    suggestedMapping: suggestColumnMapping(headers),
    warnings: input.warnings ?? [],
  };
}

export function rebuildSheetWithHeaderRow(
  sheet: ParsedWorkbookSheet,
  headerRowIndex: number,
): ParsedWorkbookSheet {
  return buildSheetFromMatrix({
    name: sheet.name,
    matrix: sheet.rawRows,
    detectedHeaderIndex: Math.max(0, sheet.detectedHeaderRowIndex - 1),
    activeHeaderIndex: Math.max(0, headerRowIndex - 1),
    warnings: sheet.warnings,
  });
}

function excelWorksheetToMatrix(sheet: ExcelJS.Worksheet): string[][] {
  const rowLimit = Math.min(sheet.rowCount, MAX_IMPORT_ROWS);
  const matrix: string[][] = [];

  for (let rowNumber = 1; rowNumber <= rowLimit; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const values: string[] = [];
    for (let colNumber = 1; colNumber <= MAX_IMPORT_COLS; colNumber += 1) {
      const cell = row.getCell(colNumber);
      if (cell.isMerged && cell.master.address !== cell.address) {
        values.push("");
      } else {
        values.push(cleanCell(cell.value));
      }
    }
    while (values.length > 0 && values[values.length - 1] === "") {
      values.pop();
    }
    matrix.push(values);
  }

  return matrix;
}

export async function parseWorkbookBase64(
  fileName: string,
  workbookBase64: string,
): Promise<ParsedWorkbook> {
  if (!/\.xlsx$/i.test(fileName)) {
    throw new Error(
      "Chỉ hỗ trợ tệp .xlsx. Hãy chuyển tệp .xls cũ sang .xlsx trước khi nhập.",
    );
  }

  const base64 = workbookBase64.includes(",")
    ? workbookBase64.split(",").pop()!
    : workbookBase64;
  const workbook = new ExcelJS.Workbook();
  const workbookBuffer = Buffer.from(base64, "base64");
  await workbook.xlsx.load(
    workbookBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  const workbookWarnings: string[] = [];

  const sheets = workbook.worksheets.map((sheet) => {
    const warnings: string[] = [];
    if (sheet.rowCount > MAX_IMPORT_ROWS) {
      warnings.push(
        `Trang tính ${sheet.name} có hơn ${MAX_IMPORT_ROWS.toLocaleString("vi-VN")} dòng; chỉ đọc ${MAX_IMPORT_ROWS.toLocaleString("vi-VN")} dòng đầu.`,
      );
    }
    if (sheet.columnCount > MAX_IMPORT_COLS) {
      warnings.push(
        `Trang tính ${sheet.name} có hơn ${MAX_IMPORT_COLS} cột; chỉ đọc ${MAX_IMPORT_COLS} cột đầu.`,
      );
    }

    const matrix = excelWorksheetToMatrix(sheet);
    const detectedHeaderIndex = detectHeaderIndex(matrix);
    return buildSheetFromMatrix({
      name: sheet.name,
      matrix,
      detectedHeaderIndex,
      warnings: Array.from(new Set(warnings)),
    });
  });

  if (sheets.length === 0) {
    throw new Error(`No readable sheets found in ${fileName}.`);
  }

  for (const sheet of sheets) {
    workbookWarnings.push(...sheet.warnings);
  }

  return { sheets, warnings: Array.from(new Set(workbookWarnings)) };
}

function normalizeTerm(value: string): WorkspaceTerm {
  const normalized = normalizeToken(value);
  if (
    normalized.includes("ii") ||
    normalized.includes("2") ||
    normalized.includes("term 2") ||
    normalized.includes("hk2")
  ) {
    return "term_2";
  }
  return "term_1";
}

export function rowsFromMapping(
  sheet: ParsedWorkbookSheet,
  mapping: StandardColumnMapping,
): ImportedWorkbookRow[] {
  const productColumn = mapping[REQUIRED_PRODUCT_KEY];
  if (!productColumn) {
    throw new Error("Material name column is required.");
  }

  return sheet.rows
    .map((row) => {
      const get = (key: StandardColumnKey) => {
        const column = mapping[key];
        return column ? (row.values[column] ?? "") : "";
      };
      const materialName = get("materialName");
      const specText = get("specText");
      const unit = get("unit");
      const vendorHint = get("vendorHint");
      const originHint = get("originHint");
      const notes = get("notes");
      const qtyTotal = parseOptionalNumber(get("qtyTotal"));
      const unitPrice = parseOptionalNumber(get("unitPrice"));

      return {
        originalRowIndex: row.originalRowIndex,
        originalDataJson: row.values,
        productName: materialName,
        materialName,
        specText,
        unit,
        term: normalizeTerm(get("term")),
        quantity: qtyTotal,
        targetPrice: unitPrice,
        currency: "VND",
        vendorHint: vendorHint || null,
        originHint: originHint || null,
        notes,
        qtyTotal,
        qtyInStock: parseOptionalNumber(get("qtyInStock")) ?? 0,
        depreciation: parseOptionalNumber(get("depreciation")) ?? 1,
        reusePct: parseOptionalNumber(get("reusePct")) ?? 0,
        inspectionQtyTerm1: parseOptionalNumber(get("inspectionQtyTerm1")),
        inspectionQtyTerm2: parseOptionalNumber(get("inspectionQtyTerm2")),
        unitPrice,
        sourceUrl: get("sourceUrl") || null,
        searchKeywords: [materialName, specText, unit]
          .join(" ")
          .split(/[,;/\n]/)
          .map((value) => value.trim())
          .filter(Boolean),
      };
    })
    .filter((row) => {
      if (row.productName.trim().length === 0) {
        return false;
      }

      const hasMappedText = [
        row.unit,
        row.specText,
        row.vendorHint ?? "",
        row.originHint ?? "",
        row.notes,
        row.sourceUrl ?? "",
      ].some((value) => value.trim().length > 0);

      return hasMappedText || row.qtyTotal != null || row.unitPrice != null;
    });
}

export async function buildEnrichedWorkbookBase64(
  rows: ExportRowInput[],
): Promise<string> {
  const outputRows = rows.map((row) => {
    const spec = row.enrichedSnapshotJson as Partial<ExtractedProductSpec>;
    return {
      ...row.originalDataJson,
      matched_product_name: spec.productName ?? "",
      matched_brand: spec.brand ?? "",
      matched_model: spec.model ?? "",
      matched_spec: spec.specSummary ?? "",
      matched_price: spec.priceText ?? spec.priceVnd ?? "",
      matched_currency: "VND",
      matched_origin: spec.originCountry ?? "",
      matched_vendor: spec.vendorName ?? spec.vendorDomain ?? "",
      matched_source_url: spec.sourceUrl ?? "",
      match_confidence: row.selectedCandidate?.confidenceScore ?? "",
      match_method: row.matchStatus,
      evidence: spec.evidenceText ?? row.selectedCandidate?.rawEvidence ?? "",
    };
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("enriched");
  const headers = Array.from(
    outputRows.reduce<Set<string>>((keys, row) => {
      Object.keys(row).forEach((key) => keys.add(key));
      return keys;
    }, new Set<string>()),
  );
  sheet.columns = headers.map((header) => ({
    header,
    key: header,
  }));
  sheet.addRows(outputRows);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer).toString("base64");
}
