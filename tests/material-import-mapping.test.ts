import { readFileSync } from "node:fs";
import path from "node:path";

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  parseWorkbookBase64,
  rowsFromMapping,
} from "~/server/services/excel-workbook";

function workbookBase64FromHeaders(
  headers: string[],
  rows: string[][],
): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Materials");
  sheet.addRow(headers);
  for (const row of rows) {
    sheet.addRow(row);
  }
  return workbook.xlsx.writeBuffer().then((buffer) =>
    Buffer.from(buffer).toString("base64"),
  );
}

describe("material import column mapping", () => {
  it("maps NCC and Xuất xứ headers used in demo catalog sheets", async () => {
    const workbookBase64 = await workbookBase64FromHeaders(
      [
        "Mã VT",
        "Tên vật tư",
        "ĐVT",
        "Nhóm vật tư",
        "Thông số kỹ thuật",
        "NCC",
        "Xuất xứ",
        "Đơn giá",
      ],
      [
        [
          "VT-001",
          "Dây điện VCm 0.5mm2",
          "m",
          "Điện",
          "VCm 0.5mm2",
          "Cadivi",
          "Việt Nam",
          "5000",
        ],
      ],
    );

    const workbook = await parseWorkbookBase64(
      "demo-catalog.xlsx",
      workbookBase64,
    );
    const sheet = workbook.sheets[0]!;

    expect(sheet.suggestedMapping.vendorHint).toBe("NCC");
    expect(sheet.suggestedMapping.originHint).toBe("Xuất xứ");

    const [row] = rowsFromMapping(sheet, sheet.suggestedMapping);
    expect(row).toMatchObject({
      materialName: "Dây điện VCm 0.5mm2",
      vendorHint: "Cadivi",
      originHint: "Việt Nam",
      unitPrice: 5000,
    });
  });

  it("maps demo catalog fixture when present", async () => {
    const fixturePath = path.join(
      process.cwd(),
      "docs/demo/demo-catalog-6.xlsx",
    );
    let workbookBase64: string;
    try {
      workbookBase64 = readFileSync(fixturePath).toString("base64");
    } catch {
      return;
    }

    const workbook = await parseWorkbookBase64(
      "demo-catalog-6.xlsx",
      workbookBase64,
    );
    const sheet = workbook.sheets[0]!;

    expect(sheet.suggestedMapping.vendorHint).toBeTruthy();
    expect(sheet.suggestedMapping.originHint).toBeTruthy();

    const rows = rowsFromMapping(sheet, sheet.suggestedMapping);
    expect(rows[0]?.vendorHint).toBeTruthy();
    expect(rows[0]?.originHint).toBeTruthy();
  });
});
