import ExcelJS from "exceljs";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import { catalogPdfFileNameFromUrl } from "~/lib/materials/catalog-pdf";
import {
  deriveMatchStatus,
  deserializeRowDecision,
  type SerializedRowDecision,
  serializeRowDecision,
} from "~/lib/materials/review-decision";
import {
  snapshotStatusFromItem,
  topCandidateMaterialIdFromItem,
  type WorkspaceItemForReview,
} from "~/lib/materials/workspace-review-row";
import type {
  ColumnMapping,
  ParsedWorkbookSheet,
} from "~/server/services/excel-workbook";
import { extractRowFields, matchRows } from "~/server/services/excel-enrich";
import {
  parseWorkbookBase64,
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
  materialCatalogDocumentLinks,
  materialCatalogDocuments,
  materials,
} from "~/server/db/schema";

type AppDb = typeof appDb;
type Workspace = typeof excelWorkspaces.$inferSelect;
type WorkspaceItem = typeof excelWorkspaceItems.$inferSelect;
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
  }>;
  summary: {
    selectedCount: number;
    appliedCount: number;
    reviewCount: number;
    unchangedCount: number;
  };
};

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
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join("");
}

export function buildMaterialProfileOutputPrefix(
  noticeNumber: string,
  date = new Date(),
) {
  return `${safePathSegment(noticeNumber, "material-profile")} - ${timestampLabel(date)}`;
}

async function materialProfileRoot() {
  const configured = (await resolveMaterialProfileExportDir())?.trim();
  return configured && configured.length > 0
    ? path.resolve(configured)
    : path.join(process.cwd(), "data", "material-profiles");
}

function workbookJsonFromSheets(sheets: ParsedWorkbookSheet[]) {
  return {
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

function applyExportCellEdits(
  workbook: ExcelJS.Workbook,
  state: MaterialProfileExportEditState,
) {
  applyCellEdits(workbook, state.cellEdits);
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

function applyDeletedRowsAndColumnsToWorkbook(
  workbook: ExcelJS.Workbook,
  state: MaterialProfileExportEditState,
) {
  for (const sheet of workbook.worksheets) {
    const deletedColumns = [...(state.deletedColumns[sheet.name] ?? [])].sort(
      (a, b) => b - a,
    );
    for (const colNumber of deletedColumns) {
      sheet.spliceColumns(colNumber, 1);
    }

    const deletedRows = [...(state.deletedRows[sheet.name] ?? [])].sort(
      (a, b) => b - a,
    );
    for (const rowNumber of deletedRows) {
      sheet.spliceRows(rowNumber, 1);
    }
  }
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

async function readWorkspaceWorkbook(workspace: Workspace) {
  if (!workspace.sourceWorkbookPath) {
    throw new MaterialProfileWorkspaceError(
      "BAD_REQUEST",
      "Chưa upload file Excel cho work này.",
    );
  }
  return readFile(workspace.sourceWorkbookPath);
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
  input: { noticeNumber: string },
) {
  const noticeNumber = input.noticeNumber.trim();
  if (!noticeNumber) {
    throw new MaterialProfileWorkspaceError("BAD_REQUEST", "Nhập Số TBMT.");
  }
  const now = new Date().toISOString();
  const [workspace] = await db
    .insert(excelWorkspaces)
    .values({
      name: noticeNumber,
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
    .where(isNotNull(excelWorkspaces.noticeNumber))
    .orderBy(desc(excelWorkspaces.updatedAt))
    .limit(input.limit ?? 50)
    .offset(input.offset ?? 0);
}

export async function updateMaterialProfileWorkspace(
  db: AppDb,
  input: { workspaceId: number; noticeNumber: string },
) {
  await requireWorkspace(db, input.workspaceId);
  const noticeNumber = input.noticeNumber.trim();
  if (!noticeNumber) {
    throw new MaterialProfileWorkspaceError("BAD_REQUEST", "Nhập Số TBMT.");
  }
  const [updated] = await db
    .update(excelWorkspaces)
    .set({
      name: noticeNumber,
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
  return {
    workspace,
    items,
    workbook: parseWorkbookJson(workspace.workbookJson),
  };
}

export async function uploadMaterialProfileWorkbook(
  db: AppDb,
  input: { workspaceId: number; fileName: string; workbookBase64: string },
) {
  const workspace = await requireWorkspace(db, input.workspaceId);
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
  const safeFileName = sanitizeWorkbookFileName(input.fileName);
  const sourceWorkbookPath = path.join(sourceDir, safeFileName);
  await writeFile(sourceWorkbookPath, buffer);

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
      workbookJson: workbookJsonFromSheets(parsed.sheets),
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

  const nextWorkbookJson = {
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
  const rows = extractRowFields(sheet, workspace.columnMappingJson);
  const results = await matchRows(db, rows);
  const rowByIndex = new Map(rows.map((row) => [row.originalRowIndex, row]));

  await db
    .delete(excelWorkspaceItems)
    .where(eq(excelWorkspaceItems.workspaceId, workspace.id));

  const now = new Date().toISOString();
  if (results.length > 0) {
    await db.insert(excelWorkspaceItems).values(
      results.map((result, index) => {
        const source = rowByIndex.get(result.originalRowIndex);
        const autoMaterialId =
          result.status === "auto" ? result.topCandidate?.materialId : null;
        const matchStatus =
          result.status === "auto"
            ? ("matched" as const)
            : result.status === "review"
              ? ("candidates_found" as const)
              : ("unmatched" as const);
        return {
          workspaceId: workspace.id,
          materialId: autoMaterialId ?? null,
          originalRowIndex: result.originalRowIndex,
          originalDataJson: source?.fields ?? {},
          productName: source?.name ?? `Dòng ${result.originalRowIndex}`,
          specText: source?.fields.specText ?? "",
          unit: source?.fields.unit ?? "",
          currency: "VND",
          vendorHint: source?.fields.manufacturer ?? null,
          originHint: source?.fields.originCountry ?? null,
          unitPrice: source?.fields.defaultUnitPrice
            ? Number(source.fields.defaultUnitPrice.replace(/[^\d.-]/g, ""))
            : null,
          sortOrder: index,
          enrichedSnapshotJson: {
            status: result.status,
            score: result.topCandidate?.score ?? null,
            topCandidate: result.topCandidate,
            candidates: result.candidates,
            fillPlan: result.fillPlan,
            sheetFields: source?.fields ?? {},
          },
          matchStatus,
          createdAt: now,
          updatedAt: now,
        };
      }),
    );
  }

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
      reviewDecisionJson: serializeRowDecision(decision),
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
  const now = new Date().toISOString();
  const updatedItems: WorkspaceItem[] = [];

  for (const entry of input.decisions) {
    const item = itemById.get(entry.itemId);
    if (!item) continue;
    const reviewItem = workspaceItemForReview(item);
    const snapshotStatus = snapshotStatusFromItem(reviewItem);
    const topCandidateMaterialId = topCandidateMaterialIdFromItem(reviewItem);
    const decision = deserializeRowDecision(entry.decision);
    if (!decision) continue;

    const matchStatus = deriveMatchStatus(
      decision,
      snapshotStatus,
      topCandidateMaterialId,
    );
    const [updated] = await db
      .update(excelWorkspaceItems)
      .set({
        reviewDecisionJson: serializeRowDecision(decision),
        materialId: decision.materialId,
        matchStatus,
        updatedAt: now,
      })
      .where(eq(excelWorkspaceItems.id, entry.itemId))
      .returning();
    if (updated) updatedItems.push(updated);
  }

  return { updatedCount: updatedItems.length, items: updatedItems };
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
    await db
      .update(excelWorkspaceItems)
      .set({
        materialId: candidate.materialId,
        matchStatus: "matched",
        updatedAt: now,
      })
      .where(eq(excelWorkspaceItems.id, item.id));
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
    })),
    summary,
  };
  await db
    .update(excelWorkspaces)
    .set({
      templateConfigJson: {
        ...workspace.templateConfigJson,
        materialProfileLastBulkApply: snapshot,
      },
      updatedAt: now,
    })
    .where(eq(excelWorkspaces.id, workspace.id));

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

  const workbook = new ExcelJS.Workbook();
  const sourceBuffer = await readWorkspaceWorkbook(workspace);
  await workbook.xlsx.load(
    sourceBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  const maxColumnBySheet = originalColumnCountBySheet(workbook);
  applyCellEdits(workbook, workspace.editStateJson, maxColumnBySheet);

  const targetSheetName =
    workspace.sourceSheetName ?? workbook.worksheets[0]?.name ?? "";
  const selectedMeta = materialProfileSheetMeta(workspace);

  return {
    selectedSheetName: targetSheetName,
    exportEditState,
    editSummary: summarizeMaterialProfileExportEditState(
      exportEditState,
      targetSheetName,
    ),
    matchCounts: materialProfileMatchCounts(
      items,
      docsByMaterial,
      materialsById,
      targetSheetName,
      exportEditState,
    ),
    sheets: workbook.worksheets.map((sheet) => {
      const originalColumnCount =
        maxColumnBySheet.get(sheet.name) ?? sheet.columnCount;
      const isMaterialSheet = sheet.name === targetSheetName;
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

export async function exportMaterialProfileWorkspace(
  db: AppDb,
  workspaceId: number,
  outputDirPathInput: string,
) {
  const workspace = await requireWorkspace(db, workspaceId);
  const items = await db
    .select()
    .from(excelWorkspaceItems)
    .where(eq(excelWorkspaceItems.workspaceId, workspace.id))
    .orderBy(excelWorkspaceItems.sortOrder);
  const exportEditState = parseMaterialProfileExportEditState(
    workspace.exportEditStateJson,
  );
  const materialSheetName = workspace.sourceSheetName ?? "";
  const exportItems = items.filter(
    (item) =>
      item.includedInExport &&
      !isMaterialRowDeleted(item, materialSheetName, exportEditState),
  );
  const materialIds = materialIdsFromItems(exportItems);
  const materialRows = await loadMaterialRows(db, materialIds);
  const materialsById = new Map(materialRows.map((row) => [row.id, row]));
  const docsByMaterial = await catalogDocumentsByMaterial(db, materialIds);

  const noticeNumber = workspace.noticeNumber ?? workspace.name;
  const prefix = buildMaterialProfileOutputPrefix(noticeNumber);
  const outputDir = await assertExportDirWritable(outputDirPathInput);
  const catalogDir = path.join(outputDir, "Catalog");
  await mkdir(catalogDir, { recursive: true });

  const copiedCatalogByDocKey = new Map<string, string>();
  const usedCatalogNames = new Set<string>();
  const catalogFilesByMaterial = new Map<number, string[]>();
  const missingRows: Array<Array<string | number | null>> = [];
  const warnings: string[] = [];

  for (const item of exportItems) {
    const materialId = item.materialId;
    if (materialId == null) {
      missingRows.push([
        item.originalRowIndex,
        item.productName,
        "Chưa match vật tư",
        "",
      ]);
      continue;
    }
    const material = materialsById.get(materialId);
    if (!material) {
      missingRows.push([
        item.originalRowIndex,
        item.productName,
        "Vật tư đã bị xóa hoặc không tồn tại",
        "",
      ]);
      continue;
    }
    const docs = docsByMaterial.get(materialId) ?? [];
    if (docs.length === 0) {
      missingRows.push([
        item.originalRowIndex,
        material.name,
        "Vật tư chưa có catalog PDF",
        material.sourceUrl ?? "",
      ]);
      continue;
    }

    const fileNames: string[] = [];
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
          await writeFile(path.join(catalogDir, fileName), buffer);
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
      fileNames.push(fileName);
    }
    catalogFilesByMaterial.set(materialId, fileNames);
  }

  const workbook = new ExcelJS.Workbook();
  const sourceBuffer = await readWorkspaceWorkbook(workspace);
  await workbook.xlsx.load(
    sourceBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  const maxColumnBySheet = originalColumnCountBySheet(workbook);
  applyCellEdits(workbook, workspace.editStateJson, maxColumnBySheet);

  const targetSheet =
    workbook.getWorksheet(workspace.sourceSheetName ?? "") ??
    workbook.worksheets[0];
  if (!targetSheet) {
    throw new MaterialProfileWorkspaceError(
      "BAD_REQUEST",
      "Không tìm thấy sheet để export.",
    );
  }
  const selectedMeta = parseWorkbookJson(workspace.workbookJson).sheets.find(
    (sheet) => sheet.name === targetSheet.name,
  );
  const headerRow = targetSheet.getRow(selectedMeta?.activeHeaderRowIndex ?? 1);
  const startColumn =
    (maxColumnBySheet.get(targetSheet.name) ?? targetSheet.columnCount) + 1;
  MATERIAL_PROFILE_EXPORT_COLUMNS.forEach((column, index) => {
    const colNumber = startColumn + index;
    headerRow.getCell(colNumber).value = column.header;
  });
  headerRow.commit();

  for (const item of exportItems) {
    const material =
      item.materialId == null ? undefined : materialsById.get(item.materialId);
    const catalogFiles =
      item.materialId == null
        ? []
        : (catalogFilesByMaterial.get(item.materialId) ?? []);
    const row = targetSheet.getRow(item.originalRowIndex);
    MATERIAL_PROFILE_EXPORT_COLUMNS.forEach((column, index) => {
      const colNumber = startColumn + index;
      row.getCell(colNumber).value = materialValue(
        material,
        column.key,
        item,
        catalogFiles,
      );
    });
    row.commit();
  }

  applyExportCellEdits(workbook, exportEditState);
  applyDeletedRowsAndColumnsToWorkbook(workbook, exportEditState);

  const excelFileName = `${prefix}.xlsx`;
  const excelPath = path.join(outputDir, excelFileName);
  await writeFile(excelPath, Buffer.from(await workbook.xlsx.writeBuffer()));

  const now = new Date().toISOString();
  await db
    .update(excelWorkspaces)
    .set({
      status: "catalog_generated",
      exportFileName: excelFileName,
      outputDirPath: outputDir,
      exportedAt: now,
      updatedAt: now,
    })
    .where(eq(excelWorkspaces.id, workspace.id));

  return {
    outputDirPath: outputDir,
    excelFileName,
    catalogCount: copiedCatalogByDocKey.size,
    missingCount: missingRows.length,
    warnings,
  };
}
