import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  buildFillPlan,
  classifyStatus,
  decodeBase64ForTest,
  rowToScrapedProduct,
  writeEnrichedWorkbook,
  type FillableField,
} from "~/server/services/excel-enrich";
import { suggestColumnMapping } from "~/server/services/excel-workbook";
import type { materials } from "~/server/db/schema";

type MaterialRow = typeof materials.$inferSelect;

/** Read a cell as plain text without tripping no-base-to-string on objects. */
function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "object") {
    const record = value as { text?: unknown; result?: unknown };
    if (typeof record.text === "string") return record.text;
    if (record.result != null) return cellText(record.result as ExcelJS.CellValue);
    return "";
  }
  return String(value);
}

function material(
  overrides: Partial<MaterialRow> & { name: string },
): MaterialRow {
  return {
    id: 1,
    code: null,
    unit: "cái",
    category: null,
    specText: "",
    manufacturer: null,
    originCountry: null,
    defaultUnitPrice: null,
    currency: "VND",
    sourceUrl: null,
    imageUrl: null,
    defaultDepreciation: 1,
    defaultReusePct: 0,
    metadataJson: {},
    deletedAt: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  } as MaterialRow;
}

describe("buildFillPlan", () => {
  it("fills blank sheet fields from the matched material", () => {
    const plan = buildFillPlan(
      { unit: "", manufacturer: "" },
      material({ name: "Ống", unit: "m", manufacturer: "Bình Minh" }),
    );
    const unit = plan.find((c) => c.field === "unit");
    const mfr = plan.find((c) => c.field === "manufacturer");
    expect(unit?.action).toBe("filled");
    expect(unit?.after).toBe("m");
    expect(mfr?.action).toBe("filled");
    expect(mfr?.after).toBe("Bình Minh");
  });

  it("keeps existing sheet values (sheet wins)", () => {
    const plan = buildFillPlan(
      { unit: "cuộn" },
      material({ name: "Dây", unit: "m" }),
    );
    const unit = plan.find((c) => c.field === "unit");
    expect(unit?.action).toBe("kept");
    expect(unit?.after).toBe("cuộn");
  });

  it("omits fields missing on both sides", () => {
    const plan = buildFillPlan({ category: "" }, material({ name: "X" }));
    expect(plan.find((c) => c.field === "category")).toBeUndefined();
  });

  it("overwrites only when force-overwrite is set", () => {
    const plan = buildFillPlan(
      { unit: "cuộn" },
      material({ name: "Dây", unit: "m" }),
      new Set<FillableField>(["unit"]),
    );
    const unit = plan.find((c) => c.field === "unit");
    expect(unit?.action).toBe("overwritten");
    expect(unit?.after).toBe("m");
  });

  it("treats a null material as no fill source", () => {
    const plan = buildFillPlan({ unit: "" }, null);
    expect(plan).toHaveLength(0);
  });
});

describe("rowToScrapedProduct", () => {
  it("maps row fields into the matcher input shape", () => {
    const product = rowToScrapedProduct({
      name: "Ống nhựa",
      unit: "m",
      manufacturer: "Bình Minh",
      defaultUnitPrice: "25.000",
    });
    expect(product.name).toBe("Ống nhựa");
    expect(product.unit).toBe("m");
    expect(product.manufacturer).toBe("Bình Minh");
    expect(product.price).toBe(25000);
    expect(product.currency).toBe("VND");
  });

  it("defaults currency and source url when absent", () => {
    const product = rowToScrapedProduct({ name: "X" });
    expect(product.currency).toBe("VND");
    expect(product.sourceUrl).toBeTruthy();
  });
});

describe("column mapping additions", () => {
  it("maps Vietnamese aliases for code and category", () => {
    const mapping = suggestColumnMapping([
      "Tên vật tư",
      "Mã vật tư",
      "Nhóm",
    ]);
    expect(mapping.materialName).toBe("Tên vật tư");
    expect(mapping.code).toBe("Mã vật tư");
    expect(mapping.category).toBe("Nhóm");
  });
});

async function makeWorkbookBase64(
  headers: string[],
  rows: Array<Array<string | number>>,
): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer).toString("base64");
}

describe("writeEnrichedWorkbook (preserve)", () => {
  it("fills blank cells and preserves existing ones", async () => {
    const headers = ["Tên vật tư", "ĐVT", "Nhà sản xuất"];
    const base64 = await makeWorkbookBase64(headers, [
      ["Ống nhựa D21", "", "Bình Minh"],
    ]);
    const mapping = suggestColumnMapping(headers);

    const buffer = await writeEnrichedWorkbook({
      workbookBase64: base64,
      sheetName: "Sheet1",
      mapping,
      headerRowIndex: 1,
      decisions: [
        { originalRowIndex: 2, materialId: 5, fields: ["unit", "manufacturer"] },
      ],
      materialsById: new Map([
        [
          5,
          material({
            id: 5,
            name: "Ống nhựa D21",
            unit: "m",
            manufacturer: "Tiền Phong",
          }),
        ],
      ]),
      mode: "preserve",
    });

    const out = new ExcelJS.Workbook();
    await out.xlsx.load(buffer as unknown as Parameters<typeof out.xlsx.load>[0]);
    const sheet = out.getWorksheet("Sheet1")!;
    const dataRow = sheet.getRow(2);
    // Unit blank → filled with "m".
    expect(cellText(dataRow.getCell(2).value)).toBe("m");
    // Manufacturer had a value → sheet wins, not overwritten.
    expect(cellText(dataRow.getCell(3).value)).toBe("Bình Minh");
  });

  it("appends a column for a field the sheet lacked", async () => {
    const headers = ["Tên vật tư", "ĐVT"];
    const base64 = await makeWorkbookBase64(headers, [["Dây điện", "m"]]);
    const mapping = suggestColumnMapping(headers);

    const buffer = await writeEnrichedWorkbook({
      workbookBase64: base64,
      sheetName: "Sheet1",
      mapping,
      headerRowIndex: 1,
      decisions: [{ originalRowIndex: 2, materialId: 7, fields: ["category"] }],
      materialsById: new Map([
        [7, material({ id: 7, name: "Dây điện", category: "Điện" })],
      ]),
      mode: "preserve",
    });

    const out = new ExcelJS.Workbook();
    await out.xlsx.load(buffer as unknown as Parameters<typeof out.xlsx.load>[0]);
    const sheet = out.getWorksheet("Sheet1")!;
    // A new 3rd column should hold the category value.
    expect(cellText(sheet.getRow(2).getCell(3).value)).toBe("Điện");
  });
});

describe("writeEnrichedWorkbook (clean)", () => {
  it("emits a canonical sheet with matched material rows", async () => {
    const base64 = await makeWorkbookBase64(["Tên vật tư"], [["Ống nhựa"]]);
    const buffer = await writeEnrichedWorkbook({
      workbookBase64: base64,
      sheetName: "Sheet1",
      mapping: {},
      headerRowIndex: 1,
      decisions: [{ originalRowIndex: 2, materialId: 9, fields: ["unit"] }],
      materialsById: new Map([
        [9, material({ id: 9, name: "Ống nhựa D21", unit: "m" })],
      ]),
      mode: "clean",
    });

    const out = new ExcelJS.Workbook();
    await out.xlsx.load(buffer as unknown as Parameters<typeof out.xlsx.load>[0]);
    const sheet = out.worksheets[0]!;
    // Header + one data row.
    expect(sheet.rowCount).toBe(2);
    expect(cellText(sheet.getRow(2).getCell(1).value)).toBe("Ống nhựa D21");
  });
});

describe("writeEnrichedWorkbook (force-overwrite)", () => {
  it("replaces a populated cell when the field is in overwriteFields", async () => {
    const headers = ["Tên vật tư", "ĐVT", "Nhà sản xuất"];
    const base64 = await makeWorkbookBase64(headers, [
      ["Ống nhựa D21", "cuộn", "Bình Minh"],
    ]);
    const mapping = suggestColumnMapping(headers);

    const buffer = await writeEnrichedWorkbook({
      workbookBase64: base64,
      sheetName: "Sheet1",
      mapping,
      headerRowIndex: 1,
      decisions: [
        {
          originalRowIndex: 2,
          materialId: 5,
          fields: ["unit", "manufacturer"],
          overwriteFields: ["unit"],
        },
      ],
      materialsById: new Map([
        [
          5,
          material({
            id: 5,
            name: "Ống nhựa D21",
            unit: "m",
            manufacturer: "Tiền Phong",
          }),
        ],
      ]),
      mode: "preserve",
    });

    const out = new ExcelJS.Workbook();
    await out.xlsx.load(buffer as unknown as Parameters<typeof out.xlsx.load>[0]);
    const sheet = out.getWorksheet("Sheet1")!;
    const dataRow = sheet.getRow(2);
    // Unit was force-overwritten: "cuộn" → "m".
    expect(cellText(dataRow.getCell(2).value)).toBe("m");
  });

  it("keeps a populated cell for a field NOT in overwriteFields", async () => {
    const headers = ["Tên vật tư", "ĐVT", "Nhà sản xuất"];
    const base64 = await makeWorkbookBase64(headers, [
      ["Ống nhựa D21", "cuộn", "Bình Minh"],
    ]);
    const mapping = suggestColumnMapping(headers);

    const buffer = await writeEnrichedWorkbook({
      workbookBase64: base64,
      sheetName: "Sheet1",
      mapping,
      headerRowIndex: 1,
      decisions: [
        {
          originalRowIndex: 2,
          materialId: 5,
          fields: ["unit", "manufacturer"],
          overwriteFields: ["unit"],
        },
      ],
      materialsById: new Map([
        [
          5,
          material({
            id: 5,
            name: "Ống nhựa D21",
            unit: "m",
            manufacturer: "Tiền Phong",
          }),
        ],
      ]),
      mode: "preserve",
    });

    const out = new ExcelJS.Workbook();
    await out.xlsx.load(buffer as unknown as Parameters<typeof out.xlsx.load>[0]);
    const sheet = out.getWorksheet("Sheet1")!;
    const dataRow = sheet.getRow(2);
    // Manufacturer was NOT in overwriteFields and had a value: sheet wins.
    expect(cellText(dataRow.getCell(3).value)).toBe("Bình Minh");
  });

  it("never writes currency as its own column", async () => {
    const headers = ["Tên vật tư", "ĐVT"];
    const base64 = await makeWorkbookBase64(headers, [["Ống nhựa", ""]]);
    const mapping = suggestColumnMapping(headers);

    const buffer = await writeEnrichedWorkbook({
      workbookBase64: base64,
      sheetName: "Sheet1",
      mapping,
      headerRowIndex: 1,
      decisions: [
        {
          originalRowIndex: 2,
          materialId: 5,
          fields: ["currency"],
          overwriteFields: ["currency"],
        },
      ],
      materialsById: new Map([
        [5, material({ id: 5, name: "Ống nhựa", currency: "USD" })],
      ]),
      mode: "preserve",
    });

    const out = new ExcelJS.Workbook();
    await out.xlsx.load(buffer as unknown as Parameters<typeof out.xlsx.load>[0]);
    const sheet = out.getWorksheet("Sheet1")!;
    // No new column should have been appended for currency: still 2 columns.
    expect(sheet.columnCount).toBe(2);
    // And the currency value "USD" appears nowhere in the data row.
    const dataRow = sheet.getRow(2);
    for (let col = 1; col <= sheet.columnCount; col++) {
      expect(cellText(dataRow.getCell(col).value)).not.toBe("USD");
    }
  });
});

describe("writeEnrichedWorkbook (value overrides / web-only)", () => {
  it("writes a valueOverride that no material carries", async () => {
    const headers = ["Tên vật tư", "ĐVT", "Nhà sản xuất"];
    const base64 = await makeWorkbookBase64(headers, [["Cáp CV", "", ""]]);
    const mapping = suggestColumnMapping(headers);

    const buffer = await writeEnrichedWorkbook({
      workbookBase64: base64,
      sheetName: "Sheet1",
      mapping,
      headerRowIndex: 1,
      decisions: [
        {
          originalRowIndex: 2,
          materialId: 9,
          fields: ["unit", "manufacturer"],
          // material has unit "m"; override manufacturer with an edited value.
          valueOverrides: { manufacturer: "CADIVI (đã sửa)" },
        },
      ],
      materialsById: new Map([
        [9, material({ id: 9, name: "Cáp CV", unit: "m" })],
      ]),
      mode: "preserve",
    });

    const out = new ExcelJS.Workbook();
    await out.xlsx.load(buffer as unknown as Parameters<typeof out.xlsx.load>[0]);
    const sheet = out.getWorksheet("Sheet1")!;
    const dataRow = sheet.getRow(2);
    // Unit from the material; manufacturer from the override (not on material).
    expect(cellText(dataRow.getCell(2).value)).toBe("m");
    expect(cellText(dataRow.getCell(3).value)).toBe("CADIVI (đã sửa)");
  });

  it("exports a web-only row (materialId null) from overrides alone", async () => {
    const headers = ["Tên vật tư", "ĐVT", "Nhà sản xuất"];
    const base64 = await makeWorkbookBase64(headers, [["Van bi", "", ""]]);
    const mapping = suggestColumnMapping(headers);

    const buffer = await writeEnrichedWorkbook({
      workbookBase64: base64,
      sheetName: "Sheet1",
      mapping,
      headerRowIndex: 1,
      decisions: [
        {
          originalRowIndex: 2,
          materialId: null,
          fields: ["unit", "manufacturer"],
          valueOverrides: { unit: "cái", manufacturer: "Kitz" },
        },
      ],
      materialsById: new Map(),
      mode: "preserve",
    });

    const out = new ExcelJS.Workbook();
    await out.xlsx.load(buffer as unknown as Parameters<typeof out.xlsx.load>[0]);
    const sheet = out.getWorksheet("Sheet1")!;
    const dataRow = sheet.getRow(2);
    expect(cellText(dataRow.getCell(2).value)).toBe("cái");
    expect(cellText(dataRow.getCell(3).value)).toBe("Kitz");
  });

  it("coerces a numeric override (price) to a number", async () => {
    const headers = ["Tên vật tư", "Đơn giá"];
    const base64 = await makeWorkbookBase64(headers, [["Cáp CV", ""]]);
    const mapping = suggestColumnMapping(headers);

    const buffer = await writeEnrichedWorkbook({
      workbookBase64: base64,
      sheetName: "Sheet1",
      mapping,
      headerRowIndex: 1,
      decisions: [
        {
          originalRowIndex: 2,
          materialId: null,
          fields: ["defaultUnitPrice"],
          valueOverrides: { defaultUnitPrice: "25000" },
        },
      ],
      materialsById: new Map(),
      mode: "preserve",
    });

    const out = new ExcelJS.Workbook();
    await out.xlsx.load(buffer as unknown as Parameters<typeof out.xlsx.load>[0]);
    const sheet = out.getWorksheet("Sheet1")!;
    expect(sheet.getRow(2).getCell(2).value).toBe(25000);
  });

  it("exports a web-only override row in clean mode (materialId null)", async () => {
    const headers = ["Tên vật tư", "ĐVT", "Nhà sản xuất"];
    const base64 = await makeWorkbookBase64(headers, [["Van bi", "", ""]]);
    const mapping = suggestColumnMapping(headers);

    const buffer = await writeEnrichedWorkbook({
      workbookBase64: base64,
      sheetName: "Sheet1",
      mapping,
      headerRowIndex: 1,
      decisions: [
        {
          originalRowIndex: 2,
          materialId: null,
          fields: ["unit", "manufacturer"],
          valueOverrides: { unit: "cái", manufacturer: "Kitz" },
        },
      ],
      materialsById: new Map(),
      mode: "clean",
    });

    const out = new ExcelJS.Workbook();
    await out.xlsx.load(buffer as unknown as Parameters<typeof out.xlsx.load>[0]);
    const sheet = out.getWorksheet("Sheet1")!;
    const dataRow = sheet.getRow(2);
    // Clean mode uses the fixed CLEAN_COLUMN_ORDER: name, code, unit, category,
    // specText, manufacturer, ... — so unit is col 3 and manufacturer is col 6.
    expect(cellText(dataRow.getCell(3).value)).toBe("cái");
    expect(cellText(dataRow.getCell(6).value)).toBe("Kitz");
  });

  it("round-trips router-shaped decisions with valueOverrides and null materialId", async () => {
    const headers = [
      "Tên vật tư",
      "Mã vật tư",
      "ĐVT",
      "Nhóm",
      "Thông số",
      "Nhà sản xuất",
      "Xuất xứ",
      "Đơn giá",
      "Nguồn",
    ];
    const base64 = await makeWorkbookBase64(headers, [["Van bi", "", "", "", "", "", "", "", ""]]);
    const mapping = suggestColumnMapping(headers);

    // Mirrors enrichExportXlsx input → writeEnrichedWorkbook decision mapping.
    const routerDecisions = [
      {
        originalRowIndex: 2,
        materialId: null as number | null,
        fields: [
          "code",
          "unit",
          "category",
          "specText",
          "manufacturer",
          "originCountry",
          "defaultUnitPrice",
          "sourceUrl",
        ] as const,
        valueOverrides: {
          code: "VB-50",
          unit: "cái",
          category: "Van",
          specText: "DN50",
          manufacturer: "Kitz",
          originCountry: "Nhật",
          defaultUnitPrice: "250000",
          sourceUrl: "https://example.com/van",
        },
      },
    ];

    const buffer = await writeEnrichedWorkbook({
      workbookBase64: base64,
      sheetName: "Sheet1",
      mapping,
      headerRowIndex: 1,
      decisions: routerDecisions.map((decision) => ({
        originalRowIndex: decision.originalRowIndex,
        materialId: decision.materialId,
        fields: [...decision.fields],
        overwriteFields: undefined,
        valueOverrides: decision.valueOverrides,
      })),
      materialsById: new Map(),
      mode: "preserve",
    });

    const out = new ExcelJS.Workbook();
    await out.xlsx.load(buffer as unknown as Parameters<typeof out.xlsx.load>[0]);
    const sheet = out.getWorksheet("Sheet1")!;
    const dataRow = sheet.getRow(2);
    expect(cellText(dataRow.getCell(2).value)).toBe("VB-50");
    expect(cellText(dataRow.getCell(3).value)).toBe("cái");
    expect(cellText(dataRow.getCell(4).value)).toBe("Van");
    expect(cellText(dataRow.getCell(5).value)).toBe("DN50");
    expect(cellText(dataRow.getCell(6).value)).toBe("Kitz");
    expect(cellText(dataRow.getCell(7).value)).toBe("Nhật");
    expect(dataRow.getCell(8).value).toBe(250000);
    expect(cellText(dataRow.getCell(9).value)).toBe("https://example.com/van");
  });
});

describe("classifyStatus thresholds", () => {
  it("classifies exactly 0.85 as auto", () => {
    expect(classifyStatus(0.85)).toBe("auto");
  });
  it("classifies exactly 0.5 as review", () => {
    expect(classifyStatus(0.5)).toBe("review");
  });
  it("classifies just below 0.5 as unmatched", () => {
    expect(classifyStatus(0.4999)).toBe("unmatched");
  });
  it("treats null and undefined as unmatched", () => {
    expect(classifyStatus(null)).toBe("unmatched");
    expect(classifyStatus(undefined)).toBe("unmatched");
  });
});

describe("decodeBase64ForTest", () => {
  it("produces identical buffers with and without a data URL prefix", () => {
    const raw = Buffer.from("hello world", "utf8").toString("base64");
    const withPrefix = `data:application/octet-stream;base64,${raw}`;
    const a = decodeBase64ForTest(raw);
    const b = decodeBase64ForTest(withPrefix);
    expect(a.equals(b)).toBe(true);
    expect(a.toString("utf8")).toBe("hello world");
  });
});
