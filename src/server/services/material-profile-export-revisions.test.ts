import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  buildMaterialProfileExportRevisionArtifact,
  lockMaterialProfileExportRevisionSource,
  materialProfileExportDraftRow,
} from "~/server/services/material-profile-export-revisions";

describe("material profile export revisions", () => {
  it("locks the workspace and then every current Step 3 row before snapshot reads", async () => {
    const executed: unknown[] = [];
    const db = {
      execute: async (query: unknown) => {
        executed.push(query);
        return [];
      },
    };

    await lockMaterialProfileExportRevisionSource(db as never, 17);

    expect(executed).toHaveLength(2);
    const queryInfo = executed.map((query) => {
      const sqlQuery = query as {
        usedTables?: string[];
        queryChunks?: Array<{ value?: string[]; name?: string }>;
      };
      return {
        tables: sqlQuery.usedTables ?? [],
        columns: (sqlQuery.queryChunks ?? [])
          .map((chunk) => chunk.name)
          .filter((name): name is string => typeof name === "string"),
        text: (sqlQuery.queryChunks ?? [])
          .flatMap((chunk) => chunk.value ?? [])
          .join(""),
      };
    });
    expect(queryInfo[0]?.tables).toEqual(["excel_workspaces"]);
    expect(queryInfo[0]?.text).toContain("for update");
    expect(queryInfo[1]?.tables).toEqual(["excel_workspace_items"]);
    expect(queryInfo[1]?.columns).toContain("is_stale");
    expect(queryInfo[1]?.columns).toContain("workspace_id");
    expect(queryInfo[1]?.text).toContain("order by");
    expect(queryInfo[1]?.text).toContain("for update");
  });

  it("uses the persisted Step 3 decision and retains excluded, skipped, and incomplete rows", async () => {
    const rows = [
      materialProfileExportDraftRow({
        sourceSheetName: "BOQ",
        item: {
          id: 11,
          originalRowIndex: 7,
          sourceFingerprint: "source-11",
          isStale: false,
          includedInExport: true,
          productName: "Dây điện cũ",
          unit: "m",
          specText: "VCm 0.5mm2",
          vendorHint: null,
          originHint: null,
          unitPrice: null,
          currency: "VND",
          originalDataJson: {},
          enrichedSnapshotJson: { score: 0.91 },
          reviewDecisionJson: {
            materialId: 42,
            acceptedFields: [
              "code",
              "unit",
              "category",
              "specText",
              "manufacturer",
              "originCountry",
              "defaultUnitPrice",
              "currency",
              "sourceUrl",
            ],
            editedProfileValues: { name: "Dây điện đã duyệt" },
            editedValues: {
              code: "VT-STEP3",
              unit: "m",
              category: "Điện Bước 3",
              specText: "VCm 0.5mm2",
              manufacturer: "CADIVI từ Bước 3",
              originCountry: "Việt Nam",
              defaultUnitPrice: "5000",
              currency: "VND",
              sourceUrl: "https://example.test/day-dien",
            },
            selectedSource: "web",
          },
          materialId: 42,
          matchStatus: "manual",
        },
        material: {
          id: 42,
          name: "Tên trong /materials",
          code: "VT-42",
          unit: "m",
          category: "Điện",
          specText: "VCm 0.5mm2",
          manufacturer: "Catalog Corp",
          originCountry: "Việt Nam",
          defaultUnitPrice: 5000,
          currency: "VND",
          sourceUrl: "https://catalog.test/42",
        },
      }),
      materialProfileExportDraftRow({
        sourceSheetName: "BOQ",
        item: {
          id: 12,
          originalRowIndex: 8,
          sourceFingerprint: "source-12",
          isStale: false,
          includedInExport: false,
          productName: "Dòng không đưa vào export",
          unit: "",
          specText: "",
          vendorHint: null,
          originHint: null,
          unitPrice: null,
          currency: "VND",
          originalDataJson: {},
          enrichedSnapshotJson: {},
          reviewDecisionJson: { materialId: null, acceptedFields: [] },
          materialId: null,
          matchStatus: "unmatched",
        },
      }),
      materialProfileExportDraftRow({
        sourceSheetName: "BOQ",
        item: {
          id: 13,
          originalRowIndex: 9,
          sourceFingerprint: "source-13",
          isStale: false,
          includedInExport: true,
          productName: "Dòng bỏ qua",
          unit: "cái",
          specText: "",
          vendorHint: null,
          originHint: null,
          unitPrice: null,
          currency: "VND",
          originalDataJson: {},
          enrichedSnapshotJson: {},
          reviewDecisionJson: {
            materialId: null,
            acceptedFields: [],
            skipped: true,
          },
          materialId: null,
          matchStatus: "unmatched",
        },
      }),
    ];

    const currentRows = rows.filter((row) => row !== null);
    expect(currentRows.map((row) => row.machineStatus)).toEqual([
      "ready",
      "excluded",
      "skipped",
    ]);
    expect(currentRows[0]).toMatchObject({
      sourceSheetName: "BOQ",
      sourceRowIndex: 7,
      name: "Dây điện đã duyệt",
      manufacturer: "CADIVI từ Bước 3",
      sourceUrl: "https://example.test/day-dien",
      selectedProvider: "web",
    });
    expect(currentRows[1]?.machineReasons).toContain("excluded_by_step_3");
    expect(currentRows[2]?.machineReasons).toContain("skipped_by_reviewer");

    const artifact = await buildMaterialProfileExportRevisionArtifact({
      revisionId: "11111111-1111-4111-8111-111111111111",
      revisionNumber: 3,
      createdAt: "2026-08-20T09:30:00.000Z",
      workspace: {
        id: 5,
        name: "Hồ sơ thử",
        noticeNumber: "IB-001",
        sourceFileName: "boq.xlsx",
        sourceSheetName: "BOQ",
      },
      rows,
    });

    expect(artifact.snapshot.rows).toHaveLength(3);
    expect(artifact.manifest.files.map((file) => file.name)).toEqual([
      artifact.excelFileName,
      "manifest.json",
      "warnings.csv",
    ]);
    expect(artifact.warningsCsv).toContain("excluded_by_step_3");
    expect(artifact.warningsCsv).toContain("skipped_by_reviewer");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      artifact.excelBuffer as unknown as Parameters<
        typeof workbook.xlsx.load
      >[0],
    );
    const sheet = workbook.getWorksheet("Danh mục vật tư");
    expect(sheet?.getRow(1).values).toEqual([
      undefined,
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
    ]);
    expect(sheet?.getRow(2).values).toEqual([
      undefined,
      "BOQ",
      7,
      "VT-STEP3",
      "Dây điện đã duyệt",
      "m",
      "Điện Bước 3",
      "VCm 0.5mm2",
      "CADIVI từ Bước 3",
      "Việt Nam",
      5000,
      "VND",
      "https://example.test/day-dien",
      "",
      "web",
      "91%",
      "Sẵn sàng",
      "ready",
      "",
    ]);
    expect(sheet?.getRow(2).getCell(10).numFmt).toBe("#,##0");
    expect(sheet?.getRow(3).getCell(17).value).toBe("excluded");
    expect(sheet?.getRow(4).getCell(17).value).toBe("skipped");
  });

  it("drops stale rows before freezing the revision", async () => {
    const stale = materialProfileExportDraftRow({
      sourceSheetName: "Sheet1",
      item: {
        id: 9,
        originalRowIndex: 2,
        sourceFingerprint: "stale",
        isStale: true,
        includedInExport: true,
        productName: "Cũ",
        unit: "m",
        specText: "x",
        vendorHint: null,
        originHint: null,
        unitPrice: null,
        currency: "VND",
        originalDataJson: {},
        enrichedSnapshotJson: {},
        reviewDecisionJson: { materialId: null, acceptedFields: [] },
        materialId: null,
        matchStatus: "unmatched",
      },
    });

    expect(stale).toBeNull();
  });
});
