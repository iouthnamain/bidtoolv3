import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  normalizeToken,
  parseWorkbookBase64,
  rowsFromMapping,
} from "~/server/services/excel-workbook";

function sampleBase64(path: string) {
  return readFileSync(path).toString("base64");
}

describe("standard Excel workbook parser", () => {
  it("detects and maps the Long Thanh sample header row", async () => {
    const workbook = await parseWorkbookBase64(
      "khoa điện long thành.xlsx",
      sampleBase64("docs/sample/khoa điện long thành.xlsx"),
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
      sampleBase64("docs/sample/Copy of Bảng kê  VT -22- 3-2025 (chốt).xlsx"),
    );
    const sheet = workbook.sheets[0]!;

    expect(sheet.detectedHeaderRowIndex).toBe(4);
    expect(sheet.headers).toContain("Thông số kỹ thuật");
    expect(sheet.headers).toContain("Thông số kỹ thuật (2)");
    expect(sheet.suggestedMapping.materialName).toBe("Tên Vật tư");
    expect(sheet.suggestedMapping.unit).toBe("Đơn vị tính");
    expect(sheet.suggestedMapping.qtyTotal).toBe("Số lượng");
  });

  it("rejects legacy xls files", async () => {
    await expect(
      parseWorkbookBase64(
        "Tong hop vat tu Khoa co khi nam hoc 2026-2027.final.xls",
        sampleBase64(
          "docs/sample/Tong hop vat tu Khoa co khi nam hoc 2026-2027.final.xls",
        ),
      ),
    ).rejects.toThrow(".xlsx");
  });

  it("normalizes Vietnamese d-stroke before accent stripping", () => {
    expect(normalizeToken("ĐVT")).toBe("dvt");
    expect(normalizeToken("Đơn vị tính")).toBe("don vi tinh");
  });
});
