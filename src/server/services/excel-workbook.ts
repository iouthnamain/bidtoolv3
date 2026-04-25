import * as XLSX from "xlsx";

import type { ExtractedProductSpec } from "~/server/services/product-web-search";

export const columnKeys = [
  "productName",
  "specText",
  "unit",
  "quantity",
  "targetPrice",
  "currency",
  "vendorHint",
  "originHint",
  "notes",
] as const;

export type ColumnKey = (typeof columnKeys)[number];
export type ColumnMapping = Partial<Record<ColumnKey, string | null>>;

export type ParsedWorkbookSheet = {
  name: string;
  headerRowIndex: number;
  headers: string[];
  rows: Array<{
    originalRowIndex: number;
    values: Record<string, string>;
  }>;
  previewRows: Array<Record<string, string>>;
  suggestedMapping: ColumnMapping;
};

export type ParsedWorkbook = {
  sheets: ParsedWorkbookSheet[];
};

export type ImportedWorkbookRow = {
  originalRowIndex: number;
  originalDataJson: Record<string, string>;
  productName: string;
  specText: string;
  unit: string;
  quantity: number | null;
  targetPrice: number | null;
  currency: string;
  vendorHint: string | null;
  originHint: string | null;
  notes: string;
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

const REQUIRED_PRODUCT_KEY: ColumnKey = "productName";

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

function normalizeToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
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
  return "";
}

function parseOptionalNumber(value: string): number | null {
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

function detectHeaderIndex(rows: unknown[][]): number {
  const index = rows.findIndex((row) => row.filter(Boolean).length >= 2);
  return index >= 0 ? index : 0;
}

function matchHeader(headers: string[], keywords: string[]): string | null {
  const normalized = headers.map((header) => ({
    raw: header,
    normalized: normalizeToken(header),
  }));

  const exact = normalized.find((header) =>
    keywords.some((keyword) => header.normalized === normalizeToken(keyword)),
  );
  if (exact) {
    return exact.raw;
  }

  return (
    normalized.find((header) =>
      keywords.some((keyword) =>
        header.normalized.includes(normalizeToken(keyword)),
      ),
    )?.raw ?? null
  );
}

export function suggestColumnMapping(headers: string[]): ColumnMapping {
  return {
    productName: matchHeader(headers, [
      "product",
      "product name",
      "item",
      "item name",
      "name",
      "ten hang",
      "ten san pham",
      "hang hoa",
      "vat tu",
    ]),
    specText: matchHeader(headers, [
      "description",
      "desc",
      "spec",
      "specification",
      "quy cach",
      "thong so",
      "mo ta",
    ]),
    unit: matchHeader(headers, ["unit", "uom", "don vi", "dvt"]),
    quantity: matchHeader(headers, ["qty", "quantity", "so luong", "sl"]),
    targetPrice: matchHeader(headers, [
      "price",
      "target price",
      "budget",
      "don gia",
      "gia",
    ]),
    currency: matchHeader(headers, ["currency", "tien te"]),
    vendorHint: matchHeader(headers, ["vendor", "supplier", "nha cung cap"]),
    originHint: matchHeader(headers, ["origin", "xuat xu"]),
    notes: matchHeader(headers, ["note", "notes", "ghi chu"]),
  };
}

export function parseWorkbookBase64(
  fileName: string,
  workbookBase64: string,
): ParsedWorkbook {
  const base64 = workbookBase64.includes(",")
    ? workbookBase64.split(",").pop()!
    : workbookBase64;
  const workbook = XLSX.read(Buffer.from(base64, "base64"), {
    type: "buffer",
    cellDates: false,
  });

  const sheets = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet!, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    });
    const headerRowIndex = detectHeaderIndex(matrix);
    const headers = uniqueHeaders(matrix[headerRowIndex] ?? []);
    const rows = matrix
      .slice(headerRowIndex + 1)
      .map((row, index) => ({
        originalRowIndex: headerRowIndex + index + 2,
        values: headers.reduce<Record<string, string>>((record, header, i) => {
          record[header] = cleanCell(row[i]);
          return record;
        }, {}),
      }))
      .filter((row) => rowHasData(Object.values(row.values)));

    return {
      name,
      headerRowIndex: headerRowIndex + 1,
      headers,
      rows,
      previewRows: rows.slice(0, 20).map((row) => row.values),
      suggestedMapping: suggestColumnMapping(headers),
    };
  });

  if (sheets.length === 0) {
    throw new Error(`No readable sheets found in ${fileName}.`);
  }

  return { sheets };
}

export function rowsFromMapping(
  sheet: ParsedWorkbookSheet,
  mapping: ColumnMapping,
): ImportedWorkbookRow[] {
  const productColumn = mapping[REQUIRED_PRODUCT_KEY];
  if (!productColumn) {
    throw new Error("Product name column is required.");
  }

  return sheet.rows
    .map((row) => {
      const get = (key: ColumnKey) => {
        const column = mapping[key];
        return column ? (row.values[column] ?? "") : "";
      };
      const productName = get("productName");
      const specText = get("specText");
      const unit = get("unit");
      const vendorHint = get("vendorHint");
      const originHint = get("originHint");
      const notes = get("notes");
      const currency = get("currency") || "VND";

      return {
        originalRowIndex: row.originalRowIndex,
        originalDataJson: row.values,
        productName,
        specText,
        unit,
        quantity: parseOptionalNumber(get("quantity")),
        targetPrice: parseOptionalNumber(get("targetPrice")),
        currency,
        vendorHint: vendorHint || null,
        originHint: originHint || null,
        notes,
        searchKeywords: [productName, specText, unit]
          .join(" ")
          .split(/[,;/\n]/)
          .map((value) => value.trim())
          .filter(Boolean),
      };
    })
    .filter((row) => row.productName.trim().length > 0);
}

export function buildEnrichedWorkbookBase64(rows: ExportRowInput[]): string {
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

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(outputRows);
  XLSX.utils.book_append_sheet(workbook, sheet, "enriched");
  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as
    | Buffer
    | Uint8Array;
  return Buffer.from(buffer).toString("base64");
}
