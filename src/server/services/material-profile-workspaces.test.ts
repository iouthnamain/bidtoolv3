import { describe, expect, it } from "vitest";

import {
  buildOpenFolderCommand,
  buildMaterialProfileOutputPrefix,
  MATERIAL_PROFILE_EXPORT_COLUMNS,
  isMaterialProfileExportRowDeleted,
  parseMaterialProfileExportEditState,
  sanitizeMaterialProfilePathSegment,
  sanitizeMaterialProfileWorkbookFileName,
  shouldBulkApplyMaterialProfileCandidate,
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

    expect(prefix).toBe("IB2600190527-00 - 20260623-1030");
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
});
