import { readFileSync } from "node:fs";

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  normalizeToken,
  parseOptionalNumber,
  parseWorkbookBase64,
  rowsFromMapping,
} from "~/server/services/excel-workbook";

function sampleBase64(path: string) {
  return readFileSync(path).toString("base64");
}

const materialFixtureDir = "tests/fixtures/materials";

describe("standard Excel workbook parser", () => {
  it("detects and maps the Long Thanh sample header row", async () => {
    const workbook = await parseWorkbookBase64(
      "khoa điện long thành.xlsx",
      sampleBase64(`${materialFixtureDir}/khoa điện long thành.xlsx`),
    );
    const sheet = workbook.sheets[0]!;

    expect(sheet.detectedHeaderRowIndex).toBe(1);
    expect(sheet.suggestedMapping.materialName).toBe("TÊN QUI CÁCH VẬT TƯ");
    expect(sheet.suggestedMapping.specText).toBe("THÔNG SỐ KĨ THUẬT");
    expect(sheet.suggestedMapping.unit).toBe("ĐVT");
    expect(sheet.suggestedMapping.originHint).toBe("XUẤT XỨ");
    expect(sheet.suggestedMapping.unitPrice).toBe("ĐƠN GIÁ");
    expect(sheet.suggestedMapping.qtyTotal).toBe("SL");

    const rows = rowsFromMapping(sheet, sheet.suggestedMapping);
    expect(rows[0]).toMatchObject({
      materialName: "Van tiết lưu 1 chiều M5 Φ4 (SL4-M5)",
      unit: "Cái",
      qtyTotal: 30,
      unitPrice: 15000,
    });
  });

  it("detects row 4 and suffixes duplicate headers in the Bang ke sample", async () => {
    const workbook = await parseWorkbookBase64(
      "Copy of Bảng kê VT.xlsx",
      sampleBase64(
        `${materialFixtureDir}/Copy of Bảng kê  VT -22- 3-2025 (chốt).xlsx`,
      ),
    );
    const sheet = workbook.sheets[0]!;

    expect(sheet.detectedHeaderRowIndex).toBe(4);
    expect(sheet.headers).toContain("Thông số kỹ thuật");
    expect(sheet.headers).toContain("Thông số kỹ thuật (2)");
    expect(sheet.suggestedMapping.materialName).toBe("Tên Vật tư");
    expect(sheet.suggestedMapping.unit).toBe("Đơn vị tính");
    expect(sheet.suggestedMapping.qtyTotal).toBe("Số lượng");
  });

  it("maps Details headers to row notes", async () => {
    const source = new ExcelJS.Workbook();
    const sheet = source.addWorksheet("Materials");
    sheet.addRow(["Name", "Unit", "Details"]);
    sheet.addRow(["Cable", "m", "Install in conduit"]);

    const buffer = await source.xlsx.writeBuffer();
    const workbook = await parseWorkbookBase64(
      "details.xlsx",
      Buffer.from(buffer).toString("base64"),
    );
    const parsedSheet = workbook.sheets[0]!;

    expect(parsedSheet.suggestedMapping.notes).toBe("Details");
    expect(
      rowsFromMapping(parsedSheet, parsedSheet.suggestedMapping)[0],
    ).toMatchObject({
      notes: "Install in conduit",
    });
  });

  it("parses the provided sample material workbooks without phantom row warnings", async () => {
    const sampleOne = await parseWorkbookBase64(
      "sample materials 1.xlsx",
      sampleBase64(`${materialFixtureDir}/sample materials 1.xlsx`),
    );
    const sampleOneSheet = sampleOne.sheets[0]!;
    const sampleOneRows = rowsFromMapping(
      sampleOneSheet,
      sampleOneSheet.suggestedMapping,
    );

    expect(sampleOne.warnings).toEqual([]);
    expect(sampleOneSheet.name).toBe("Tổng hợp");
    expect(sampleOneSheet.rows).toHaveLength(618);
    expect(sampleOneRows).toHaveLength(471);
    expect(sampleOneRows[0]).toMatchObject({
      materialName: "Dây điện đơn mềm VCm 0.5mm2",
      unit: "m",
      vendorHint: "Cadivi",
      originHint: "Việt Nam",
      unitPrice: 5000,
    });

    const sampleTwo = await parseWorkbookBase64(
      "sample materials 2.xlsx",
      sampleBase64(`${materialFixtureDir}/sample materials 2.xlsx`),
    );
    const sampleTwoSheet = sampleTwo.sheets[0]!;
    const sampleTwoRows = rowsFromMapping(
      sampleTwoSheet,
      sampleTwoSheet.suggestedMapping,
    );

    expect(sampleTwo.warnings).toEqual([]);
    expect(sampleTwoSheet.name).toBe("Sheet1");
    expect(sampleTwoSheet.rows).toHaveLength(71);
    expect(sampleTwoRows).toHaveLength(68);
    expect(sampleTwoRows[0]).toMatchObject({
      materialName: "Van tiết lưu 1 chiều M5 Φ4 (SL4-M5)",
      unit: "Cái",
      vendorHint: "OEM",
      originHint: "Việt Nam",
      unitPrice: 15000,
    });
  });

  it("rejects legacy xls files", async () => {
    await expect(
      parseWorkbookBase64(
        "Tong hop vat tu Khoa co khi nam hoc 2026-2027.final.xls",
        sampleBase64(
          `${materialFixtureDir}/Tong hop vat tu Khoa co khi nam hoc 2026-2027.final.xls`,
        ),
      ),
    ).rejects.toThrow(".xlsx");
  });

  it("normalizes Vietnamese d-stroke before accent stripping", () => {
    expect(normalizeToken("ĐVT")).toBe("dvt");
    expect(normalizeToken("Đơn vị tính")).toBe("don vi tinh");
  });

  it("parses localized numeric strings used in material imports", () => {
    expect(parseOptionalNumber("2.600.000 VND")).toBe(2600000);
    expect(parseOptionalNumber("2,600,000 VND")).toBe(2600000);
    expect(parseOptionalNumber("1.234,56")).toBe(1234.56);
    expect(parseOptionalNumber("1,234.56")).toBe(1234.56);
    expect(parseOptionalNumber("1,5")).toBe(1.5);
    expect(parseOptionalNumber("1.5")).toBe(1.5);
  });
});
