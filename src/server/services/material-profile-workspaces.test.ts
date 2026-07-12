import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertExportDirWritable,
  buildOpenFolderCommand,
  buildMaterialProfileOutputPrefix,
  canExportMaterialProfileCleanItems,
  MATERIAL_PROFILE_EXPORT_COLUMNS,
  isMaterialProfileExportRowDeleted,
  MaterialProfileWorkspaceError,
  parseMaterialProfileExportEditState,
  resolveDefaultDownloadsDir,
  resolveMaterialProfileStorageRoot,
  resolveWorkspaceWorkbookBuffer,
  sanitizeMaterialProfilePathSegment,
  sanitizeMaterialProfileWorkbookFileName,
  selectMaterialProfileCleanExportItems,
  shouldBulkApplyMaterialProfileCandidate,
  summarizeMaterialProfileReviewReadiness,
  summarizeMaterialProfileExportEditState,
} from "~/server/services/material-profile-workspaces";

describe("material profile workspace helpers", () => {
  it("sanitizes path segments without dropping Vietnamese text", () => {
    expect(
      sanitizeMaterialProfilePathSegment("IB2600190527-00", "fallback"),
    ).toBe("IB2600190527-00");
    expect(
      sanitizeMaterialProfilePathSegment("../Hồ sơ: vật tư", "fallback"),
    ).toBe("_Hồ sơ_ vật tư");
    expect(sanitizeMaterialProfilePathSegment("   ", "fallback")).toBe(
      "fallback",
    );
  });

  it("keeps xlsx output names safe", () => {
    expect(sanitizeMaterialProfileWorkbookFileName("bang vat tu.xlsx")).toBe(
      "bang vat tu.xlsx",
    );
    expect(sanitizeMaterialProfileWorkbookFileName("../bad.xlsm")).toBe(
      "bad.xlsm.xlsx",
    );
  });

  it("builds output prefix from Số TBMT and timestamp without enriched text", () => {
    const date = new Date(2026, 5, 23, 10, 30);
    const prefix = buildMaterialProfileOutputPrefix("IB2600190527-00", date);

    expect(prefix).toBe("IB2600190527-00_20260623_1030");
    expect(prefix).not.toContain("enriched");
  });

  it("exports the material fields as appended BidTool columns", () => {
    expect(
      MATERIAL_PROFILE_EXPORT_COLUMNS.map((column) => column.header),
    ).toEqual([
      "BT - Match status",
      "BT - Tên vật tư",
      "BT - Mã VT",
      "BT - ĐVT",
      "BT - Nhóm",
      "BT - Thông số",
      "BT - NCC",
      "BT - Xuất xứ",
      "BT - Đơn giá",
      "BT - Tiền tệ",
      "BT - Nguồn",
      "BT - Catalog files",
    ]);
  });

  it("keeps every current clean-export row even when legacy export inclusion is off", () => {
    const rows = [
      { id: 1, isStale: false, includedInExport: true },
      { id: 2, isStale: false, includedInExport: false },
      { id: 3, isStale: true, includedInExport: true },
      { id: 4, isStale: true, includedInExport: false },
    ];

    expect(selectMaterialProfileCleanExportItems(rows)).toEqual([
      rows[0],
      rows[1],
    ]);
  });

  it("allows clean export when current rows have validation warnings", () => {
    expect(
      canExportMaterialProfileCleanItems([
        { promotable: false, reasons: ["Thiếu dữ liệu"] },
      ]),
    ).toBe(true);
    expect(canExportMaterialProfileCleanItems([])).toBe(false);
  });

  it("builds a platform-specific open-folder command", () => {
    const command = buildOpenFolderCommand("/tmp/bidtool-output");

    expect(command.command.length).toBeGreaterThan(0);
    expect(command.args).toContain("/tmp/bidtool-output");
  });

  it("normalizes export edit state and summarizes workbook edits", () => {
    const state = parseMaterialProfileExportEditState({
      cellEdits: {
        "Sheet 1": {
          "1:2": "Tên mới",
          bad: "ignored",
        },
      },
      deletedRows: {
        "Sheet 1": [3, 3, "4", -1],
      },
      deletedColumns: {
        "Sheet 1": [2, 7],
      },
      updatedAt: "2026-06-23T10:30:00.000Z",
    });

    expect(state.cellEdits["Sheet 1"]).toEqual({ "1:2": "Tên mới" });
    expect(state.deletedRows["Sheet 1"]).toEqual([3, 4]);
    expect(state.deletedColumns["Sheet 1"]).toEqual([2, 7]);
    expect(summarizeMaterialProfileExportEditState(state, "Sheet 1")).toEqual({
      editedCellCount: 1,
      deletedRowCount: 2,
      deletedColumnCount: 2,
      deletedMaterialRowCount: 2,
    });
  });

  it("detects deleted material rows for export/catalog alignment", () => {
    const state = parseMaterialProfileExportEditState({
      deletedRows: {
        Materials: [5],
      },
    });

    expect(isMaterialProfileExportRowDeleted("Materials", 5, state)).toBe(true);
    expect(isMaterialProfileExportRowDeleted("Materials", 6, state)).toBe(
      false,
    );
  });

  it("uses the bulk apply threshold for high-confidence matches", () => {
    expect(shouldBulkApplyMaterialProfileCandidate(0.85)).toBe(true);
    expect(shouldBulkApplyMaterialProfileCandidate(0.849)).toBe(false);
    expect(shouldBulkApplyMaterialProfileCandidate(0.8, 0.8)).toBe(true);
    expect(shouldBulkApplyMaterialProfileCandidate("0.95")).toBe(false);
  });

  it("summarizes review readiness with skipped and unresolved rows", () => {
    const readiness = summarizeMaterialProfileReviewReadiness([
      {
        id: 1,
        originalRowIndex: 2,
        materialId: 10,
        matchStatus: "matched",
        reviewDecisionJson: {},
        enrichedSnapshotJson: {
          status: "auto",
          fillPlan: [{ action: "filled", field: "specText" }],
        },
      },
      {
        id: 2,
        originalRowIndex: 3,
        materialId: null,
        matchStatus: "unmatched",
        reviewDecisionJson: {
          materialId: null,
          acceptedFields: [],
          skipped: true,
        },
        enrichedSnapshotJson: { status: "unmatched" },
      },
      {
        id: 3,
        originalRowIndex: 4,
        materialId: null,
        matchStatus: "unmatched",
        reviewDecisionJson: {},
        enrichedSnapshotJson: { status: "unmatched" },
      },
    ]);

    expect(readiness).toMatchObject({
      totalRows: 3,
      resolvedRows: 2,
      exportableRows: 1,
      skippedRows: 1,
      unresolvedRows: 1,
      canExportWithWarnings: true,
    });
    expect(readiness.warnings[0]).toContain("Còn 1 dòng chưa chọn hoặc bỏ qua");
  });

  it("resolves the default downloads directory from the user home", () => {
    const result = resolveDefaultDownloadsDir();

    expect(result).toBe(path.join(os.homedir(), "Downloads"));
  });

  it("accepts writable export directories and creates missing folders", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "bidtool-export-"));
    const targetDir = path.join(tempRoot, "nested", "export");

    await expect(assertExportDirWritable(targetDir)).resolves.toBe(targetDir);

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("rejects empty export paths and file paths", async () => {
    await expect(assertExportDirWritable("   ")).rejects.toBeInstanceOf(
      MaterialProfileWorkspaceError,
    );

    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "bidtool-export-"));
    const filePath = path.join(tempRoot, "not-a-dir.txt");
    await writeFile(filePath, "x");

    await expect(assertExportDirWritable(filePath)).rejects.toBeInstanceOf(
      MaterialProfileWorkspaceError,
    );

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("rejects forbidden system export paths", async () => {
    if (process.platform === "win32") {
      await expect(assertExportDirWritable("C:\\")).rejects.toBeInstanceOf(
        MaterialProfileWorkspaceError,
      );
      return;
    }

    await expect(assertExportDirWritable("/etc")).rejects.toBeInstanceOf(
      MaterialProfileWorkspaceError,
    );
  });
});

describe("material profile storage root", () => {
  it("prefers configured export dir over serverless default", () => {
    expect(
      resolveMaterialProfileStorageRoot("/custom/material-profiles", {
        serverless: true,
      }),
    ).toBe(path.resolve("/custom/material-profiles"));
  });

  it("uses tmpdir on serverless when unconfigured", () => {
    expect(resolveMaterialProfileStorageRoot(null, { serverless: true })).toBe(
      path.join(os.tmpdir(), "bidtool", "material-profiles"),
    );
  });

  it("uses cwd/data for local dev when unconfigured", () => {
    expect(resolveMaterialProfileStorageRoot(null, { serverless: false })).toBe(
      path.join(process.cwd(), "data", "material-profiles"),
    );
  });
});

describe("resolveWorkspaceWorkbookBuffer", () => {
  it("reads from disk when sourceWorkbookPath exists", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "bidtool-workbook-"));
    const filePath = path.join(tempRoot, "workbook.xlsx");
    const content = Buffer.from("excel-bytes");
    await writeFile(filePath, content);

    await expect(
      resolveWorkspaceWorkbookBuffer({
        sourceWorkbookPath: filePath,
        workbookJson: {
          sourceWorkbookBase64: Buffer.from("fallback").toString("base64"),
        },
      }),
    ).resolves.toEqual(content);

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("falls back to sourceWorkbookBase64 when disk path is missing", async () => {
    const content = Buffer.from("excel-from-db");
    const base64 = content.toString("base64");

    await expect(
      resolveWorkspaceWorkbookBuffer({
        sourceWorkbookPath: "/tmp/does-not-exist/workbook.xlsx",
        workbookJson: { sourceWorkbookBase64: base64 },
      }),
    ).resolves.toEqual(content);
  });

  it("throws BAD_REQUEST when neither disk nor DB blob is available", async () => {
    await expect(
      resolveWorkspaceWorkbookBuffer({
        sourceWorkbookPath: null,
        workbookJson: { sheets: [] },
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Chưa upload file Excel cho work này.",
    });
  });
});
