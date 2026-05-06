import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  defaultSelectedSheetTemplateIds,
  defaultWorkspaceTemplateConfig,
  type StandardSheetTemplateId,
} from "~/lib/excel-workspace-standard";
import {
  buildStandardWorkbookBuffer,
  type StandardWorkbookCandidate,
  type StandardWorkbookItem,
} from "~/server/services/standard-workbook-export";

function workspace(templateIds: StandardSheetTemplateId[]) {
  return {
    id: 1,
    name: "Workbook vật tư chuẩn",
    templateConfigJson: defaultWorkspaceTemplateConfig,
    selectedSheetTemplateIds: templateIds,
  };
}

function item(patch: Partial<StandardWorkbookItem> = {}): StandardWorkbookItem {
  return {
    id: 1,
    originalRowIndex: 10,
    productName: "Dây điện VCm 0.5mm2",
    specText: "Cadivi VCm",
    unit: "m",
    term: "term_1",
    qtyTotal: 10,
    qtyInStock: 2,
    depreciation: 1,
    reusePct: 0,
    inspectionQtyTerm1: 3,
    inspectionQtyTerm2: 4,
    unitPrice: 4000,
    vendorHint: "Cadivi",
    originHint: "Việt Nam",
    selectedCandidateId: 1,
    includedInExport: true,
    ...patch,
  };
}

function candidate(
  patch: Partial<StandardWorkbookCandidate> = {},
): StandardWorkbookCandidate {
  return {
    id: 1,
    workspaceItemId: 1,
    provider: "manual",
    title: "Dây điện Cadivi",
    url: "https://example.com/day-dien",
    domain: "example.com",
    rawEvidence: "Giá tham khảo 4.000 VND/m",
    confidenceScore: 100,
    extractedSpecJson: {
      priceText: "4.000 VND",
      vendorName: "Example Supplier",
      evidenceText: "Giá tham khảo 4.000 VND/m",
    },
    ...patch,
  };
}

async function loadWorkbook(input: {
  templateIds: StandardSheetTemplateId[];
  items?: StandardWorkbookItem[];
  candidates?: StandardWorkbookCandidate[];
}) {
  const buffer = await buildStandardWorkbookBuffer({
    workspace: workspace(input.templateIds),
    items: input.items ?? [item()],
    candidates: input.candidates ?? [candidate()],
  });
  const workbook = new ExcelJS.Workbook();
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
  await workbook.xlsx.load(arrayBuffer);
  return workbook;
}

function columnText(sheet: ExcelJS.Worksheet, column: number) {
  return sheet
    .getColumn(column)
    .values.map((value) =>
      typeof value === "string" || typeof value === "number"
        ? String(value)
        : "",
    )
    .join("\n");
}

describe("standard workbook export", () => {
  it("contains selected templates only", async () => {
    const workbook = await loadWorkbook({ templateIds: ["thvt", "evidence"] });

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "THVT",
      "Evidence",
    ]);
  });

  it("contains the default selected sheet set", async () => {
    const workbook = await loadWorkbook({
      templateIds: defaultSelectedSheetTemplateIds,
    });

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "THVT",
      "De nghi mua",
      "BB kiem tra VT cuoi ky I",
      "BB kiem tra VT cuoi ky II",
      "Evidence",
    ]);
  });

  it("writes THỰC MUA formulas", async () => {
    const workbook = await loadWorkbook({ templateIds: ["thvt"] });
    const thvt = workbook.getWorksheet("THVT")!;

    expect(thvt.getCell("F10").value).toMatchObject({
      formula: "D10-E10",
      result: 8,
    });
  });

  it("excludes zero-buy rows from the purchase request", async () => {
    const workbook = await loadWorkbook({
      templateIds: ["thvt", "purchase_request"],
      items: [
        item({ id: 1, productName: "Buy Item", qtyTotal: 10, qtyInStock: 2 }),
        item({
          id: 2,
          productName: "No Buy Item",
          qtyTotal: 2,
          qtyInStock: 2,
          selectedCandidateId: null,
        }),
      ],
      candidates: [candidate()],
    });
    const request = workbook.getWorksheet("De nghi mua")!;
    const names = columnText(request, 2);

    expect(names).toContain("Buy Item");
    expect(names).not.toContain("No Buy Item");
  });

  it("uses separate inspection quantities", async () => {
    const workbook = await loadWorkbook({
      templateIds: ["inspection_term_1", "inspection_term_2"],
      items: [item({ inspectionQtyTerm1: 3, inspectionQtyTerm2: 7 })],
    });

    expect(
      workbook.getWorksheet("BB kiem tra VT cuoi ky I")!.getCell("D9").value,
    ).toBe(3);
    expect(
      workbook.getWorksheet("BB kiem tra VT cuoi ky II")!.getCell("D9").value,
    ).toBe(7);
  });

  it("exports selected evidence data", async () => {
    const workbook = await loadWorkbook({ templateIds: ["evidence"] });
    const evidence = workbook.getWorksheet("Evidence")!;

    expect(evidence.getCell("B2").value).toBe("Dây điện VCm 0.5mm2");
    expect(evidence.getCell("F2").value).toBe("Dây điện Cadivi");
    expect(evidence.getCell("H2").value).toBe("https://example.com/day-dien");
    expect(evidence.getCell("J2").value).toBe(100);
  });
});
