import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  parseWorkbookBase64,
  rowsFromMapping,
} from "~/server/services/excel-workbook";
import { generateDemoMaterialSamples } from "../scripts/generate-demo-material-samples";

const demoDir = path.join(process.cwd(), "docs", "demo");

function readDemoBase64(fileName: string) {
  return readFileSync(path.join(demoDir, fileName)).toString("base64");
}

describe("demo material samples", () => {
  beforeAll(async () => {
    await generateDemoMaterialSamples({ log: false });
  }, 15_000);

  it("parses demo-catalog-6.xlsx for import mapping", async () => {
    const parsed = await parseWorkbookBase64(
      "demo-catalog-6.xlsx",
      readDemoBase64("demo-catalog-6.xlsx"),
    );
    const sheet = parsed.sheets[0]!;

    expect(parsed.warnings).toEqual([]);
    expect(sheet.name).toBe("Danh mục");
    expect(sheet.suggestedMapping.materialName).toBe("Tên vật tư");
    expect(sheet.suggestedMapping.unit).toBe("ĐVT");
    expect(rowsFromMapping(sheet, sheet.suggestedMapping)).toHaveLength(6);
  });

  it("parses demo-boq-6.xlsx for material profile mapping", async () => {
    const parsed = await parseWorkbookBase64(
      "demo-boq-6.xlsx",
      readDemoBase64("demo-boq-6.xlsx"),
    );
    const sheet = parsed.sheets[0]!;

    expect(parsed.warnings).toEqual([]);
    expect(sheet.name).toBe("Vật tư");
    expect(sheet.suggestedMapping.materialName).toBe("Tên vật tư");
    expect(sheet.suggestedMapping.qtyTotal).toBe("Số lượng");
    expect(rowsFromMapping(sheet, sheet.suggestedMapping)).toHaveLength(6);
  });
});
