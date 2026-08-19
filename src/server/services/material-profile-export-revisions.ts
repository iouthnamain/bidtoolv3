import ExcelJS from "exceljs";
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import {
  isExportableDecision,
  profileEffectiveFieldValues,
} from "~/lib/materials/enrich-gap-fill";
import type { FillableField } from "~/lib/materials/excel-enrich-fields";
import {
  deserializeRowDecision,
  seedDecisionFromItem,
  serializeRowDecision,
} from "~/lib/materials/review-decision";
import type { db as appDb } from "~/server/db";
import {
  excelWorkspaceItems,
  excelWorkspaces,
  materialProfileExportRevisions,
  materials,
} from "~/server/db/schema";

type AppDb = typeof appDb;
type MaterialProfileQueryDb = Pick<AppDb, "select">;
type MaterialProfileLockDb = Pick<AppDb, "execute">;

export const MATERIAL_PROFILE_REVISION_HEADERS = [
  "Sheet nguồn",
  "Dòng nguồn",
  "Mã vật tư",
  "Tên vật tư",
  "ĐVT",
  "Nhóm",
  "Thông số kỹ thuật",
  "Nhà sản xuất",
  "Xuất xứ",
  "Đơn giá",
  "Tiền tệ",
  "URL nguồn",
  "URL catalog",
  "Nhà cung cấp dữ liệu",
  "Độ tin cậy",
  "Trạng thái",
  "Mã trạng thái",
  "Lý do trạng thái",
] as const;

export type MaterialProfileExportMachineStatus =
  | "ready"
  | "needs_review"
  | "skipped"
  | "excluded";

export type MaterialProfileExportDraftRow = {
  itemId: number;
  sourceFingerprint: string;
  sourceSheetName: string;
  sourceRowIndex: number;
  materialId: number | null;
  includedInExport: boolean;
  code: string;
  name: string;
  unit: string;
  category: string;
  specText: string;
  manufacturer: string;
  originCountry: string;
  unitPrice: number | null;
  currency: string;
  sourceUrl: string;
  catalogUrl: string;
  selectedProvider: "catalog" | "web" | "ai" | "sheet";
  confidence: number;
  humanStatus: string;
  machineStatus: MaterialProfileExportMachineStatus;
  machineReasons: string[];
  evidenceUrls: string[];
  decisionSnapshot: Record<string, unknown>;
};

type DraftItem = {
  id: number;
  originalRowIndex: number;
  sourceFingerprint: string;
  isStale: boolean;
  includedInExport: boolean;
  productName: string;
  unit: string;
  specText: string;
  vendorHint: string | null;
  originHint: string | null;
  unitPrice: number | null;
  currency: string;
  originalDataJson: Record<string, unknown>;
  enrichedSnapshotJson: Record<string, unknown>;
  reviewDecisionJson: unknown;
  materialId: number | null;
  matchStatus: "unmatched" | "candidates_found" | "matched" | "manual";
};

type DraftMaterial = {
  id: number;
  name: string;
  code: string | null;
  unit: string;
  category: string | null;
  specText: string;
  manufacturer: string | null;
  originCountry: string | null;
  defaultUnitPrice: number | null;
  currency: string;
  sourceUrl: string | null;
};

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = text(value)
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueUrls(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim() ?? "")
        .filter((value) => /^https?:\/\//i.test(value)),
    ),
  );
}

function catalogFields(material: DraftMaterial | undefined) {
  if (!material) return null;
  return {
    code: material.code ?? "",
    unit: material.unit,
    category: material.category ?? "",
    specText: material.specText,
    manufacturer: material.manufacturer ?? "",
    originCountry: material.originCountry ?? "",
    defaultUnitPrice:
      material.defaultUnitPrice == null
        ? ""
        : String(material.defaultUnitPrice),
    currency: material.currency,
    sourceUrl: material.sourceUrl ?? "",
  } satisfies Partial<Record<FillableField, string>>;
}

function sheetFields(item: DraftItem) {
  const original = item.originalDataJson;
  return {
    code: text(original.code),
    unit: item.unit || text(original.unit),
    category: text(original.category),
    specText: item.specText || text(original.specText),
    manufacturer: item.vendorHint ?? text(original.manufacturer),
    originCountry: item.originHint ?? text(original.originCountry),
    defaultUnitPrice:
      item.unitPrice == null
        ? text(original.defaultUnitPrice)
        : String(item.unitPrice),
    currency: item.currency || text(original.currency) || "VND",
    sourceUrl: text(original.sourceUrl),
  } satisfies Partial<Record<FillableField, string>>;
}

function confidenceFromSnapshot(snapshot: Record<string, unknown>) {
  const score = snapshot.score;
  return typeof score === "number" && Number.isFinite(score)
    ? Math.min(1, Math.max(0, score))
    : 0;
}

function statusForRow(input: {
  includedInExport: boolean;
  skipped: boolean;
  exportable: boolean;
  name: string;
  unit: string;
  specText: string;
  sourceUrl: string;
}) {
  const reasons: string[] = [];
  if (!input.includedInExport) reasons.push("excluded_by_step_3");
  if (input.skipped) reasons.push("skipped_by_reviewer");
  if (!input.name) reasons.push("missing_name");
  if (!input.unit) reasons.push("missing_unit");
  if (!input.specText) reasons.push("missing_specification");
  if (!input.sourceUrl) reasons.push("missing_source_url");
  if (!input.exportable && !input.skipped) reasons.push("unresolved_review");

  const machineStatus: MaterialProfileExportMachineStatus =
    !input.includedInExport
      ? "excluded"
      : input.skipped
        ? "skipped"
        : reasons.length > 0
          ? "needs_review"
          : "ready";
  return {
    machineStatus,
    machineReasons: reasons,
    humanStatus:
      machineStatus === "ready"
        ? "Sẵn sàng"
        : machineStatus === "excluded"
          ? "Đã bỏ khỏi phạm vi"
          : machineStatus === "skipped"
            ? "Đã bỏ qua"
            : "Cần xác minh",
  };
}

export function materialProfileExportDraftRow(input: {
  sourceSheetName: string;
  item: DraftItem;
  material?: DraftMaterial;
}): MaterialProfileExportDraftRow | null {
  if (input.item.isStale) return null;
  const decision =
    deserializeRowDecision(input.item.reviewDecisionJson) ??
    seedDecisionFromItem(input.item);
  const originalFields = sheetFields(input.item);
  const effective = profileEffectiveFieldValues(
    originalFields,
    catalogFields(input.material),
    decision,
  );
  const name =
    [
      decision.editedProfileValues?.name,
      input.material?.name,
      input.item.productName,
    ]
      .map((value) => value?.trim() ?? "")
      .find((value) => value.length > 0) ?? "";
  const sourceUrl = text(effective.sourceUrl);
  const selectedScrape = decision.scrapeResults?.find(
    (result) => result.productKey === decision.selectedScrapeProductKey,
  );
  const evidenceUrls = uniqueUrls([
    sourceUrl,
    ...(decision.webEvidence?.map((entry) => entry.sourceUrl) ?? []),
    ...(decision.aiSearchResult?.sourceUrls ?? []),
    ...(decision.webLinkResults?.map((entry) => entry.url) ?? []),
    selectedScrape?.sourceUrl,
  ]);
  const status = statusForRow({
    includedInExport: input.item.includedInExport,
    skipped: decision.skipped === true,
    exportable: isExportableDecision(decision),
    name,
    unit: text(effective.unit),
    specText: text(effective.specText),
    sourceUrl,
  });

  return {
    itemId: input.item.id,
    sourceFingerprint: input.item.sourceFingerprint,
    sourceSheetName: input.sourceSheetName,
    sourceRowIndex: input.item.originalRowIndex,
    materialId: decision.materialId,
    includedInExport: input.item.includedInExport,
    code: text(effective.code),
    name,
    unit: text(effective.unit),
    category: text(effective.category),
    specText: text(effective.specText),
    manufacturer: text(effective.manufacturer),
    originCountry: text(effective.originCountry),
    unitPrice: finiteNumber(effective.defaultUnitPrice),
    currency: text(effective.currency) || "VND",
    sourceUrl,
    catalogUrl: decision.catalogPdfUrls?.[0]?.trim() ?? "",
    selectedProvider:
      decision.selectedSource ?? (input.material ? "catalog" : "sheet"),
    confidence: confidenceFromSnapshot(input.item.enrichedSnapshotJson),
    ...status,
    evidenceUrls,
    decisionSnapshot: serializeRowDecision(decision) as unknown as Record<
      string,
      unknown
    >,
  };
}

function rowValues(row: MaterialProfileExportDraftRow) {
  return [
    row.sourceSheetName,
    row.sourceRowIndex,
    row.code,
    row.name,
    row.unit,
    row.category,
    row.specText,
    row.manufacturer,
    row.originCountry,
    row.unitPrice ?? "",
    row.currency,
    row.sourceUrl,
    row.catalogUrl,
    row.selectedProvider,
    `${Math.round(row.confidence * 100)}%`,
    row.humanStatus,
    row.machineStatus,
    row.machineReasons.join(";"),
  ];
}

function csvCell(value: string | number | null | undefined) {
  const raw = value == null ? "" : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

function safeFileSegment(value: string) {
  return (
    value
      .trim()
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .replace(/\s+/g, "-")
      .slice(0, 80) || "ho-so-vat-tu"
  );
}

export type MaterialProfileExportRevisionArtifact = Awaited<
  ReturnType<typeof buildMaterialProfileExportRevisionArtifact>
>;

export class MaterialProfileExportRevisionError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "BAD_REQUEST" | "CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "MaterialProfileExportRevisionError";
  }
}

export async function buildMaterialProfileExportRevisionArtifact(input: {
  revisionId: string;
  revisionNumber: number;
  createdAt: string;
  workspace: {
    id: number;
    name: string;
    noticeNumber: string | null;
    sourceFileName: string | null;
    sourceSheetName: string | null;
  };
  rows: Array<MaterialProfileExportDraftRow | null>;
}) {
  const rows = input.rows.filter(
    (row): row is MaterialProfileExportDraftRow => row !== null,
  );
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BidTool v3";
  workbook.created = new Date(input.createdAt);
  workbook.modified = new Date(input.createdAt);
  const sheet = workbook.addWorksheet("Danh mục vật tư");
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  const header = sheet.addRow(MATERIAL_PROFILE_REVISION_HEADERS);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1D4ED8" },
  };
  header.alignment = {
    horizontal: "center",
    vertical: "middle",
    wrapText: true,
  };
  sheet.columns = [
    { width: 22 },
    { width: 12 },
    { width: 18 },
    { width: 34 },
    { width: 12 },
    { width: 22 },
    { width: 42 },
    { width: 24 },
    { width: 18 },
    { width: 16 },
    { width: 12 },
    { width: 48 },
    { width: 48 },
    { width: 20 },
    { width: 14 },
    { width: 18 },
    { width: 18 },
    { width: 42 },
  ];
  for (const row of rows) {
    const excelRow = sheet.addRow(rowValues(row));
    excelRow.alignment = { vertical: "top", wrapText: true };
    excelRow.getCell(10).numFmt = "#,##0";
  }
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: {
      row: Math.max(sheet.rowCount, 1),
      column: MATERIAL_PROFILE_REVISION_HEADERS.length,
    },
  };

  const excelFileName = `${safeFileSegment(
    [input.workspace.noticeNumber, input.workspace.name]
      .map((value) => value?.trim() ?? "")
      .find((value) => value.length > 0) ?? "",
  )}-ban-xuat-${String(input.revisionNumber).padStart(3, "0")}.xlsx`;
  const excelBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const counts = rows.reduce(
    (result, row) => {
      result[row.machineStatus] += 1;
      return result;
    },
    { ready: 0, needs_review: 0, skipped: 0, excluded: 0 },
  );
  const warningsCsv = [
    [
      "source_sheet",
      "source_row",
      "item_id",
      "machine_status",
      "reason_codes",
      "name",
    ],
    ...rows
      .filter((row) => row.machineStatus !== "ready")
      .map((row) => [
        row.sourceSheetName,
        row.sourceRowIndex,
        row.itemId,
        row.machineStatus,
        row.machineReasons.join(";"),
        row.name,
      ]),
  ]
    .map((line) => line.map(csvCell).join(","))
    .join("\r\n");
  const manifest = {
    schemaVersion: 1,
    revision: {
      id: input.revisionId,
      number: input.revisionNumber,
      createdAt: input.createdAt,
      immutable: true,
    },
    workspace: input.workspace,
    summary: { totalRows: rows.length, ...counts },
    files: [
      {
        name: excelFileName,
        mediaType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sha256: createHash("sha256").update(excelBuffer).digest("hex"),
      },
      { name: "manifest.json", mediaType: "application/json" },
      { name: "warnings.csv", mediaType: "text/csv" },
    ],
    rows: rows.map((row) => ({
      itemId: row.itemId,
      sourceFingerprint: row.sourceFingerprint,
      sourceSheetName: row.sourceSheetName,
      sourceRowIndex: row.sourceRowIndex,
      includedInExportAtRevision: row.includedInExport,
      machineStatus: row.machineStatus,
      machineReasons: row.machineReasons,
      selectedProvider: row.selectedProvider,
      sourceUrl: row.sourceUrl,
      evidenceUrls: row.evidenceUrls,
      decision: row.decisionSnapshot,
    })),
  };
  return {
    excelFileName,
    excelBuffer,
    warningsCsv,
    manifest,
    snapshot: {
      headers: [...MATERIAL_PROFILE_REVISION_HEADERS],
      rows,
    },
  };
}

function draftRowRecord(row: MaterialProfileExportDraftRow) {
  return Object.fromEntries(
    MATERIAL_PROFILE_REVISION_HEADERS.map((header, index) => [
      header,
      rowValues(row)[index] ?? "",
    ]),
  ) as Record<
    (typeof MATERIAL_PROFILE_REVISION_HEADERS)[number],
    string | number
  >;
}

async function loadDraftSource(
  db: MaterialProfileQueryDb,
  workspaceId: number,
) {
  const [workspace] = await db
    .select()
    .from(excelWorkspaces)
    .where(eq(excelWorkspaces.id, workspaceId))
    .limit(1);
  if (!workspace) {
    throw new MaterialProfileExportRevisionError(
      "NOT_FOUND",
      "Không tìm thấy hồ sơ vật tư.",
    );
  }
  const items = await db
    .select()
    .from(excelWorkspaceItems)
    .where(eq(excelWorkspaceItems.workspaceId, workspaceId))
    .orderBy(excelWorkspaceItems.sortOrder);
  const currentItems = items.filter((item) => !item.isStale);
  const materialIds = Array.from(
    new Set(
      currentItems
        .map((item) => item.materialId)
        .filter((id): id is number => id != null),
    ),
  );
  const materialRows =
    materialIds.length > 0
      ? await db
          .select()
          .from(materials)
          .where(
            and(
              inArray(materials.id, materialIds),
              isNull(materials.deletedAt),
            ),
          )
      : [];
  const materialsById = new Map(materialRows.map((row) => [row.id, row]));
  const rows = currentItems.map((item) =>
    materialProfileExportDraftRow({
      sourceSheetName: workspace.sourceSheetName ?? "",
      item,
      material:
        item.materialId == null
          ? undefined
          : materialsById.get(item.materialId),
    }),
  );
  return {
    workspace,
    rows: rows.filter(
      (row): row is MaterialProfileExportDraftRow => row !== null,
    ),
  };
}

/** Live Step 4 draft derived from the latest persisted Step 3 decisions. */
export async function previewMaterialProfileExportRevisionDraft(
  db: AppDb,
  workspaceId: number,
) {
  const { rows } = await loadDraftSource(db, workspaceId);
  const issueRows = rows.filter((row) => row.machineStatus !== "ready");
  return {
    headers: [...MATERIAL_PROFILE_REVISION_HEADERS],
    rows: rows.map(draftRowRecord),
    totalRows: rows.length,
    completeRows: rows.length - issueRows.length,
    incompleteRows: issueRows.length,
    canExport: rows.length > 0,
    emptyReason:
      rows.length === 0
        ? "Chưa có dòng vật tư hiện tại để tạo bản xuất. Hãy map và tự xử lý workbook trước."
        : null,
    issues: issueRows.slice(0, 20).map((row) => ({
      originalRowIndex: row.sourceRowIndex,
      name: row.name,
      reasons: row.machineReasons,
      machineStatus: row.machineStatus,
    })),
  };
}

function revisionSummary(value: Record<string, unknown>) {
  const summary =
    value.summary && typeof value.summary === "object"
      ? (value.summary as Record<string, unknown>)
      : {};
  const numberValue = (key: string) => {
    const parsed = Number(summary[key] ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return {
    totalRows: numberValue("totalRows"),
    ready: numberValue("ready"),
    needs_review: numberValue("needs_review"),
    skipped: numberValue("skipped"),
    excluded: numberValue("excluded"),
  };
}

function revisionListItem(
  revision: typeof materialProfileExportRevisions.$inferSelect,
) {
  return {
    id: revision.id,
    workspaceId: revision.workspaceId,
    revisionNumber: revision.revisionNumber,
    excelFileName: revision.excelFileName,
    summary: revision.summaryJson,
    createdAt: revision.createdAt,
  };
}

/**
 * Establishes the revision linearization point before reading Step 3 state.
 * All export creators take the workspace lock first, then lock current rows in
 * stable id order. A concurrent item writer either commits before this snapshot
 * is read or waits until the immutable revision has been stored.
 */
export async function lockMaterialProfileExportRevisionSource(
  db: MaterialProfileLockDb,
  workspaceId: number,
) {
  await db.execute(
    sql`select ${excelWorkspaces.id} from ${excelWorkspaces} where ${excelWorkspaces.id} = ${workspaceId} for update`,
  );
  await db.execute(
    sql`select ${excelWorkspaceItems.id} from ${excelWorkspaceItems} where ${excelWorkspaceItems.workspaceId} = ${workspaceId} and ${excelWorkspaceItems.isStale} = false order by ${excelWorkspaceItems.id} for update`,
  );
}

/** Explicitly freezes the current draft as a new immutable revision. */
export async function createMaterialProfileExportRevision(
  db: AppDb,
  workspaceId: number,
) {
  return db.transaction(async (tx) => {
    await lockMaterialProfileExportRevisionSource(tx, workspaceId);
    const { workspace, rows } = await loadDraftSource(tx, workspaceId);
    if (rows.length === 0) {
      throw new MaterialProfileExportRevisionError(
        "BAD_REQUEST",
        "Chưa có dòng vật tư hiện tại để tạo bản xuất.",
      );
    }
    const [latest] = await tx
      .select({ revisionNumber: materialProfileExportRevisions.revisionNumber })
      .from(materialProfileExportRevisions)
      .where(eq(materialProfileExportRevisions.workspaceId, workspaceId))
      .orderBy(desc(materialProfileExportRevisions.revisionNumber))
      .limit(1);
    const revisionNumber = (latest?.revisionNumber ?? 0) + 1;
    const revisionId = randomUUID();
    const createdAt = new Date().toISOString();
    const artifact = await buildMaterialProfileExportRevisionArtifact({
      revisionId,
      revisionNumber,
      createdAt,
      workspace: {
        id: workspace.id,
        name: workspace.name,
        noticeNumber: workspace.noticeNumber,
        sourceFileName: workspace.sourceFileName,
        sourceSheetName: workspace.sourceSheetName,
      },
      rows,
    });
    const summary = revisionSummary(artifact.manifest);
    const [created] = await tx
      .insert(materialProfileExportRevisions)
      .values({
        id: revisionId,
        workspaceId,
        revisionNumber,
        excelFileName: artifact.excelFileName,
        workbookBase64: artifact.excelBuffer.toString("base64"),
        sourceSnapshotJson: artifact.snapshot as unknown as Record<
          string,
          unknown
        >,
        manifestJson: artifact.manifest as unknown as Record<string, unknown>,
        warningsCsv: artifact.warningsCsv,
        summaryJson: summary,
        createdAt,
      })
      .returning();
    if (!created) {
      throw new MaterialProfileExportRevisionError(
        "CONFLICT",
        "Không tạo được bản xuất mới. Hãy thử lại.",
      );
    }
    await tx
      .update(excelWorkspaces)
      .set({
        status: "catalog_generated",
        exportFileName: artifact.excelFileName,
        exportedAt: createdAt,
        updatedAt: createdAt,
      })
      .where(eq(excelWorkspaces.id, workspaceId));
    return revisionListItem(created);
  });
}

export async function listMaterialProfileExportRevisions(
  db: AppDb,
  workspaceId: number,
) {
  const [workspace] = await db
    .select({ id: excelWorkspaces.id })
    .from(excelWorkspaces)
    .where(eq(excelWorkspaces.id, workspaceId))
    .limit(1);
  if (!workspace) {
    throw new MaterialProfileExportRevisionError(
      "NOT_FOUND",
      "Không tìm thấy hồ sơ vật tư.",
    );
  }
  const rows = await db
    .select()
    .from(materialProfileExportRevisions)
    .where(eq(materialProfileExportRevisions.workspaceId, workspaceId))
    .orderBy(desc(materialProfileExportRevisions.revisionNumber));
  return rows.map(revisionListItem);
}

/** Returns only bytes frozen on creation; no live Step 3 data is consulted. */
export async function downloadMaterialProfileExportRevision(
  db: AppDb,
  input: { workspaceId: number; revisionId: string },
) {
  const [revision] = await db
    .select()
    .from(materialProfileExportRevisions)
    .where(
      and(
        eq(materialProfileExportRevisions.workspaceId, input.workspaceId),
        eq(materialProfileExportRevisions.id, input.revisionId),
      ),
    )
    .limit(1);
  if (!revision) {
    throw new MaterialProfileExportRevisionError(
      "NOT_FOUND",
      "Không tìm thấy bản xuất đã chọn.",
    );
  }
  const prefix = revision.excelFileName.replace(/\.xlsx$/i, "");
  return {
    revision: revisionListItem(revision),
    zipFileName: `${prefix}.zip`,
    files: [
      {
        fileName: revision.excelFileName,
        encoding: "base64" as const,
        content: revision.workbookBase64,
      },
      {
        fileName: "manifest.json",
        encoding: "utf8" as const,
        content: `${JSON.stringify(revision.manifestJson, null, 2)}\n`,
      },
      {
        fileName: "warnings.csv",
        encoding: "utf8" as const,
        content: revision.warningsCsv,
      },
    ],
  };
}
