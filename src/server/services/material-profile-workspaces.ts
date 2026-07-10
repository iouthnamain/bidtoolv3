import ExcelJS from "exceljs";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";

import { catalogPdfFileNameFromUrl } from "~/lib/materials/catalog-pdf";
import {
  deriveMatchStatus,
  deserializeRowDecision,
  seedDecisionFromItem,
  type SerializedRowDecision,
  serializeRowDecision,
  type WebSearchStatus,
} from "~/lib/materials/review-decision";
import { isExportableDecision } from "~/lib/materials/enrich-gap-fill";
import {
  CLEAN_MATERIAL_PROFILE_EXPORT_HEADERS,
  createMaterialProfileSourceFingerprint,
  toMaterialProfileCleanExportRow,
  validateMaterialProfileInput,
  validateMaterialProfileResolution,
  type MaterialProfileResolution,
} from "~/lib/materials/profile-input-contract";
import type { FillableField } from "~/lib/materials/excel-enrich-fields";
import {
  snapshotStatusFromItem,
  topCandidateMaterialIdFromItem,
  type WorkspaceItemForReview,
} from "~/lib/materials/workspace-review-row";
import type {
  ColumnMapping,
  ParsedWorkbookSheet,
} from "~/server/services/excel-workbook";
import { matchRows } from "~/server/services/excel-enrich";
import {
  parseWorkbookBase64,
  parseOptionalNumber,
  rebuildSheetWithHeaderRow,
} from "~/server/services/excel-workbook";
import {
  downloadCatalogPdfFromUrl,
  readCatalogPdfFile,
  sanitizeCatalogPdfFileName,
} from "~/server/services/catalog-pdf-storage";
import { runWithConcurrency } from "~/server/services/concurrency";
import { enrichRowFromWeb } from "~/server/services/enrich-web-row";
import { resolveMaterialProfileExportDir } from "~/server/services/app-settings";
import type { db as appDb } from "~/server/db";
import {
  excelWorkspaceItems,
  excelWorkspaces,
  materialProfileSearchJobs,
  materialProfileSearchRuns,
  materialCatalogDocumentLinks,
  materialCatalogDocuments,
  materials,
} from "~/server/db/schema";
import type { MaterialProfileSearchRunSnapshot } from "~/server/services/material-profile-search-jobs";

type AppDb = typeof appDb;
type Workspace = typeof excelWorkspaces.$inferSelect;
type WorkspaceItem = typeof excelWorkspaceItems.$inferSelect;
type MaterialProfileSearchRunRow =
  typeof materialProfileSearchRuns.$inferSelect;
type MaterialRow = typeof materials.$inferSelect;
type CatalogDocumentRow = typeof materialCatalogDocuments.$inferSelect;

export type MaterialProfileCellEdits = Record<string, Record<string, string>>;

export type MaterialProfileExportEditState = {
  cellEdits: MaterialProfileCellEdits;
  deletedRows: Record<string, number[]>;
  deletedColumns: Record<string, number[]>;
  updatedAt?: string;
};

export type MaterialProfileBulkApplySnapshot = {
  workspaceId: number;
  createdAt: string;
  itemIds: number[];
  previousItems: Array<{
    itemId: number;
    materialId: number | null;
    matchStatus: WorkspaceItem["matchStatus"];
    includedInExport: boolean;
    reviewDecisionJson: unknown;
  }>;
  summary: {
    selectedCount: number;
    appliedCount: number;
    reviewCount: number;
    unchangedCount: number;
  };
};

export type MaterialProfileReviewReadiness = {
  totalRows: number;
  resolvedRows: number;
  exportableRows: number;
  skippedRows: number;
  unresolvedRows: number;
  canExportWithWarnings: boolean;
  warnings: string[];
};

function searchStatus(value: string): WebSearchStatus {
  if (
    value === "idle" ||
    value === "pending" ||
    value === "done" ||
    value === "error"
  ) {
    return value;
  }
  return "idle";
}

function materialProfileSearchRunSnapshot(
  row: MaterialProfileSearchRunRow,
): MaterialProfileSearchRunSnapshot {
  const parsed = deserializeRowDecision({
    materialId: null,
    acceptedFields: [],
    webLinkResults: row.webLinkResultsJson,
    webLinksStatus: row.webLinksStatus,
    aiSearchCandidates: row.aiSearchCandidatesJson,
    aiSearchStatus: row.aiSearchStatus,
    selectedSearchCandidateKey: row.recommendedCandidateKey ?? undefined,
    selectedSource:
      row.recommendedCandidateKey?.startsWith("ai:") === true
        ? "ai"
        : undefined,
  });

  return {
    id: row.id,
    jobId: row.jobId,
    workspaceId: row.workspaceId,
    itemId: row.itemId,
    originalRowIndex: row.originalRowIndex,
    sortOrder: row.sortOrder,
    mode: row.mode === "ai" || row.mode === "auto" ? row.mode : "web",
    status:
      row.status === "queued" ||
      row.status === "running" ||
      row.status === "completed" ||
      row.status === "partial" ||
      row.status === "failed" ||
      row.status === "skipped" ||
      row.status === "cancelled"
        ? row.status
        : "failed",
    isCurrent: row.isCurrent,
    sourceWebRunId: row.sourceWebRunId,
    inputSnapshot:
      row.inputSnapshotJson && typeof row.inputSnapshotJson === "object"
        ? row.inputSnapshotJson
        : {},
    queries: Array.isArray(row.queriesJson)
      ? row.queriesJson.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    webLinksStatus: searchStatus(row.webLinksStatus),
    aiSearchStatus: searchStatus(row.aiSearchStatus),
    webLinkResults: parsed?.webLinkResults ?? [],
    aiSearchCandidates: parsed?.aiSearchCandidates ?? [],
    recommendedCandidateKey: row.recommendedCandidateKey,
    warnings: Array.isArray(row.warningsJson)
      ? row.warningsJson.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    errorMessage: row.errorMessage,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function reviewDecisionJsonWithCurrentSearchRun(
  reviewDecisionJson: unknown,
  run: MaterialProfileSearchRunSnapshot | null,
) {
  if (!run) return reviewDecisionJson;
  const base =
    reviewDecisionJson && typeof reviewDecisionJson === "object"
      ? { ...(reviewDecisionJson as Record<string, unknown>) }
      : {};
  const aiSearchResult = run.aiSearchCandidates[0];

  return {
    ...base,
    webLinkResults: run.webLinkResults,
    webLinksStatus: run.webLinksStatus,
    aiSearchCandidates: run.aiSearchCandidates,
    aiSearchResult,
    aiSearchStatus: run.aiSearchStatus,
    selectedSearchCandidateKey:
      typeof base.selectedSearchCandidateKey === "string"
        ? base.selectedSearchCandidateKey
        : (run.recommendedCandidateKey ?? undefined),
    catalogPdfUrls:
      base.catalogPdfUrls ?? aiSearchResult?.catalogPdfUrls ?? undefined,
  };
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstMaterialProfileText(...values: Array<string | null | undefined>) {
  return values.map((value) => value?.trim() ?? "").find(Boolean) ?? "";
}

/**
 * Fill only canonical blanks from a result that already passed the strict
 * profile gate. This prevents the clean profile export from displaying a
 * generated/input-derived value that `/materials` itself does not retain.
 */
export function buildMaterialProfileCanonicalBackfillPatch(input: {
  material: Pick<
    MaterialRow,
    | "code"
    | "name"
    | "unit"
    | "category"
    | "specText"
    | "manufacturer"
    | "originCountry"
    | "defaultUnitPrice"
    | "currency"
    | "sourceUrl"
    | "metadataJson"
  >;
  resolution: Pick<MaterialProfileResolution, "candidate">;
  category?: string | null;
  resolvedAt: string;
}) {
  const candidate = input.resolution.candidate;
  const currentMetadata = jsonRecord(input.material.metadataJson);
  const currentProfile = jsonRecord(currentMetadata.materialProfile);
  return {
    code: firstMaterialProfileText(input.material.code, candidate.code) || null,
    name: firstMaterialProfileText(input.material.name, candidate.name),
    unit: firstMaterialProfileText(input.material.unit, candidate.unit),
    category:
      firstMaterialProfileText(input.material.category, input.category) || null,
    specText: firstMaterialProfileText(
      input.material.specText,
      candidate.specText,
    ),
    manufacturer:
      firstMaterialProfileText(
        input.material.manufacturer,
        candidate.manufacturer,
      ) || null,
    originCountry:
      firstMaterialProfileText(
        input.material.originCountry,
        candidate.originCountry,
      ) || null,
    defaultUnitPrice:
      input.material.defaultUnitPrice ?? candidate.unitPrice ?? null,
    currency: firstMaterialProfileText(input.material.currency, "VND"),
    sourceUrl:
      firstMaterialProfileText(input.material.sourceUrl, candidate.sourceUrl) ||
      null,
    metadataJson: {
      ...currentMetadata,
      materialProfile: {
        ...currentProfile,
        confidence: candidate.confidence,
        source: candidate.source,
        sourceUrl: candidate.sourceUrl,
        catalogUrl: candidate.catalogUrl,
        provenance:
          candidate.provenance ?? currentProfile.provenance ?? "catalog",
        codeProvenance:
          candidate.codeProvenance ?? currentProfile.codeProvenance ?? null,
        resolvedAt: input.resolvedAt,
      },
    },
  };
}

function serializeMaterialProfileUserDecision(decision: SerializedRowDecision) {
  const restored = deserializeRowDecision(decision);
  if (!restored) return decision;
  const serialized = serializeRowDecision(restored);
  return {
    ...serialized,
    webLinkResults: undefined,
    webLinksStatus: undefined,
    aiSearchResult: undefined,
    aiSearchCandidates: undefined,
    aiSearchStatus: undefined,
  };
}

export function summarizeMaterialProfileReviewReadiness(
  items: Array<{
    id: number;
    originalRowIndex: number;
    materialId: number | null;
    matchStatus: WorkspaceItem["matchStatus"];
    reviewDecisionJson: unknown;
    enrichedSnapshotJson: unknown;
  }>,
): MaterialProfileReviewReadiness {
  let exportableRows = 0;
  let skippedRows = 0;

  for (const item of items) {
    const decision = seedDecisionFromItem(item);
    if (decision.skipped) {
      skippedRows += 1;
      continue;
    }
    if (isExportableDecision(decision)) {
      exportableRows += 1;
    }
  }

  const totalRows = items.length;
  const resolvedRows = exportableRows + skippedRows;
  const unresolvedRows = Math.max(0, totalRows - resolvedRows);
  const warnings =
    unresolvedRows > 0
      ? [
          `Còn ${unresolvedRows.toLocaleString("vi-VN")} dòng chưa chọn hoặc bỏ qua. File export có thể thiếu dữ liệu.`,
        ]
      : [];

  return {
    totalRows,
    resolvedRows,
    exportableRows,
    skippedRows,
    unresolvedRows,
    canExportWithWarnings: true,
    warnings,
  };
}

export const MATERIAL_PROFILE_EXPORT_COLUMNS = [
  { key: "matchStatus", header: "BT - Match status" },
  { key: "name", header: "BT - Tên vật tư" },
  { key: "code", header: "BT - Mã VT" },
  { key: "unit", header: "BT - ĐVT" },
  { key: "category", header: "BT - Nhóm" },
  { key: "specText", header: "BT - Thông số" },
  { key: "manufacturer", header: "BT - NCC" },
  { key: "originCountry", header: "BT - Xuất xứ" },
  { key: "defaultUnitPrice", header: "BT - Đơn giá" },
  { key: "currency", header: "BT - Tiền tệ" },
  { key: "sourceUrl", header: "BT - Nguồn" },
  { key: "catalogFiles", header: "BT - Catalog files" },
] as const;

export class MaterialProfileWorkspaceError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "BAD_REQUEST" | "CONFLICT",
    message: string,
  ) {
    super(message);
  }
}

function decodeBase64(value: string) {
  const base64 = value.includes(",") ? (value.split(",").pop() ?? "") : value;
  const buffer = Buffer.from(base64, "base64");
  if (buffer.byteLength === 0) {
    throw new MaterialProfileWorkspaceError(
      "BAD_REQUEST",
      "Không đọc được dữ liệu tệp Excel.",
    );
  }
  return buffer;
}

function bufferToBase64(buffer: Buffer) {
  return buffer.toString("base64");
}

function safePathSegment(value: string, fallback: string) {
  const cleaned = value
    .replace(/[^\p{L}\p{N}._\- ]+/gu, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 120);
  return cleaned || fallback;
}

export function sanitizeMaterialProfilePathSegment(
  value: string,
  fallback: string,
) {
  return safePathSegment(value, fallback);
}

function sanitizeWorkbookFileName(fileName: string) {
  const safe = safePathSegment(path.basename(fileName), "workbook.xlsx");
  return /\.xlsx$/i.test(safe) ? safe : `${safe}.xlsx`;
}

export function sanitizeMaterialProfileWorkbookFileName(fileName: string) {
  return sanitizeWorkbookFileName(fileName);
}

function timestampLabel(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
}

export function buildMaterialProfileOutputPrefix(
  noticeNumber: string,
  date = new Date(),
) {
  return `${safePathSegment(noticeNumber, "material-profile")}_${timestampLabel(date)}`;
}

function isServerlessEnvironment() {
  return (
    process.env.VERCEL === "1" || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME)
  );
}

export function resolveMaterialProfileStorageRoot(
  configured: string | null | undefined,
  options: { serverless?: boolean } = {},
) {
  const trimmed = configured?.trim();
  if (trimmed && trimmed.length > 0) {
    return path.resolve(trimmed);
  }
  if (options.serverless ?? isServerlessEnvironment()) {
    return path.join(tmpdir(), "bidtool", "material-profiles");
  }
  return path.join(process.cwd(), "data", "material-profiles");
}

async function materialProfileRoot() {
  const configured = await resolveMaterialProfileExportDir();
  return resolveMaterialProfileStorageRoot(configured);
}

function workbookJsonFromSheets(
  sheets: ParsedWorkbookSheet[],
  sourceWorkbookBase64?: string,
) {
  return {
    ...(sourceWorkbookBase64 ? { sourceWorkbookBase64 } : {}),
    sheets: sheets.map((sheet) => ({
      name: sheet.name,
      detectedHeaderRowIndex: sheet.detectedHeaderRowIndex,
      activeHeaderRowIndex: sheet.activeHeaderRowIndex,
      headerRowIndex: sheet.headerRowIndex,
      rowCount: sheet.rows.length,
      headers: sheet.headers,
      rawRows: sheet.rawRows,
      suggestedMapping: sheet.suggestedMapping,
      warnings: sheet.warnings,
      previewRows: sheet.previewRows.slice(0, 20),
    })),
  };
}

function parseWorkbookJson(value: Record<string, unknown>) {
  const sheets = Array.isArray(value.sheets) ? value.sheets : [];
  return {
    sheets: sheets
      .map((sheet) => {
        if (!sheet || typeof sheet !== "object") {
          return null;
        }
        const record = sheet as Record<string, unknown>;
        return {
          name: typeof record.name === "string" ? record.name : "",
          detectedHeaderRowIndex: Number(record.detectedHeaderRowIndex ?? 1),
          activeHeaderRowIndex: Number(record.activeHeaderRowIndex ?? 1),
          rowCount: Number(record.rowCount ?? 0),
          headers: Array.isArray(record.headers)
            ? record.headers.map(String)
            : [],
          rawRows: Array.isArray(record.rawRows)
            ? (record.rawRows as unknown[][]).map((row) => row.map(String))
            : [],
          suggestedMapping:
            record.suggestedMapping &&
            typeof record.suggestedMapping === "object"
              ? (record.suggestedMapping as ColumnMapping)
              : {},
          warnings: Array.isArray(record.warnings)
            ? record.warnings.map(String)
            : [],
          previewRows: Array.isArray(record.previewRows)
            ? (record.previewRows as Array<Record<string, string>>)
            : [],
        };
      })
      .filter((sheet): sheet is NonNullable<typeof sheet> =>
        Boolean(sheet?.name),
      ),
  };
}

function uniquePositiveIntegers(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0),
    ),
  ).sort((a, b) => a - b);
}

function parseSheetNumberMap(value: unknown) {
  if (!value || typeof value !== "object") return {};
  const parsed: Record<string, number[]> = {};
  for (const [sheetName, numbers] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const values = uniquePositiveIntegers(numbers);
    if (sheetName && values.length > 0) {
      parsed[sheetName] = values;
    }
  }
  return parsed;
}

function parseCellEdits(value: unknown): MaterialProfileCellEdits {
  if (!value || typeof value !== "object") return {};
  const edits: MaterialProfileCellEdits = {};
  for (const [sheetName, sheetEdits] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (!sheetName || !sheetEdits || typeof sheetEdits !== "object") continue;
    const cleanSheetEdits: Record<string, string> = {};
    for (const [key, cellValue] of Object.entries(
      sheetEdits as Record<string, unknown>,
    )) {
      if (/^\d+:\d+$/.test(key)) {
        cleanSheetEdits[key] =
          typeof cellValue === "string" ||
          typeof cellValue === "number" ||
          typeof cellValue === "boolean"
            ? String(cellValue)
            : "";
      }
    }
    if (Object.keys(cleanSheetEdits).length > 0) {
      edits[sheetName] = cleanSheetEdits;
    }
  }
  return edits;
}

export function parseMaterialProfileExportEditState(
  value: Record<string, unknown> | null | undefined,
): MaterialProfileExportEditState {
  const record = value && typeof value === "object" ? value : {};
  return {
    cellEdits: parseCellEdits(record.cellEdits),
    deletedRows: parseSheetNumberMap(record.deletedRows),
    deletedColumns: parseSheetNumberMap(record.deletedColumns),
    updatedAt:
      typeof record.updatedAt === "string" ? record.updatedAt : undefined,
  };
}

function materialProfileExportEditStateJson(
  state: MaterialProfileExportEditState,
) {
  return {
    cellEdits: state.cellEdits,
    deletedRows: state.deletedRows,
    deletedColumns: state.deletedColumns,
    updatedAt: state.updatedAt,
  };
}

export function summarizeMaterialProfileExportEditState(
  state: MaterialProfileExportEditState,
  materialSheetName?: string,
) {
  const editedCellCount = Object.values(state.cellEdits).reduce(
    (sum, sheetEdits) => sum + Object.keys(sheetEdits).length,
    0,
  );
  const deletedRowCount = Object.values(state.deletedRows).reduce(
    (sum, rows) => sum + rows.length,
    0,
  );
  const deletedColumnCount = Object.values(state.deletedColumns).reduce(
    (sum, columns) => sum + columns.length,
    0,
  );
  return {
    editedCellCount,
    deletedRowCount,
    deletedColumnCount,
    deletedMaterialRowCount: materialSheetName
      ? (state.deletedRows[materialSheetName]?.length ?? 0)
      : 0,
  };
}

export function isMaterialProfileExportRowDeleted(
  sheetName: string,
  rowNumber: number,
  state: MaterialProfileExportEditState,
) {
  return (state.deletedRows[sheetName] ?? []).includes(rowNumber);
}

export function shouldBulkApplyMaterialProfileCandidate(
  score: unknown,
  threshold = 0.85,
) {
  return typeof score === "number" && score >= threshold;
}

function cloneSheetWithEdits(
  sheet: ParsedWorkbookSheet,
  edits: MaterialProfileCellEdits,
): ParsedWorkbookSheet {
  const rawRows = sheet.rawRows.map((row) => [...row]);
  const sheetEdits = edits[sheet.name] ?? {};
  for (const [key, value] of Object.entries(sheetEdits)) {
    const [rowPart, colPart] = key.split(":");
    const rowIndex = Number(rowPart) - 1;
    const colIndex = Number(colPart) - 1;
    if (
      Number.isInteger(rowIndex) &&
      Number.isInteger(colIndex) &&
      rowIndex >= 0 &&
      colIndex >= 0
    ) {
      const targetRow = rawRows[rowIndex] ?? [];
      targetRow[colIndex] = value;
      rawRows[rowIndex] = targetRow;
    }
  }
  return { ...sheet, rawRows };
}

function applyCellEdits(
  workbook: ExcelJS.Workbook,
  edits: MaterialProfileCellEdits,
  maxColumnBySheet?: Map<string, number>,
) {
  for (const [sheetName, sheetEdits] of Object.entries(edits)) {
    const sheet = workbook.getWorksheet(sheetName);
    if (!sheet) continue;
    const maxColumn = maxColumnBySheet?.get(sheetName);
    for (const [key, value] of Object.entries(sheetEdits)) {
      const [rowPart, colPart] = key.split(":");
      const rowNumber = Number(rowPart);
      const colNumber = Number(colPart);
      if (
        !Number.isInteger(rowNumber) ||
        !Number.isInteger(colNumber) ||
        rowNumber < 1 ||
        colNumber < 1
      ) {
        continue;
      }
      if (maxColumn != null && colNumber > maxColumn) {
        continue;
      }
      const cell = sheet.getRow(rowNumber).getCell(colNumber);
      const existing = cell.value;
      const numeric = Number(value.replace(/[,\s]/g, ""));
      cell.value =
        typeof existing === "number" && Number.isFinite(numeric)
          ? numeric
          : value;
    }
  }
}

function cellToPreviewText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const record = value as unknown as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if ("result" in record)
      return cellToPreviewText(record.result as ExcelJS.CellValue);
    if (Array.isArray(record.richText)) {
      return record.richText
        .map((part) => {
          if (typeof part !== "object" || part === null) return "";
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        })
        .join("");
    }
  }
  return "";
}

function editValueForCell(
  edits: MaterialProfileCellEdits,
  sheetName: string,
  rowNumber: number,
  colNumber: number,
) {
  return edits[sheetName]?.[`${rowNumber}:${colNumber}`];
}

function filterPreviewRowsAndColumns(
  rows: string[][],
  sheetName: string,
  state: MaterialProfileExportEditState,
) {
  const deletedRows = new Set(state.deletedRows[sheetName] ?? []);
  const deletedColumns = new Set(state.deletedColumns[sheetName] ?? []);
  const columnNumbers =
    rows[0]?.map((_, colIndex) => colIndex + 1) ??
    Array.from({ length: Math.max(...rows.map((row) => row.length), 0) }).map(
      (_, colIndex) => colIndex + 1,
    );
  const visibleColumnNumbers = columnNumbers.filter(
    (colNumber) => !deletedColumns.has(colNumber),
  );
  const visibleRows: string[][] = [];
  const rowNumbers: number[] = [];
  rows.forEach((row, rowIndex) => {
    const rowNumber = rowIndex + 1;
    if (deletedRows.has(rowNumber)) return;
    rowNumbers.push(rowNumber);
    visibleRows.push(
      visibleColumnNumbers.map((colNumber) => row[colNumber - 1] ?? ""),
    );
  });
  return {
    rows: visibleRows,
    rowNumbers,
    columnNumbers: visibleColumnNumbers,
  };
}

function isMaterialRowDeleted(
  item: WorkspaceItem,
  materialSheetName: string,
  state: MaterialProfileExportEditState,
) {
  return isMaterialProfileExportRowDeleted(
    materialSheetName,
    item.originalRowIndex,
    state,
  );
}

function materialValue(
  material: MaterialRow | undefined,
  key: (typeof MATERIAL_PROFILE_EXPORT_COLUMNS)[number]["key"],
  item: WorkspaceItem,
  catalogFiles: string[],
) {
  switch (key) {
    case "matchStatus":
      return item.matchStatus;
    case "name":
      return material?.name ?? item.productName;
    case "code":
      return material?.code ?? "";
    case "unit":
      return material?.unit ?? item.unit;
    case "category":
      return material?.category ?? "";
    case "specText":
      return material?.specText ?? item.specText;
    case "manufacturer":
      return material?.manufacturer ?? item.vendorHint ?? "";
    case "originCountry":
      return material?.originCountry ?? item.originHint ?? "";
    case "defaultUnitPrice":
      return material?.defaultUnitPrice ?? item.unitPrice ?? "";
    case "currency":
      return material?.currency ?? item.currency;
    case "sourceUrl":
      return material?.sourceUrl ?? "";
    case "catalogFiles":
      return catalogFiles.join("\n");
  }
}

function topCandidateFromSnapshot(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const candidates = (snapshot as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) return null;
  return (
    candidates
      .map((candidate) =>
        candidate && typeof candidate === "object"
          ? (candidate as { materialId?: unknown; score?: unknown })
          : null,
      )
      .filter(
        (candidate): candidate is { materialId: number; score?: unknown } =>
          typeof candidate?.materialId === "number",
      )
      .sort(
        (a, b) =>
          (typeof b.score === "number" ? b.score : 0) -
          (typeof a.score === "number" ? a.score : 0),
      )[0] ?? null
  );
}

function parseLastBulkApplySnapshot(
  value: Record<string, unknown>,
): MaterialProfileBulkApplySnapshot | null {
  const snapshot = value.materialProfileLastBulkApply;
  if (!snapshot || typeof snapshot !== "object") return null;
  const record = snapshot as Record<string, unknown>;
  if (typeof record.workspaceId !== "number") return null;
  if (!Array.isArray(record.previousItems)) return null;
  const previousItems = record.previousItems
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const itemRecord = item as Record<string, unknown>;
      const matchStatus = itemRecord.matchStatus;
      if (
        !["unmatched", "candidates_found", "matched", "manual"].includes(
          String(matchStatus),
        )
      ) {
        return null;
      }
      return {
        itemId: Number(itemRecord.itemId),
        materialId:
          itemRecord.materialId == null ? null : Number(itemRecord.materialId),
        matchStatus: matchStatus as WorkspaceItem["matchStatus"],
        includedInExport: Boolean(itemRecord.includedInExport),
        reviewDecisionJson:
          "reviewDecisionJson" in itemRecord
            ? itemRecord.reviewDecisionJson
            : {},
      };
    })
    .filter(
      (
        item,
      ): item is MaterialProfileBulkApplySnapshot["previousItems"][number] =>
        item !== null &&
        Number.isInteger(item.itemId) &&
        (item.materialId == null || Number.isInteger(item.materialId)),
    );
  if (previousItems.length === 0) return null;
  const summaryRecord =
    record.summary && typeof record.summary === "object"
      ? (record.summary as Record<string, unknown>)
      : {};
  return {
    workspaceId: record.workspaceId,
    createdAt:
      typeof record.createdAt === "string"
        ? record.createdAt
        : new Date().toISOString(),
    itemIds: Array.isArray(record.itemIds)
      ? record.itemIds.map(Number).filter((item) => Number.isInteger(item))
      : previousItems.map((item) => item.itemId),
    previousItems,
    summary: {
      selectedCount: Number(
        summaryRecord.selectedCount ?? previousItems.length,
      ),
      appliedCount: Number(summaryRecord.appliedCount ?? 0),
      reviewCount: Number(summaryRecord.reviewCount ?? 0),
      unchangedCount: Number(summaryRecord.unchangedCount ?? 0),
    },
  };
}

async function requireWorkspace(db: AppDb, workspaceId: number) {
  const [workspace] = await db
    .select()
    .from(excelWorkspaces)
    .where(eq(excelWorkspaces.id, workspaceId))
    .limit(1);
  if (!workspace) {
    throw new MaterialProfileWorkspaceError(
      "NOT_FOUND",
      "Không tìm thấy hồ sơ vật tư.",
    );
  }
  return workspace;
}

/**
 * A new upload or re-map changes row identity. Cancel active row-search jobs
 * first so their old snapshots cannot later be presented as current results.
 * The worker also rechecks this durable status immediately before promotion.
 */
async function invalidateActiveMaterialProfileSearchJobs(
  db: AppDb,
  workspaceId: number,
  message = "Dữ liệu nguồn đã thay đổi; đã hủy job tìm kiếm cũ.",
) {
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx
      .update(materialProfileSearchJobs)
      .set({
        status: "cancelled",
        currentItemId: null,
        currentRowIndex: null,
        currentProductName: null,
        message,
        finishedAt: now,
        lastProgressAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(materialProfileSearchJobs.workspaceId, workspaceId),
          inArray(materialProfileSearchJobs.status, ["queued", "running"]),
        ),
      );
    await tx
      .update(materialProfileSearchRuns)
      .set({
        status: "cancelled",
        errorMessage: message,
        finishedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(materialProfileSearchRuns.workspaceId, workspaceId),
          inArray(materialProfileSearchRuns.status, ["queued", "running"]),
        ),
      );
  });
}

async function sourceWorkbookPathReadable(filePath: string) {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveWorkspaceWorkbookBuffer(workspace: {
  sourceWorkbookPath?: string | null;
  workbookJson?: Record<string, unknown> | null;
}) {
  if (
    workspace.sourceWorkbookPath &&
    (await sourceWorkbookPathReadable(workspace.sourceWorkbookPath))
  ) {
    return readFile(workspace.sourceWorkbookPath);
  }

  const record =
    workspace.workbookJson && typeof workspace.workbookJson === "object"
      ? workspace.workbookJson
      : null;
  const base64 =
    record && typeof record.sourceWorkbookBase64 === "string"
      ? record.sourceWorkbookBase64
      : null;
  if (base64) {
    return decodeBase64(base64);
  }

  throw new MaterialProfileWorkspaceError(
    "BAD_REQUEST",
    "Chưa upload file Excel cho work này.",
  );
}

async function readWorkspaceWorkbook(workspace: Workspace) {
  return resolveWorkspaceWorkbookBuffer(workspace);
}

function selectParsedSheet(
  sheets: ParsedWorkbookSheet[],
  sheetName: string | null | undefined,
) {
  return sheets.find((sheet) => sheet.name === sheetName) ?? sheets[0] ?? null;
}

async function parseWorkspaceWorkbook(workspace: Workspace) {
  const buffer = await readWorkspaceWorkbook(workspace);
  return parseWorkbookBase64(
    workspace.sourceFileName ?? "workbook.xlsx",
    bufferToBase64(buffer),
  );
}

export async function createMaterialProfileWorkspace(
  db: AppDb,
  input: { name?: string; noticeNumber?: string },
) {
  const noticeNumber = input.noticeNumber?.trim() ?? "";
  const requestedName = input.name?.trim() ?? "";
  const name = requestedName
    ? requestedName
    : noticeNumber
      ? noticeNumber
      : `Hồ sơ vật tư ${new Date().toLocaleDateString("vi-VN")}`;
  const now = new Date().toISOString();
  const [workspace] = await db
    .insert(excelWorkspaces)
    .values({
      name,
      noticeNumber,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!workspace) {
    throw new MaterialProfileWorkspaceError(
      "BAD_REQUEST",
      "Không tạo được hồ sơ vật tư.",
    );
  }
  return workspace;
}

export async function listMaterialProfileWorkspaces(
  db: AppDb,
  input: { limit?: number; offset?: number } = {},
) {
  return db
    .select()
    .from(excelWorkspaces)
    .orderBy(desc(excelWorkspaces.updatedAt))
    .limit(input.limit ?? 50)
    .offset(input.offset ?? 0);
}

export async function updateMaterialProfileWorkspace(
  db: AppDb,
  input: { workspaceId: number; name?: string; noticeNumber?: string | null },
) {
  const workspace = await requireWorkspace(db, input.workspaceId);
  const noticeNumber = input.noticeNumber?.trim() ?? "";
  const requestedName = input.name?.trim() ?? "";
  const name = requestedName.length > 0 ? requestedName : workspace.name;
  const [updated] = await db
    .update(excelWorkspaces)
    .set({
      name,
      noticeNumber,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(excelWorkspaces.id, input.workspaceId))
    .returning();
  return updated ?? requireWorkspace(db, input.workspaceId);
}

export async function deleteMaterialProfileWorkspace(
  db: AppDb,
  workspaceId: number,
) {
  const workspace = await requireWorkspace(db, workspaceId);
  await db.delete(excelWorkspaces).where(eq(excelWorkspaces.id, workspace.id));
  return { id: workspace.id };
}

export async function getMaterialProfileWorkspace(
  db: AppDb,
  workspaceId: number,
) {
  const workspace = await requireWorkspace(db, workspaceId);
  const items = await db
    .select()
    .from(excelWorkspaceItems)
    .where(eq(excelWorkspaceItems.workspaceId, workspaceId))
    .orderBy(excelWorkspaceItems.sortOrder);
  const currentRuns = await db
    .select()
    .from(materialProfileSearchRuns)
    .where(
      and(
        eq(materialProfileSearchRuns.workspaceId, workspaceId),
        eq(materialProfileSearchRuns.isCurrent, true),
      ),
    );
  const currentRunByItemId = new Map(
    currentRuns.map((run) => [
      run.itemId,
      materialProfileSearchRunSnapshot(run),
    ]),
  );
  const materialIds = materialIdsFromItems(items);
  const materialRows = await loadMaterialRows(db, materialIds);
  const materialsById = new Map(materialRows.map((row) => [row.id, row]));
  const docsByMaterial = await catalogDocumentsByMaterial(db, materialIds);
  const itemsWithCurrentSearch = items.map((item) => {
    const currentSearchRun = currentRunByItemId.get(item.id) ?? null;
    const material =
      item.materialId == null ? undefined : materialsById.get(item.materialId);
    const profileResolution = materialProfileResolutionForItem(
      item,
      material,
      item.materialId == null
        ? []
        : (docsByMaterial.get(item.materialId) ?? []),
    ).resolution;
    return {
      ...item,
      currentSearchRun,
      profileResolution,
      reviewDecisionJson: reviewDecisionJsonWithCurrentSearchRun(
        item.reviewDecisionJson,
        currentSearchRun,
      ),
    };
  });
  return {
    workspace,
    items: itemsWithCurrentSearch,
    workbook: parseWorkbookJson(workspace.workbookJson),
    reviewReadiness: summarizeMaterialProfileReviewReadiness(
      itemsWithCurrentSearch,
    ),
  };
}

export async function uploadMaterialProfileWorkbook(
  db: AppDb,
  input: { workspaceId: number; fileName: string; workbookBase64: string },
) {
  const workspace = await requireWorkspace(db, input.workspaceId);
  await invalidateActiveMaterialProfileSearchJobs(db, workspace.id);
  const buffer = decodeBase64(input.workbookBase64);
  const parsed = await parseWorkbookBase64(
    input.fileName,
    bufferToBase64(buffer),
  );
  const selectedSheet = parsed.sheets[0];
  if (!selectedSheet) {
    throw new MaterialProfileWorkspaceError(
      "BAD_REQUEST",
      "Không tìm thấy sheet hợp lệ trong file Excel.",
    );
  }

  const sourceWorkbookBase64 = bufferToBase64(buffer);
  const safeFileName = sanitizeWorkbookFileName(input.fileName);
  let sourceWorkbookPath: string | null = null;
  try {
    const root = await materialProfileRoot();
    const noticeSegment = safePathSegment(
      workspace.noticeNumber ?? workspace.name,
      `workspace-${workspace.id}`,
    );
    const sourceDir = path.join(
      root,
      noticeSegment,
      String(workspace.id),
      "source",
    );
    await mkdir(sourceDir, { recursive: true });
    sourceWorkbookPath = path.join(sourceDir, safeFileName);
    await writeFile(sourceWorkbookPath, buffer);
  } catch {
    // Best-effort disk cache; serverless filesystems may be read-only.
  }

  const now = new Date().toISOString();
  const [updated] = await db
    .update(excelWorkspaces)
    .set({
      status: "imported",
      sourceFileName: safeFileName,
      sourceWorkbookPath,
      sourceSheetName: selectedSheet.name,
      rowCount: selectedSheet.rows.length,
      columnMappingJson: selectedSheet.suggestedMapping,
      workbookJson: workbookJsonFromSheets(parsed.sheets, sourceWorkbookBase64),
      editStateJson: {},
      exportEditStateJson: {},
      updatedAt: now,
    })
    .where(eq(excelWorkspaces.id, workspace.id))
    .returning();

  await db
    .delete(excelWorkspaceItems)
    .where(eq(excelWorkspaceItems.workspaceId, workspace.id));

  return updated ?? requireWorkspace(db, workspace.id);
}

export async function updateMaterialProfileWorkspaceState(
  db: AppDb,
  input: {
    workspaceId: number;
    sheetName?: string;
    headerRowIndex?: number;
    mapping?: ColumnMapping;
    editState?: MaterialProfileCellEdits;
  },
) {
  const workspace = await requireWorkspace(db, input.workspaceId);
  const workbook = parseWorkbookJson(workspace.workbookJson);
  const selected =
    workbook.sheets.find((sheet) => sheet.name === input.sheetName) ??
    workbook.sheets.find((sheet) => sheet.name === workspace.sourceSheetName) ??
    workbook.sheets[0];
  const mapping = input.mapping ?? workspace.columnMappingJson;
  const headerRowIndex =
    input.headerRowIndex ?? selected?.activeHeaderRowIndex ?? undefined;

  const existingWorkbookJson =
    workspace.workbookJson && typeof workspace.workbookJson === "object"
      ? workspace.workbookJson
      : {};
  const preservedBase64 =
    typeof existingWorkbookJson.sourceWorkbookBase64 === "string"
      ? existingWorkbookJson.sourceWorkbookBase64
      : undefined;

  const nextWorkbookJson = {
    ...(preservedBase64 ? { sourceWorkbookBase64: preservedBase64 } : {}),
    sheets: workbook.sheets.map((sheet) =>
      sheet.name === selected?.name && headerRowIndex
        ? { ...sheet, activeHeaderRowIndex: headerRowIndex }
        : sheet,
    ),
  };

  const [updated] = await db
    .update(excelWorkspaces)
    .set({
      sourceSheetName: selected?.name ?? workspace.sourceSheetName,
      columnMappingJson: mapping,
      workbookJson: nextWorkbookJson,
      editStateJson: input.editState ?? workspace.editStateJson,
      status: workspace.status === "draft" ? "imported" : workspace.status,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(excelWorkspaces.id, workspace.id))
    .returning();
  return updated ?? requireWorkspace(db, workspace.id);
}

export async function matchMaterialProfileWorkspace(
  db: AppDb,
  input: {
    workspaceId: number;
    sheetName?: string;
    headerRowIndex?: number;
    mapping?: ColumnMapping;
  },
) {
  await invalidateActiveMaterialProfileSearchJobs(db, input.workspaceId);
  const workspace = await updateMaterialProfileWorkspaceState(db, {
    workspaceId: input.workspaceId,
    sheetName: input.sheetName,
    headerRowIndex: input.headerRowIndex,
    mapping: input.mapping,
  });
  const parsed = await parseWorkspaceWorkbook(workspace);
  const baseSheet = selectParsedSheet(parsed.sheets, workspace.sourceSheetName);
  if (!baseSheet) {
    throw new MaterialProfileWorkspaceError(
      "BAD_REQUEST",
      "Không tìm thấy sheet vật tư để map.",
    );
  }
  const editedBase = cloneSheetWithEdits(baseSheet, workspace.editStateJson);
  const selectedMeta = parseWorkbookJson(workspace.workbookJson).sheets.find(
    (sheet) => sheet.name === baseSheet.name,
  );
  const sheet = rebuildSheetWithHeaderRow(
    editedBase,
    input.headerRowIndex ??
      selectedMeta?.activeHeaderRowIndex ??
      baseSheet.activeHeaderRowIndex,
  );
  const mapping = workspace.columnMappingJson;
  const requiredMappings: Array<[keyof ColumnMapping, string]> = [
    ["materialName", "Tên vật tư"],
    ["unit", "ĐVT"],
    ["specText", "Thông số kỹ thuật"],
  ];
  const missingMappings = requiredMappings.flatMap(([key, label]) =>
    mapping[key] ? [] : [label],
  );
  if (missingMappings.length > 0) {
    throw new MaterialProfileWorkspaceError(
      "BAD_REQUEST",
      `Cần ánh xạ cột ${missingMappings.join(", ")} trước khi tự xử lý.`,
    );
  }

  const rows = sheet.rows.map((row) => {
    const valueOf = (key: string) => {
      const column = mapping[key];
      return column ? (row.values[column] ?? "") : "";
    };
    const fields: Partial<Record<FillableField, string>> = {
      code: valueOf("code"),
      unit: valueOf("unit"),
      category: valueOf("category"),
      specText: valueOf("specText"),
      manufacturer: valueOf("vendorHint"),
      originCountry: valueOf("originHint"),
      defaultUnitPrice: valueOf("unitPrice"),
      currency: "VND",
      sourceUrl: valueOf("sourceUrl"),
    };
    const name = valueOf("materialName");
    const inputValidation = validateMaterialProfileInput({
      name,
      unit: fields.unit ?? "",
      specText: fields.specText ?? "",
      rowIndex: row.originalRowIndex,
      sourceValues: row.values,
    });
    return {
      originalRowIndex: row.originalRowIndex,
      name,
      fields,
      inputValidation,
      sourceFingerprint: createMaterialProfileSourceFingerprint({
        name,
        unit: fields.unit ?? "",
        specText: fields.specText ?? "",
        rowIndex: row.originalRowIndex,
      }),
    };
  });
  const validRows = rows
    .filter((row) => row.inputValidation.valid)
    .map((row) => ({
      originalRowIndex: row.originalRowIndex,
      name: row.name.trim(),
      fields: row.fields,
    }));
  const results = await matchRows(db, validRows);
  const resultByRowIndex = new Map(
    results.map((result) => [result.originalRowIndex, result]),
  );
  const existingItems = await db
    .select()
    .from(excelWorkspaceItems)
    .where(eq(excelWorkspaceItems.workspaceId, workspace.id));
  const materialIdsToVerify = Array.from(
    new Set(
      [
        ...results.map((result) => result.topCandidate?.materialId ?? null),
        ...existingItems.map((item) => item.materialId),
      ].filter((id): id is number => id != null),
    ),
  );
  const materialRowsToVerify = await loadMaterialRows(db, materialIdsToVerify);
  const materialsToVerifyById = new Map(
    materialRowsToVerify.map((material) => [material.id, material]),
  );
  const docsToVerifyByMaterial = await catalogDocumentsByMaterial(
    db,
    materialIdsToVerify,
  );
  const existingByFingerprint = new Map(
    existingItems.map((item) => [
      createMaterialProfileSourceFingerprint({
        name: item.productName,
        unit: item.unit,
        specText: item.specText,
        rowIndex: item.originalRowIndex,
      }),
      item,
    ]),
  );
  const now = new Date().toISOString();
  const seenItemIds = new Set<number>();
  await db.transaction(async (tx) => {
    for (const [index, source] of rows.entries()) {
      const existing = existingByFingerprint.get(source.sourceFingerprint);
      const result = resultByRowIndex.get(source.originalRowIndex);
      let localMaterial = result?.topCandidate
        ? materialsToVerifyById.get(result.topCandidate.materialId)
        : undefined;
      let localResolution = localMaterial
        ? materialProfileResolutionForItem(
            {
              productName:
                source.name.trim().length > 0
                  ? source.name.trim()
                  : `Dòng ${source.originalRowIndex}`,
              unit: source.fields.unit ?? "",
              specText: source.fields.specText ?? "",
              originalRowIndex: source.originalRowIndex,
              originalDataJson: source.fields,
              enrichedSnapshotJson: {
                score: result?.topCandidate?.score ?? null,
              },
              matchStatus: "matched",
            },
            localMaterial,
            docsToVerifyByMaterial.get(localMaterial.id) ?? [],
          ).resolution
        : null;
      if (
        result?.status === "auto" &&
        localMaterial &&
        localResolution?.promotable
      ) {
        const candidateCode = localResolution.candidate.code?.trim() ?? "";
        const [codeOwner] =
          !localMaterial.code?.trim() && candidateCode
            ? await tx
                .select({ id: materials.id })
                .from(materials)
                .where(
                  and(
                    eq(materials.code, candidateCode),
                    isNull(materials.deletedAt),
                    ne(materials.id, localMaterial.id),
                  ),
                )
                .limit(1)
            : [];
        if (codeOwner) {
          localResolution = {
            ...localResolution,
            promotable: false,
            status: "needs_verification",
            reasons: [
              ...localResolution.reasons,
              "Mã vật tư tự sinh đã thuộc về một vật tư khác; cần xác minh trước khi lưu.",
            ],
          };
        } else {
          const patch = buildMaterialProfileCanonicalBackfillPatch({
            material: localMaterial,
            resolution: localResolution,
            category: source.fields.category,
            resolvedAt: now,
          });
          const [saved] = await tx
            .update(materials)
            .set({ ...patch, updatedAt: now })
            .where(eq(materials.id, localMaterial.id))
            .returning();
          if (saved) {
            localMaterial = saved;
            materialsToVerifyById.set(saved.id, saved);
          }
        }
      }
      const autoMaterialId =
        result?.status === "auto" && localResolution?.promotable
          ? (localMaterial?.id ?? null)
          : null;
      const existingMaterial =
        existing?.materialId == null
          ? undefined
          : materialsToVerifyById.get(existing.materialId);
      const existingResolution =
        existing && existingMaterial
          ? materialProfileResolutionForItem(
              {
                ...existing,
                productName:
                  source.name.trim().length > 0
                    ? source.name.trim()
                    : `Dòng ${source.originalRowIndex}`,
                unit: source.fields.unit ?? "",
                specText: source.fields.specText ?? "",
                originalRowIndex: source.originalRowIndex,
                originalDataJson: source.fields,
              },
              existingMaterial,
              docsToVerifyByMaterial.get(existingMaterial.id) ?? [],
            ).resolution
          : null;
      const inferredMatchStatus = !source.inputValidation.valid
        ? ("unmatched" as const)
        : autoMaterialId != null
          ? ("matched" as const)
          : result?.status === "review" || result?.status === "auto"
            ? ("candidates_found" as const)
            : ("unmatched" as const);
      const preservedManualSelection =
        (existing?.matchStatus === "manual" || existing?.materialId != null) &&
        existingResolution?.promotable === true;
      const nextSnapshot = {
        ...jsonRecord(existing?.enrichedSnapshotJson),
        stale: false,
        sourceFingerprint: source.sourceFingerprint,
        inputValidation: source.inputValidation,
        status: source.inputValidation.valid
          ? autoMaterialId != null
            ? "auto"
            : result?.status === "auto"
              ? "review"
              : (result?.status ?? "unmatched")
          : "unmatched",
        score: result?.topCandidate?.score ?? null,
        localResolution: localResolution ?? undefined,
        existingResolution: existingResolution ?? undefined,
        topCandidate: result?.topCandidate ?? null,
        candidates: result?.candidates ?? [],
        fillPlan: result?.fillPlan ?? [],
        sheetFields: source.fields,
      };
      const values = {
        workspaceId: workspace.id,
        sourceFingerprint: source.sourceFingerprint,
        isStale: false,
        materialId: preservedManualSelection
          ? (existing?.materialId ?? null)
          : (existing?.materialId ?? autoMaterialId ?? null),
        originalRowIndex: source.originalRowIndex,
        originalDataJson: source.fields,
        productName:
          source.name.trim().length > 0
            ? source.name.trim()
            : `Dòng ${source.originalRowIndex}`,
        specText: source.fields.specText ?? "",
        unit: source.fields.unit ?? "",
        currency: "VND",
        vendorHint: emptyToNull(source.fields.manufacturer),
        originHint: emptyToNull(source.fields.originCountry),
        quantity: null,
        targetPrice: parseOptionalNumber(source.fields.defaultUnitPrice ?? ""),
        unitPrice: parseOptionalNumber(source.fields.defaultUnitPrice ?? ""),
        searchKeywords: [
          source.name,
          source.fields.unit,
          source.fields.specText,
        ]
          .map((value) => value?.trim() ?? "")
          .filter(Boolean),
        sortOrder: index,
        includedInExport: source.inputValidation.valid,
        enrichedSnapshotJson: nextSnapshot,
        matchStatus: preservedManualSelection
          ? (existing?.matchStatus ?? inferredMatchStatus)
          : inferredMatchStatus,
        updatedAt: now,
      };
      if (existing) {
        seenItemIds.add(existing.id);
        await tx
          .update(excelWorkspaceItems)
          .set(values)
          .where(eq(excelWorkspaceItems.id, existing.id));
      } else {
        await tx.insert(excelWorkspaceItems).values({
          ...values,
          reviewDecisionJson: {},
          createdAt: now,
        });
      }
    }

    for (const existing of existingItems) {
      if (seenItemIds.has(existing.id)) continue;
      await tx
        .update(excelWorkspaceItems)
        .set({
          includedInExport: false,
          isStale: true,
          enrichedSnapshotJson: {
            ...jsonRecord(existing.enrichedSnapshotJson),
            stale: true,
          },
          updatedAt: now,
        })
        .where(eq(excelWorkspaceItems.id, existing.id));
    }
  });

  await db
    .update(excelWorkspaces)
    .set({
      status: "matched",
      rowCount: rows.length,
      updatedAt: now,
    })
    .where(eq(excelWorkspaces.id, workspace.id));

  return getMaterialProfileWorkspace(db, workspace.id);
}

export async function updateMaterialProfileItem(
  db: AppDb,
  input: {
    itemId: number;
    materialId?: number | null;
    includedInExport?: boolean;
  },
) {
  const [item] = await db
    .select()
    .from(excelWorkspaceItems)
    .where(eq(excelWorkspaceItems.id, input.itemId))
    .limit(1);
  if (!item) {
    throw new MaterialProfileWorkspaceError(
      "NOT_FOUND",
      "Không tìm thấy dòng.",
    );
  }
  const [updated] = await db
    .update(excelWorkspaceItems)
    .set({
      materialId:
        input.materialId === undefined ? item.materialId : input.materialId,
      includedInExport: input.includedInExport ?? item.includedInExport,
      matchStatus:
        input.materialId === undefined
          ? item.matchStatus
          : input.materialId == null
            ? "unmatched"
            : "manual",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(excelWorkspaceItems.id, input.itemId))
    .returning();
  return updated;
}

function workspaceItemForReview(item: WorkspaceItem): WorkspaceItemForReview {
  return {
    id: item.id,
    originalRowIndex: item.originalRowIndex,
    productName: item.productName,
    specText: item.specText,
    unit: item.unit,
    vendorHint: item.vendorHint,
    originHint: item.originHint,
    unitPrice: item.unitPrice,
    currency: item.currency,
    originalDataJson: item.originalDataJson,
    enrichedSnapshotJson: item.enrichedSnapshotJson,
  };
}

export async function updateMaterialProfileItemReviewDecision(
  db: AppDb,
  input: {
    itemId: number;
    decision: SerializedRowDecision;
  },
) {
  const [item] = await db
    .select()
    .from(excelWorkspaceItems)
    .where(eq(excelWorkspaceItems.id, input.itemId))
    .limit(1);
  if (!item) {
    throw new MaterialProfileWorkspaceError(
      "NOT_FOUND",
      "Không tìm thấy dòng.",
    );
  }

  const reviewItem = workspaceItemForReview(item);
  const snapshotStatus = snapshotStatusFromItem(reviewItem);
  const topCandidateMaterialId = topCandidateMaterialIdFromItem(reviewItem);
  const decision = deserializeRowDecision(input.decision);
  if (!decision) {
    throw new MaterialProfileWorkspaceError(
      "BAD_REQUEST",
      "Quyết định duyệt không hợp lệ.",
    );
  }

  const matchStatus = deriveMatchStatus(
    decision,
    snapshotStatus,
    topCandidateMaterialId,
  );
  const now = new Date().toISOString();
  const [updated] = await db
    .update(excelWorkspaceItems)
    .set({
      reviewDecisionJson: serializeMaterialProfileUserDecision(
        serializeRowDecision(decision),
      ),
      materialId: decision.materialId,
      matchStatus,
      updatedAt: now,
    })
    .where(eq(excelWorkspaceItems.id, input.itemId))
    .returning();

  return updated;
}

export async function batchUpdateMaterialProfileItemReviewDecisions(
  db: AppDb,
  input: {
    workspaceId: number;
    decisions: Array<{ itemId: number; decision: SerializedRowDecision }>;
  },
) {
  if (input.decisions.length === 0) {
    return { updatedCount: 0, items: [] as WorkspaceItem[] };
  }

  const workspace = await requireWorkspace(db, input.workspaceId);
  const itemIds = Array.from(
    new Set(input.decisions.map((entry) => entry.itemId)),
  );
  if (itemIds.length !== input.decisions.length) {
    throw new MaterialProfileWorkspaceError(
      "BAD_REQUEST",
      "Có dòng bị lặp trong danh sách quyết định duyệt.",
    );
  }
  const items = await db
    .select()
    .from(excelWorkspaceItems)
    .where(
      and(
        eq(excelWorkspaceItems.workspaceId, workspace.id),
        inArray(excelWorkspaceItems.id, itemIds),
      ),
    );

  const itemById = new Map(items.map((item) => [item.id, item]));
  const missingItemIds = itemIds.filter((itemId) => !itemById.has(itemId));
  if (missingItemIds.length > 0) {
    throw new MaterialProfileWorkspaceError(
      "BAD_REQUEST",
      `Không tìm thấy ${missingItemIds.length.toLocaleString("vi-VN")} dòng trong hồ sơ này.`,
    );
  }

  const prepared = input.decisions.map((entry) => {
    const item = itemById.get(entry.itemId);
    if (!item) {
      throw new MaterialProfileWorkspaceError(
        "BAD_REQUEST",
        "Không tìm thấy dòng trong hồ sơ này.",
      );
    }
    const reviewItem = workspaceItemForReview(item);
    const decision = deserializeRowDecision(entry.decision);
    if (!decision) {
      throw new MaterialProfileWorkspaceError(
        "BAD_REQUEST",
        "Quyết định duyệt không hợp lệ.",
      );
    }
    return {
      item,
      decision,
      snapshotStatus: snapshotStatusFromItem(reviewItem),
      topCandidateMaterialId: topCandidateMaterialIdFromItem(reviewItem),
    };
  });

  return await db.transaction(async (tx) => {
    const now = new Date().toISOString();
    const updatedItems: WorkspaceItem[] = [];

    for (const entry of prepared) {
      const matchStatus = deriveMatchStatus(
        entry.decision,
        entry.snapshotStatus,
        entry.topCandidateMaterialId,
      );
      const [updated] = await tx
        .update(excelWorkspaceItems)
        .set({
          reviewDecisionJson: serializeMaterialProfileUserDecision(
            serializeRowDecision(entry.decision),
          ),
          materialId: entry.decision.materialId,
          matchStatus,
          updatedAt: now,
        })
        .where(eq(excelWorkspaceItems.id, entry.item.id))
        .returning();
      if (!updated) {
        throw new MaterialProfileWorkspaceError(
          "BAD_REQUEST",
          "Không lưu được quyết định duyệt.",
        );
      }
      updatedItems.push(updated);
    }

    return { updatedCount: updatedItems.length, items: updatedItems };
  });
}

export async function updateMaterialProfileItemEnrichmentDraft(
  db: AppDb,
  input: {
    itemId: number;
    enrichmentStatus?: string;
    webResults?: Record<string, unknown>[];
    aiFields?: Record<string, unknown>;
    aiEvidence?: Record<string, unknown>[];
  },
) {
  const [item] = await db
    .select()
    .from(excelWorkspaceItems)
    .where(eq(excelWorkspaceItems.id, input.itemId))
    .limit(1);
  if (!item) {
    throw new MaterialProfileWorkspaceError(
      "NOT_FOUND",
      "Không tìm thấy dòng.",
    );
  }

  const now = new Date().toISOString();
  const [updated] = await db
    .update(excelWorkspaceItems)
    .set({
      enrichmentStatus: input.enrichmentStatus ?? item.enrichmentStatus,
      webResultsJson: input.webResults ?? item.webResultsJson,
      aiFieldsJson: input.aiFields ?? item.aiFieldsJson,
      aiEvidenceJson: input.aiEvidence ?? item.aiEvidenceJson,
      enrichmentUpdatedAt: now,
      updatedAt: now,
    })
    .where(eq(excelWorkspaceItems.id, input.itemId))
    .returning();

  return updated;
}

function textField(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function emptyToNull(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function enrichmentInputFromWorkspaceItem(item: WorkspaceItem) {
  const original =
    item.originalDataJson && typeof item.originalDataJson === "object"
      ? item.originalDataJson
      : {};
  return {
    name: item.productName,
    code: textField(original.code),
    manufacturer: textField(original.manufacturer) || (item.vendorHint ?? ""),
    specText: textField(original.specText) || item.specText,
    unit: textField(original.unit) || item.unit,
    category: textField(original.category),
  };
}

export async function bulkAiSearchMaterialProfileItems(
  db: AppDb,
  input: { workspaceId: number; itemIds: number[] },
) {
  await requireWorkspace(db, input.workspaceId);
  const itemIds = [...new Set(input.itemIds)].slice(0, 500);
  if (itemIds.length === 0) {
    return { completed: 0, skipped: 0, items: [] as WorkspaceItem[] };
  }

  const items = await db
    .select()
    .from(excelWorkspaceItems)
    .where(
      and(
        eq(excelWorkspaceItems.workspaceId, input.workspaceId),
        inArray(excelWorkspaceItems.id, itemIds),
      ),
    )
    .orderBy(excelWorkspaceItems.sortOrder);

  const updatedItems: WorkspaceItem[] = [];
  let completed = 0;
  let skipped = 0;

  await runWithConcurrency(items, 4, async (item) => {
    if (!item.productName.trim()) {
      skipped += 1;
      return;
    }

    const now = new Date().toISOString();
    await db
      .update(excelWorkspaceItems)
      .set({
        enrichmentStatus: "ai_searching",
        enrichmentUpdatedAt: now,
        updatedAt: now,
      })
      .where(eq(excelWorkspaceItems.id, item.id));

    try {
      const result = await enrichRowFromWeb(
        enrichmentInputFromWorkspaceItem(item),
      );
      const sourceResults = result.sourceUrls.map((url) => ({
        title: url,
        url,
        domain: "",
        snippet: "",
      }));
      const [updated] = await db
        .update(excelWorkspaceItems)
        .set({
          enrichmentStatus:
            Object.keys(result.fields).length > 0 ? "ai_done" : "error",
          webResultsJson: sourceResults,
          aiFieldsJson: result.fields as Record<string, unknown>,
          aiEvidenceJson: result.evidence as unknown as Record<
            string,
            unknown
          >[],
          enrichmentUpdatedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(excelWorkspaceItems.id, item.id))
        .returning();
      if (updated) {
        updatedItems.push(updated);
      }
      if (Object.keys(result.fields).length > 0) {
        completed += 1;
      } else {
        skipped += 1;
      }
    } catch {
      skipped += 1;
      const [updated] = await db
        .update(excelWorkspaceItems)
        .set({
          enrichmentStatus: "error",
          enrichmentUpdatedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(excelWorkspaceItems.id, item.id))
        .returning();
      if (updated) {
        updatedItems.push(updated);
      }
    }
  });

  return { completed, skipped, items: updatedItems };
}

export async function updateMaterialProfileExportEditState(
  db: AppDb,
  input: {
    workspaceId: number;
    exportEditState: MaterialProfileExportEditState;
  },
) {
  await requireWorkspace(db, input.workspaceId);
  const nextState = {
    ...parseMaterialProfileExportEditState(input.exportEditState),
    updatedAt: new Date().toISOString(),
  };
  const [updated] = await db
    .update(excelWorkspaces)
    .set({
      exportEditStateJson: materialProfileExportEditStateJson(nextState),
      updatedAt: nextState.updatedAt,
    })
    .where(eq(excelWorkspaces.id, input.workspaceId))
    .returning();
  return updated ?? requireWorkspace(db, input.workspaceId);
}

export async function bulkUpdateMaterialProfileItems(
  db: AppDb,
  input: {
    workspaceId: number;
    itemIds: number[];
    includedInExport?: boolean;
    clearMaterialId?: boolean;
  },
) {
  const itemIds = Array.from(new Set(input.itemIds)).filter((id) => id > 0);
  if (itemIds.length === 0) {
    throw new MaterialProfileWorkspaceError(
      "BAD_REQUEST",
      "Chọn ít nhất một dòng để cập nhật.",
    );
  }
  await requireWorkspace(db, input.workspaceId);
  const patch: Partial<typeof excelWorkspaceItems.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };
  if (input.includedInExport !== undefined) {
    patch.includedInExport = input.includedInExport;
  }
  if (input.clearMaterialId) {
    patch.materialId = null;
    patch.matchStatus = "unmatched";
  }
  const updated = await db
    .update(excelWorkspaceItems)
    .set(patch)
    .where(
      and(
        eq(excelWorkspaceItems.workspaceId, input.workspaceId),
        inArray(excelWorkspaceItems.id, itemIds),
      ),
    )
    .returning();
  return { updatedCount: updated.length };
}

export async function bulkApplyMaterialProfileMatches(
  db: AppDb,
  input: {
    workspaceId: number;
    itemIds: number[];
    threshold?: number;
  },
) {
  const workspace = await requireWorkspace(db, input.workspaceId);
  const itemIds = Array.from(new Set(input.itemIds)).filter((id) => id > 0);
  if (itemIds.length === 0) {
    throw new MaterialProfileWorkspaceError(
      "BAD_REQUEST",
      "Chọn ít nhất một dòng để bulk apply.",
    );
  }
  const threshold = input.threshold ?? 0.85;
  const items = await db
    .select()
    .from(excelWorkspaceItems)
    .where(
      and(
        eq(excelWorkspaceItems.workspaceId, workspace.id),
        inArray(excelWorkspaceItems.id, itemIds),
      ),
    )
    .orderBy(excelWorkspaceItems.sortOrder);

  const now = new Date().toISOString();
  let appliedCount = 0;
  let reviewCount = 0;
  let unchangedCount = 0;
  const updates: Array<{ item: WorkspaceItem; materialId: number }> = [];
  for (const item of items) {
    const candidate = topCandidateFromSnapshot(item.enrichedSnapshotJson);
    if (
      !candidate ||
      !shouldBulkApplyMaterialProfileCandidate(candidate.score, threshold)
    ) {
      reviewCount += 1;
      continue;
    }
    if (
      item.materialId === candidate.materialId &&
      item.matchStatus === "matched"
    ) {
      unchangedCount += 1;
      continue;
    }
    appliedCount += 1;
    updates.push({ item, materialId: candidate.materialId });
  }

  const summary = {
    selectedCount: items.length,
    appliedCount,
    reviewCount,
    unchangedCount,
  };
  const snapshot: MaterialProfileBulkApplySnapshot = {
    workspaceId: workspace.id,
    createdAt: now,
    itemIds: items.map((item) => item.id),
    previousItems: items.map((item) => ({
      itemId: item.id,
      materialId: item.materialId,
      matchStatus: item.matchStatus,
      includedInExport: item.includedInExport,
      reviewDecisionJson: item.reviewDecisionJson,
    })),
    summary,
  };
  await db.transaction(async (tx) => {
    for (const update of updates) {
      const decision = seedDecisionFromItem({
        ...update.item,
        materialId: update.materialId,
        matchStatus: "matched",
        reviewDecisionJson: {},
      });
      await tx
        .update(excelWorkspaceItems)
        .set({
          materialId: update.materialId,
          matchStatus: "matched",
          reviewDecisionJson: serializeMaterialProfileUserDecision(
            serializeRowDecision(decision),
          ),
          updatedAt: now,
        })
        .where(eq(excelWorkspaceItems.id, update.item.id));
    }
    await tx
      .update(excelWorkspaces)
      .set({
        templateConfigJson: {
          ...workspace.templateConfigJson,
          materialProfileLastBulkApply: snapshot,
        },
        updatedAt: now,
      })
      .where(eq(excelWorkspaces.id, workspace.id));
  });

  return { summary, undoAvailable: items.length > 0 };
}

export async function undoLastMaterialProfileBulkApply(
  db: AppDb,
  workspaceId: number,
) {
  const workspace = await requireWorkspace(db, workspaceId);
  const snapshot = parseLastBulkApplySnapshot(workspace.templateConfigJson);
  if (snapshot?.workspaceId !== workspace.id) {
    throw new MaterialProfileWorkspaceError(
      "BAD_REQUEST",
      "Không có bulk apply gần nhất để undo.",
    );
  }
  const now = new Date().toISOString();
  for (const previous of snapshot.previousItems) {
    await db
      .update(excelWorkspaceItems)
      .set({
        materialId: previous.materialId,
        matchStatus: previous.matchStatus,
        includedInExport: previous.includedInExport,
        reviewDecisionJson: jsonRecord(previous.reviewDecisionJson),
        updatedAt: now,
      })
      .where(
        and(
          eq(excelWorkspaceItems.workspaceId, workspace.id),
          eq(excelWorkspaceItems.id, previous.itemId),
        ),
      );
  }
  const templateConfigJson = { ...workspace.templateConfigJson };
  delete templateConfigJson.materialProfileLastBulkApply;
  await db
    .update(excelWorkspaces)
    .set({ templateConfigJson, updatedAt: now })
    .where(eq(excelWorkspaces.id, workspace.id));
  return {
    restoredCount: snapshot.previousItems.length,
    summary: snapshot.summary,
  };
}

async function catalogDocumentsByMaterial(db: AppDb, materialIds: number[]) {
  if (materialIds.length === 0) return new Map<number, CatalogDocumentRow[]>();
  const rows = await db
    .select({
      materialId: materialCatalogDocumentLinks.materialId,
      document: materialCatalogDocuments,
    })
    .from(materialCatalogDocumentLinks)
    .innerJoin(
      materialCatalogDocuments,
      eq(materialCatalogDocumentLinks.documentId, materialCatalogDocuments.id),
    )
    .where(
      and(
        inArray(materialCatalogDocumentLinks.materialId, materialIds),
        isNull(materialCatalogDocuments.deletedAt),
      ),
    );
  const byMaterial = new Map<number, CatalogDocumentRow[]>();
  for (const row of rows) {
    const current = byMaterial.get(row.materialId) ?? [];
    current.push(row.document);
    byMaterial.set(row.materialId, current);
  }
  return byMaterial;
}

function uniqueFileName(fileName: string, used: Set<string>) {
  const safe = sanitizeCatalogPdfFileName(fileName);
  const ext = path.extname(safe) || ".pdf";
  const base = safe.slice(0, safe.length - ext.length) || "catalog";
  let candidate = safe;
  let index = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base}-${index}${ext}`;
    index += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

async function loadMaterialRows(db: AppDb, materialIds: number[]) {
  return materialIds.length > 0
    ? await db
        .select()
        .from(materials)
        .where(
          and(inArray(materials.id, materialIds), isNull(materials.deletedAt)),
        )
    : [];
}

function materialIdsFromItems(items: WorkspaceItem[]) {
  return Array.from(
    new Set(
      items
        .map((item) => item.materialId)
        .filter((id): id is number => id != null),
    ),
  );
}

function materialProfileSheetMeta(workspace: Workspace) {
  const parsed = parseWorkbookJson(workspace.workbookJson);
  return parsed.sheets.find(
    (sheet) => sheet.name === workspace.sourceSheetName,
  );
}

function originalColumnCountBySheet(workbook: ExcelJS.Workbook) {
  return new Map(
    workbook.worksheets.map((sheet) => [
      sheet.name,
      Math.max(sheet.columnCount, 1),
    ]),
  );
}

function worksheetToRows(sheet: ExcelJS.Worksheet, columnCount: number) {
  const rowCount = Math.max(sheet.rowCount, 1);
  const rows: string[][] = [];
  for (let rowNumber = 1; rowNumber <= rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const values: string[] = [];
    for (let colNumber = 1; colNumber <= columnCount; colNumber += 1) {
      values.push(cellToPreviewText(row.getCell(colNumber).value));
    }
    rows.push(values);
  }
  return rows;
}

function ensurePreviewCell(
  rows: string[][],
  rowNumber: number,
  colNumber: number,
) {
  const rowIndex = rowNumber - 1;
  const colIndex = colNumber - 1;
  rows[rowIndex] ??= [];
  const row = rows[rowIndex];
  while (row.length <= colIndex) {
    row.push("");
  }
  return row;
}

function applyMaterialOutputColumnsToRows(input: {
  rows: string[][];
  startColumn: number;
  headerRowIndex: number;
  items: WorkspaceItem[];
  materialsById: Map<number, MaterialRow>;
  catalogFilesByMaterial: Map<number, string[]>;
  edits: MaterialProfileCellEdits;
  sheetName: string;
}) {
  const headerRow = ensurePreviewCell(
    input.rows,
    input.headerRowIndex,
    input.startColumn + MATERIAL_PROFILE_EXPORT_COLUMNS.length - 1,
  );
  MATERIAL_PROFILE_EXPORT_COLUMNS.forEach((column, index) => {
    const colNumber = input.startColumn + index;
    headerRow[colNumber - 1] =
      editValueForCell(
        input.edits,
        input.sheetName,
        input.headerRowIndex,
        colNumber,
      ) ?? column.header;
  });

  for (const item of input.items) {
    if (!item.includedInExport) continue;
    const material =
      item.materialId == null
        ? undefined
        : input.materialsById.get(item.materialId);
    const catalogFiles =
      item.materialId == null
        ? []
        : (input.catalogFilesByMaterial.get(item.materialId) ?? []);
    const row = ensurePreviewCell(
      input.rows,
      item.originalRowIndex,
      input.startColumn + MATERIAL_PROFILE_EXPORT_COLUMNS.length - 1,
    );
    MATERIAL_PROFILE_EXPORT_COLUMNS.forEach((column, index) => {
      const colNumber = input.startColumn + index;
      const edited = editValueForCell(
        input.edits,
        input.sheetName,
        item.originalRowIndex,
        colNumber,
      );
      row[colNumber - 1] =
        edited ??
        String(materialValue(material, column.key, item, catalogFiles) ?? "");
    });
  }
}

function catalogPreviewFilesByMaterial(
  docsByMaterial: Map<number, CatalogDocumentRow[]>,
) {
  const files = new Map<number, string[]>();
  for (const [materialId, docs] of docsByMaterial) {
    files.set(
      materialId,
      docs.map(
        (doc) =>
          doc.fileName ??
          (doc.sourceUrl
            ? catalogPdfFileNameFromUrl(doc.sourceUrl)
            : "catalog.pdf"),
      ),
    );
  }
  return files;
}

function materialProfileConfidenceForItem(
  item: Pick<WorkspaceItem, "enrichedSnapshotJson" | "matchStatus">,
  material: MaterialRow,
) {
  const profileMetadata = jsonRecord(
    jsonRecord(material.metadataJson).materialProfile,
  );
  if (
    typeof profileMetadata.confidence === "number" &&
    Number.isFinite(profileMetadata.confidence)
  ) {
    return profileMetadata.confidence;
  }
  const snapshot = jsonRecord(item.enrichedSnapshotJson);
  if (typeof snapshot.score === "number" && Number.isFinite(snapshot.score)) {
    return snapshot.score;
  }
  // A complete record explicitly selected/edited by an operator is a manual
  // verification, not an unscored automatic match.
  return item.matchStatus === "manual" ? 1 : 0;
}

/**
 * The one canonical completeness gate for local matches and clean export.
 * A materialId alone is never proof that the required profile output exists.
 */
function materialProfileResolutionForItem(
  item: Pick<
    WorkspaceItem,
    | "productName"
    | "unit"
    | "specText"
    | "originalRowIndex"
    | "originalDataJson"
    | "enrichedSnapshotJson"
    | "matchStatus"
  >,
  material: MaterialRow | undefined,
  docs: CatalogDocumentRow[] = [],
) {
  const profileMetadata = material
    ? jsonRecord(jsonRecord(material.metadataJson).materialProfile)
    : {};
  const sourceUrl = material?.sourceUrl?.trim() ?? "";
  const catalogUrl =
    docs.map((doc) => doc.sourceUrl?.trim() ?? "").find(Boolean) ?? "";
  const input = {
    name: item.productName,
    unit: item.unit,
    specText: item.specText,
    rowIndex: item.originalRowIndex,
    sourceValues: jsonRecord(item.originalDataJson),
  };
  const candidate = {
    code: material?.code,
    name: material?.name,
    unit: material?.unit,
    specText: material?.specText,
    manufacturer: material?.manufacturer,
    originCountry: material?.originCountry,
    unitPrice: material?.defaultUnitPrice,
    source:
      typeof profileMetadata.source === "string"
        ? profileMetadata.source
        : sourceUrl,
    sourceUrl,
    catalogUrl,
    evidenceUrls: docs
      .map((doc) => doc.sourceUrl?.trim() ?? "")
      .filter(Boolean),
    confidence: material ? materialProfileConfidenceForItem(item, material) : 0,
    provenance:
      typeof profileMetadata.provenance === "string"
        ? profileMetadata.provenance
        : undefined,
    codeProvenance:
      typeof profileMetadata.codeProvenance === "string"
        ? profileMetadata.codeProvenance
        : undefined,
  };
  return {
    input,
    candidate,
    resolution: validateMaterialProfileResolution({ input, candidate }),
  };
}

function materialProfileMatchCounts(
  items: WorkspaceItem[],
  docsByMaterial: Map<number, CatalogDocumentRow[]>,
  materialRowsById: Map<number, MaterialRow>,
  materialSheetName: string,
  exportEditState: MaterialProfileExportEditState,
) {
  const exportItems = items.filter(
    (item) =>
      item.includedInExport &&
      !item.isStale &&
      !isMaterialRowDeleted(item, materialSheetName, exportEditState),
  );
  return {
    matchedCount: items.filter(
      (item) => item.matchStatus === "matched" || item.matchStatus === "manual",
    ).length,
    reviewCount: items.filter((item) => item.matchStatus === "candidates_found")
      .length,
    unmatchedCount: items.filter((item) => item.matchStatus === "unmatched")
      .length,
    exportRowCount: exportItems.length,
    missingCatalogCount: exportItems.filter((item) => {
      if (item.materialId == null) return true;
      if (!materialRowsById.has(item.materialId)) return true;
      return (docsByMaterial.get(item.materialId) ?? []).length === 0;
    }).length,
  };
}

export async function previewMaterialProfileExportWorkbook(
  db: AppDb,
  workspaceId: number,
) {
  const workspace = await requireWorkspace(db, workspaceId);
  const items = await db
    .select()
    .from(excelWorkspaceItems)
    .where(eq(excelWorkspaceItems.workspaceId, workspace.id))
    .orderBy(excelWorkspaceItems.sortOrder);
  const materialIds = materialIdsFromItems(items);
  const materialRows = await loadMaterialRows(db, materialIds);
  const materialsById = new Map(materialRows.map((row) => [row.id, row]));
  const docsByMaterial = await catalogDocumentsByMaterial(db, materialIds);

  const catalogFilesByMaterial = catalogPreviewFilesByMaterial(docsByMaterial);
  const exportEditState = parseMaterialProfileExportEditState(
    workspace.exportEditStateJson,
  );
  const previewSheetName =
    workspace.sourceSheetName ??
    materialProfileSheetMeta(workspace)?.name ??
    "";
  const previewItems = items.filter(
    (item) =>
      item.includedInExport &&
      !item.isStale &&
      !isMaterialRowDeleted(item, previewSheetName, exportEditState),
  );
  const reviewReadiness = summarizeMaterialProfileReviewReadiness(previewItems);

  const workbook = new ExcelJS.Workbook();
  const sourceBuffer = await readWorkspaceWorkbook(workspace);
  await workbook.xlsx.load(
    sourceBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  const maxColumnBySheet = originalColumnCountBySheet(workbook);
  applyCellEdits(workbook, workspace.editStateJson, maxColumnBySheet);

  const activeTargetSheetName =
    workspace.sourceSheetName ?? workbook.worksheets[0]?.name ?? "";
  const selectedMeta = materialProfileSheetMeta(workspace);

  return {
    selectedSheetName: activeTargetSheetName,
    exportEditState,
    reviewReadiness,
    reviewWarnings: reviewReadiness.warnings,
    unresolvedReviewCount: reviewReadiness.unresolvedRows,
    editSummary: summarizeMaterialProfileExportEditState(
      exportEditState,
      activeTargetSheetName,
    ),
    matchCounts: materialProfileMatchCounts(
      items,
      docsByMaterial,
      materialsById,
      activeTargetSheetName,
      exportEditState,
    ),
    sheets: workbook.worksheets.map((sheet) => {
      const originalColumnCount =
        maxColumnBySheet.get(sheet.name) ?? sheet.columnCount;
      const isMaterialSheet = sheet.name === activeTargetSheetName;
      const startColumn = isMaterialSheet ? originalColumnCount + 1 : null;
      const rows = worksheetToRows(
        sheet,
        isMaterialSheet
          ? originalColumnCount + MATERIAL_PROFILE_EXPORT_COLUMNS.length
          : originalColumnCount,
      );
      if (isMaterialSheet && startColumn != null) {
        applyMaterialOutputColumnsToRows({
          rows,
          startColumn,
          headerRowIndex: selectedMeta?.activeHeaderRowIndex ?? 1,
          items,
          materialsById,
          catalogFilesByMaterial,
          edits: exportEditState.cellEdits,
          sheetName: sheet.name,
        });
      }
      const visible = filterPreviewRowsAndColumns(
        rows,
        sheet.name,
        exportEditState,
      );
      return {
        name: sheet.name,
        isMaterialSheet,
        headerRowIndex: isMaterialSheet
          ? (selectedMeta?.activeHeaderRowIndex ?? 1)
          : 1,
        originalColumnCount,
        appendedStartColumn: startColumn,
        rowCount: visible.rows.length,
        columnCount:
          visible.rows.length > 0
            ? Math.max(...visible.rows.map((row) => row.length), 0)
            : 0,
        rowNumbers: visible.rowNumbers,
        columnNumbers: visible.columnNumbers,
        rows: visible.rows,
      };
    }),
  };
}

/**
 * Clean profile output is intentionally all current source rows. Legacy
 * `includedInExport` remains available to the preserve-layout export, but must
 * never silently omit an invalid profile row from the strict clean file.
 */
export function selectMaterialProfileCleanExportItems<
  T extends { isStale: boolean },
>(items: T[]) {
  return items.filter((item) => !item.isStale);
}

/** Lightweight preview of the exact single-sheet format produced by export. */
export async function previewMaterialProfileCleanExport(
  db: AppDb,
  workspaceId: number,
) {
  const workspace = await requireWorkspace(db, workspaceId);
  const items = await db
    .select()
    .from(excelWorkspaceItems)
    .where(eq(excelWorkspaceItems.workspaceId, workspace.id))
    .orderBy(excelWorkspaceItems.sortOrder);
  const exportItems = selectMaterialProfileCleanExportItems(items);
  const materialIds = materialIdsFromItems(exportItems);
  const materialRows = await loadMaterialRows(db, materialIds);
  const materialsById = new Map(materialRows.map((row) => [row.id, row]));
  const docsByMaterial = await catalogDocumentsByMaterial(db, materialIds);
  const entries = exportItems.map((item) => {
    const material =
      item.materialId == null ? undefined : materialsById.get(item.materialId);
    const docs =
      item.materialId == null
        ? []
        : (docsByMaterial.get(item.materialId) ?? []);
    const { input, candidate, resolution } = materialProfileResolutionForItem(
      item,
      material,
      docs,
    );
    return {
      item,
      resolution,
      row: toMaterialProfileCleanExportRow({ input, candidate, resolution }),
    };
  });
  const incomplete = entries.filter((entry) => !entry.resolution.promotable);
  return {
    headers: [...CLEAN_MATERIAL_PROFILE_EXPORT_HEADERS],
    rows: entries.map((entry) => entry.row),
    totalRows: entries.length,
    completeRows: entries.length - incomplete.length,
    incompleteRows: incomplete.length,
    canExport: entries.length > 0 && incomplete.length === 0,
    emptyReason:
      entries.length === 0
        ? "Chưa có dòng vật tư hiện tại để xuất. Hãy map và tự xử lý workbook trước."
        : null,
    issues: incomplete.slice(0, 20).map((entry) => ({
      originalRowIndex: entry.item.originalRowIndex,
      name: entry.item.productName,
      reasons: entry.resolution.reasons,
    })),
  };
}

export function buildOpenFolderCommand(outputDirPath: string) {
  if (process.platform === "darwin") {
    return { command: "open", args: [outputDirPath] };
  }
  if (process.platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", outputDirPath] };
  }
  return { command: "xdg-open", args: [outputDirPath] };
}

export function resolveDefaultDownloadsDir() {
  return path.join(homedir(), "Downloads");
}

function isForbiddenExportPath(resolved: string) {
  const root = path.parse(resolved).root;
  if (resolved === root) {
    return true;
  }
  if (process.platform === "win32") {
    return false;
  }
  const forbiddenPrefixes = [
    "/etc",
    "/usr",
    "/bin",
    "/sbin",
    "/var",
    "/sys",
    "/proc",
  ];
  return forbiddenPrefixes.some(
    (prefix) => resolved === prefix || resolved.startsWith(`${prefix}/`),
  );
}

export async function assertExportDirWritable(outputDirPath: string) {
  const trimmed = outputDirPath.trim();
  if (!trimmed) {
    throw new MaterialProfileWorkspaceError(
      "BAD_REQUEST",
      "Chưa chọn thư mục export.",
    );
  }

  const resolved = path.resolve(trimmed);
  if (isForbiddenExportPath(resolved)) {
    throw new MaterialProfileWorkspaceError(
      "BAD_REQUEST",
      "Không thể export vào thư mục hệ thống.",
    );
  }

  try {
    const info = await stat(resolved);
    if (!info.isDirectory()) {
      throw new MaterialProfileWorkspaceError(
        "BAD_REQUEST",
        "Đường dẫn export phải là thư mục.",
      );
    }
    await access(resolved, constants.W_OK);
    return resolved;
  } catch (error) {
    if (error instanceof MaterialProfileWorkspaceError) {
      throw error;
    }
    await mkdir(resolved, { recursive: true });
    await access(resolved, constants.W_OK);
    return resolved;
  }
}

export async function openMaterialProfileOutputFolder(
  db: AppDb,
  workspaceId: number,
) {
  const workspace = await requireWorkspace(db, workspaceId);
  if (!workspace.outputDirPath) {
    throw new MaterialProfileWorkspaceError(
      "BAD_REQUEST",
      "Chưa có folder output. Hãy export trước.",
    );
  }
  const outputDirPath = path.resolve(workspace.outputDirPath);
  await access(outputDirPath);
  const { command, args } = buildOpenFolderCommand(outputDirPath);
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return { outputDirPath };
}

type MaterialProfileExportBundle = {
  outputFolderName: string;
  excelFileName: string;
  excelBuffer: Buffer;
  catalogFiles: Array<{ fileName: string; buffer: Buffer }>;
  missingCount: number;
  warnings: string[];
  reviewReadiness: MaterialProfileReviewReadiness;
  reviewWarnings: string[];
  catalogCount: number;
};

async function markMaterialProfileWorkspaceExported(
  db: AppDb,
  workspaceId: number,
  excelFileName: string,
  outputDirPath: string | null,
) {
  const now = new Date().toISOString();
  await db
    .update(excelWorkspaces)
    .set({
      status: "catalog_generated",
      exportFileName: excelFileName,
      outputDirPath,
      exportedAt: now,
      updatedAt: now,
    })
    .where(eq(excelWorkspaces.id, workspaceId));
}

async function buildMaterialProfileExportBundle(
  db: AppDb,
  workspaceId: number,
  options: { includeCatalogFiles?: boolean } = {},
): Promise<{ workspace: Workspace; bundle: MaterialProfileExportBundle }> {
  const includeCatalogFiles = options.includeCatalogFiles ?? true;
  const workspace = await requireWorkspace(db, workspaceId);
  const items = await db
    .select()
    .from(excelWorkspaceItems)
    .where(eq(excelWorkspaceItems.workspaceId, workspace.id))
    .orderBy(excelWorkspaceItems.sortOrder);
  const exportItems = selectMaterialProfileCleanExportItems(items);
  if (exportItems.length === 0) {
    throw new MaterialProfileWorkspaceError(
      "BAD_REQUEST",
      "Chưa có dòng vật tư hiện tại để xuất danh mục chuẩn. Hãy map và tự xử lý workbook trước.",
    );
  }
  const reviewReadiness = summarizeMaterialProfileReviewReadiness(exportItems);
  const materialIds = materialIdsFromItems(exportItems);
  const materialRows = await loadMaterialRows(db, materialIds);
  const materialsById = new Map(materialRows.map((row) => [row.id, row]));
  const docsByMaterial = await catalogDocumentsByMaterial(db, materialIds);
  const cleanExportRows = exportItems.map((item) => {
    const material =
      item.materialId == null ? undefined : materialsById.get(item.materialId);
    const docs =
      item.materialId == null
        ? []
        : (docsByMaterial.get(item.materialId) ?? []);
    const resolved = materialProfileResolutionForItem(item, material, docs);
    return { item, material, docs, ...resolved };
  });
  const incompleteRows = cleanExportRows.filter(
    (entry) => !entry.resolution.promotable,
  );
  if (incompleteRows.length > 0) {
    const examples = incompleteRows
      .slice(0, 5)
      .map(
        (entry) =>
          `dòng ${entry.item.originalRowIndex}: ${entry.resolution.reasons.join(" ")}`,
      )
      .join(" ");
    throw new MaterialProfileWorkspaceError(
      "BAD_REQUEST",
      `Chưa thể xuất danh mục chuẩn: ${incompleteRows.length.toLocaleString("vi-VN")} dòng chưa đủ dữ liệu bắt buộc. Hãy chạy «Tự tìm & điền» hoặc hoàn thiện dòng đó. ${examples}`,
    );
  }

  const noticeNumber = workspace.noticeNumber ?? workspace.name;
  const prefix = buildMaterialProfileOutputPrefix(noticeNumber);

  const copiedCatalogByDocKey = new Map<string, string>();
  const usedCatalogNames = new Set<string>();
  const catalogBuffersByFileName = new Map<string, Buffer>();
  const missingRows: Array<Array<string | number | null>> = [];
  const warnings: string[] = [...reviewReadiness.warnings];

  if (includeCatalogFiles) {
    for (const { item, material, docs } of cleanExportRows) {
      if (!material) continue;

      for (const doc of docs) {
        const docKey = doc.localFilePath
          ? `local:${doc.localFilePath}`
          : doc.sourceUrl
            ? `url:${doc.sourceUrl}`
            : `doc:${doc.id}`;
        let fileName = copiedCatalogByDocKey.get(docKey);
        if (!fileName) {
          try {
            const sourceFileName =
              doc.fileName ??
              (doc.sourceUrl
                ? catalogPdfFileNameFromUrl(doc.sourceUrl)
                : "catalog.pdf");
            fileName = uniqueFileName(sourceFileName, usedCatalogNames);
            const buffer = doc.localFilePath
              ? await readCatalogPdfFile(doc.localFilePath)
              : doc.sourceUrl
                ? await downloadCatalogPdfFromUrl(doc.sourceUrl)
                : null;
            if (!buffer) {
              throw new Error(
                "Tài liệu catalog chưa có file local hoặc URL PDF.",
              );
            }
            catalogBuffersByFileName.set(fileName, buffer);
            copiedCatalogByDocKey.set(docKey, fileName);
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : "Không copy được catalog PDF.";
            warnings.push(`${material.name}: ${message}`);
            missingRows.push([
              item.originalRowIndex,
              material.name,
              message,
              doc.sourceUrl ?? doc.localFilePath ?? "",
            ]);
            continue;
          }
        }
      }
    }
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BidTool v3";
  workbook.created = new Date();
  const targetSheet = workbook.addWorksheet("Danh mục vật tư");
  targetSheet.views = [{ state: "frozen", ySplit: 1 }];
  const headerRow = targetSheet.addRow(CLEAN_MATERIAL_PROFILE_EXPORT_HEADERS);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1D4ED8" },
  };
  headerRow.alignment = {
    vertical: "middle",
    horizontal: "center",
    wrapText: true,
  };
  targetSheet.columns = [
    { width: 18 },
    { width: 34 },
    { width: 12 },
    { width: 42 },
    { width: 24 },
    { width: 18 },
    { width: 16 },
    { width: 24 },
    { width: 48 },
    { width: 14 },
    { width: 18 },
  ];

  for (const { input, candidate, resolution } of cleanExportRows) {
    const exportRow = toMaterialProfileCleanExportRow({
      input,
      candidate,
      resolution,
    });
    const row = targetSheet.addRow(
      CLEAN_MATERIAL_PROFILE_EXPORT_HEADERS.map((header) => exportRow[header]),
    );
    row.alignment = { vertical: "top", wrapText: true };
    row.getCell(7).numFmt = "#,##0";
  }
  targetSheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: {
      row: Math.max(targetSheet.rowCount, 1),
      column: CLEAN_MATERIAL_PROFILE_EXPORT_HEADERS.length,
    },
  };

  const excelFileName = `${prefix}-danh-muc-vat-tu.xlsx`;
  const excelBuffer = Buffer.from(await workbook.xlsx.writeBuffer());

  return {
    workspace,
    bundle: {
      outputFolderName: prefix,
      excelFileName,
      excelBuffer,
      catalogFiles: Array.from(catalogBuffersByFileName.entries()).map(
        ([fileName, buffer]) => ({ fileName, buffer }),
      ),
      missingCount: missingRows.length,
      warnings,
      reviewReadiness,
      reviewWarnings: reviewReadiness.warnings,
      catalogCount: copiedCatalogByDocKey.size,
    },
  };
}

export async function exportMaterialProfileDownloadBundle(
  db: AppDb,
  workspaceId: number,
) {
  const { bundle } = await buildMaterialProfileExportBundle(db, workspaceId, {
    includeCatalogFiles: false,
  });
  await markMaterialProfileWorkspaceExported(
    db,
    workspaceId,
    bundle.excelFileName,
    null,
  );
  return {
    outputFolderName: bundle.outputFolderName,
    excelFileName: bundle.excelFileName,
    workbookBase64: bundle.excelBuffer.toString("base64"),
    catalogFiles: bundle.catalogFiles.map((file) => ({
      fileName: file.fileName,
      base64: file.buffer.toString("base64"),
    })),
    catalogCount: bundle.catalogCount,
    missingCount: bundle.missingCount,
    warnings: bundle.warnings,
    reviewReadiness: bundle.reviewReadiness,
    unresolvedReviewCount: bundle.reviewReadiness.unresolvedRows,
    reviewWarnings: bundle.reviewWarnings,
  };
}

export async function exportMaterialProfileWorkspace(
  db: AppDb,
  workspaceId: number,
  outputDirPathInput: string,
) {
  const { bundle } = await buildMaterialProfileExportBundle(db, workspaceId);
  const parentDir = await assertExportDirWritable(outputDirPathInput);
  const outputDir = path.join(parentDir, bundle.outputFolderName);
  const catalogDir = path.join(outputDir, "Catalog");
  await mkdir(outputDir, { recursive: true });
  await mkdir(catalogDir, { recursive: true });

  await writeFile(
    path.join(outputDir, bundle.excelFileName),
    bundle.excelBuffer,
  );
  for (const file of bundle.catalogFiles) {
    await writeFile(path.join(catalogDir, file.fileName), file.buffer);
  }

  await markMaterialProfileWorkspaceExported(
    db,
    workspaceId,
    bundle.excelFileName,
    outputDir,
  );

  return {
    outputDirPath: outputDir,
    parentDirPath: parentDir,
    excelFileName: bundle.excelFileName,
    outputFolderName: bundle.outputFolderName,
    catalogCount: bundle.catalogCount,
    missingCount: bundle.missingCount,
    warnings: bundle.warnings,
    reviewReadiness: bundle.reviewReadiness,
    unresolvedReviewCount: bundle.reviewReadiness.unresolvedRows,
    reviewWarnings: bundle.reviewWarnings,
  };
}
