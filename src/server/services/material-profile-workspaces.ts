import ExcelJS from "exceljs";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import { catalogPdfFileNameFromUrl } from "~/lib/materials/catalog-pdf";
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

async function writeRowsWorkbook(
  filePath: string,
  sheetName: string,
  headers: string[],
  rows: Array<Array<string | number | null>>,
) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow(headers);
  for (const row of rows) {
    sheet.addRow(row);
  }
  await writeFile(filePath, Buffer.from(await workbook.xlsx.writeBuffer()));
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
          edits: workspace.editStateJson,
          sheetName: sheet.name,
        });
      }
      return {
        name: sheet.name,
        isMaterialSheet,
        headerRowIndex: isMaterialSheet
          ? (selectedMeta?.activeHeaderRowIndex ?? 1)
          : 1,
        originalColumnCount,
        appendedStartColumn: startColumn,
        rowCount: rows.length,
        columnCount: Math.max(...rows.map((row) => row.length), 0),
        rows,
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

async function assertOutputDirPathAllowed(outputDirPath: string) {
  const root = path.resolve(await materialProfileRoot());
  const output = path.resolve(outputDirPath);
  if (output !== root && !output.startsWith(root + path.sep)) {
    throw new MaterialProfileWorkspaceError(
      "BAD_REQUEST",
      "Đường dẫn output không nằm trong thư mục hồ sơ vật tư.",
    );
  }
  await access(output);
  return output;
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
  const outputDirPath = await assertOutputDirPathAllowed(
    workspace.outputDirPath,
  );
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
) {
  const workspace = await requireWorkspace(db, workspaceId);
  const items = await db
    .select()
    .from(excelWorkspaceItems)
    .where(eq(excelWorkspaceItems.workspaceId, workspace.id))
    .orderBy(excelWorkspaceItems.sortOrder);
  const exportItems = items.filter((item) => item.includedInExport);
  const materialIds = materialIdsFromItems(exportItems);
  const materialRows = await loadMaterialRows(db, materialIds);
  const materialsById = new Map(materialRows.map((row) => [row.id, row]));
  const docsByMaterial = await catalogDocumentsByMaterial(db, materialIds);

  const root = await materialProfileRoot();
  const noticeNumber = workspace.noticeNumber ?? workspace.name;
  const prefix = buildMaterialProfileOutputPrefix(noticeNumber);
  const noticeSegment = safePathSegment(
    noticeNumber,
    `workspace-${workspace.id}`,
  );
  const outputDir = path.join(root, noticeSegment, "export", prefix);
  const catalogDir = path.join(outputDir, "Catalog");
  await mkdir(catalogDir, { recursive: true });

  const copiedCatalogByDocKey = new Map<string, string>();
  const usedCatalogNames = new Set<string>();
  const catalogFilesByMaterial = new Map<number, string[]>();
  const manifestRows: Array<Array<string | number | null>> = [];
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
      manifestRows.push([
        item.originalRowIndex,
        material.name,
        material.code ?? "",
        fileName,
        doc.sourceUrl ?? "",
      ]);
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
    headerRow.getCell(colNumber).value =
      editValueForCell(
        workspace.editStateJson,
        targetSheet.name,
        selectedMeta?.activeHeaderRowIndex ?? 1,
        colNumber,
      ) ?? column.header;
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
      row.getCell(colNumber).value =
        editValueForCell(
          workspace.editStateJson,
          targetSheet.name,
          item.originalRowIndex,
          colNumber,
        ) ?? materialValue(material, column.key, item, catalogFiles);
    });
    row.commit();
  }

  const excelFileName = `${prefix}.xlsx`;
  const excelPath = path.join(outputDir, excelFileName);
  await writeFile(excelPath, Buffer.from(await workbook.xlsx.writeBuffer()));

  await writeRowsWorkbook(
    path.join(outputDir, "catalog-manifest.xlsx"),
    "Catalog manifest",
    ["Dòng Excel", "Tên vật tư", "Mã VT", "Catalog file", "Nguồn"],
    manifestRows,
  );
  await writeRowsWorkbook(
    path.join(outputDir, "missing-catalogs.xlsx"),
    "Missing catalogs",
    ["Dòng Excel", "Tên vật tư", "Lý do", "Nguồn"],
    missingRows,
  );

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
    manifestFileName: "catalog-manifest.xlsx",
    missingCatalogFileName: "missing-catalogs.xlsx",
    missingCount: missingRows.length,
    warnings,
  };
}
