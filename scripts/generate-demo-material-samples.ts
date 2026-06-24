import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import ExcelJS from "exceljs";

type DemoMaterialRow = {
  code: string;
  catalogName: string;
  boqName: string;
  unit: string;
  category: string;
  specText: string;
  vendor: string;
  origin: string;
  unitPrice: number;
  qty: number;
};

const demoRows: DemoMaterialRow[] = [
  {
    code: "VT-001",
    catalogName: "Dây điện đơn mềm VCm 0.5mm2",
    boqName: "Dây điện VCm 0.5mm2",
    unit: "m",
    category: "Điện",
    specText: "VCm 0.5mm2, 450/750V",
    vendor: "Cadivi",
    origin: "Việt Nam",
    unitPrice: 5000,
    qty: 100,
  },
  {
    code: "VT-002",
    catalogName: "Dây điện đơn mềm VCm 1.0mm2",
    boqName: "Dây VCm 1.0 mm2",
    unit: "m",
    category: "Điện",
    specText: "VCm 1.0mm2, 450/750V",
    vendor: "Cadivi",
    origin: "Việt Nam",
    unitPrice: 7500,
    qty: 200,
  },
  {
    code: "VT-003",
    catalogName: "Van tiết lưu 1 chiều M5 Φ4 (SL4-M5)",
    boqName: "Van 1 chiều M5 Φ4 SL4-M5",
    unit: "Cái",
    category: "Cơ khí",
    specText: "M5, Φ4",
    vendor: "OEM",
    origin: "Việt Nam",
    unitPrice: 15000,
    qty: 30,
  },
  {
    code: "VT-004",
    catalogName: "Ống luồn dây PVC Ø20",
    boqName: "Ống luồn PVC phi 20",
    unit: "m",
    category: "Điện",
    specText: "PVC, độ dày 1.3mm",
    vendor: "Sino",
    origin: "Việt Nam",
    unitPrice: 12000,
    qty: 50,
  },
  {
    code: "VT-005",
    catalogName: "Aptomat 2P 32A",
    boqName: "Aptomat 2 pha 32A",
    unit: "Cái",
    category: "Điện",
    specText: "2P, 32A, 6kA",
    vendor: "Schneider",
    origin: "Pháp",
    unitPrice: 185000,
    qty: 10,
  },
  {
    code: "VT-006",
    catalogName: "Tủ điện treo tường 600x400x200",
    boqName: "Tủ điện treo tường 600x400x200mm",
    unit: "Cái",
    category: "Điện",
    specText: "Thép sơn tĩnh điện",
    vendor: "Hano",
    origin: "Việt Nam",
    unitPrice: 950000,
    qty: 2,
  },
];

const catalogHeaders = [
  "Mã VT",
  "Tên vật tư",
  "ĐVT",
  "Nhóm vật tư",
  "Thông số kỹ thuật",
  "NCC",
  "Xuất xứ",
  "Đơn giá",
] as const;

const boqHeaders = [
  "Mã VT",
  "Tên vật tư",
  "ĐVT",
  "Nhóm vật tư",
  "Thông số kỹ thuật",
  "NCC",
  "Xuất xứ",
  "Số lượng",
  "Đơn giá",
] as const;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const outputDir = path.join(rootDir, "docs", "demo");
const catalogPath = path.join(outputDir, "demo-catalog-6.xlsx");
const boqPath = path.join(outputDir, "demo-boq-6.xlsx");

function catalogRowValues(row: DemoMaterialRow): (string | number)[] {
  return [
    row.code,
    row.catalogName,
    row.unit,
    row.category,
    row.specText,
    row.vendor,
    row.origin,
    row.unitPrice,
  ];
}

function boqRowValues(row: DemoMaterialRow): (string | number)[] {
  return [
    row.code,
    row.boqName,
    row.unit,
    row.category,
    row.specText,
    row.vendor,
    row.origin,
    row.qty,
    row.unitPrice,
  ];
}

async function writeWorkbook(
  filePath: string,
  sheetName: string,
  headers: readonly string[],
  rows: (string | number)[][],
) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow([...headers]);
  for (const row of rows) {
    sheet.addRow(row);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  await writeFile(filePath, Buffer.from(buffer));
}

async function verifyWorkbook(
  label: string,
  filePath: string,
  sheetName: string,
  headers: readonly string[],
  expectedRowCount: number,
) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet(sheetName);

  if (!sheet) {
    throw new Error(`${label}: sheet "${sheetName}" not found`);
  }

  const headerRow = sheet.getRow(1);
  const actualHeaders = headers.map((_, index) =>
    String(headerRow.getCell(index + 1).value ?? ""),
  );

  if (actualHeaders.join("|") !== headers.join("|")) {
    throw new Error(
      `${label}: header mismatch\n  expected: ${headers.join(" | ")}\n  actual:   ${actualHeaders.join(" | ")}`,
    );
  }

  const dataRowCount = sheet.rowCount - 1;
  if (dataRowCount !== expectedRowCount) {
    throw new Error(
      `${label}: expected ${expectedRowCount} data rows, got ${dataRowCount}`,
    );
  }
}

async function main() {
  await mkdir(outputDir, { recursive: true });

  await writeWorkbook(
    catalogPath,
    "Danh mục",
    catalogHeaders,
    demoRows.map(catalogRowValues),
  );
  await writeWorkbook(
    boqPath,
    "Vật tư",
    boqHeaders,
    demoRows.map(boqRowValues),
  );

  await verifyWorkbook(
    "catalog",
    catalogPath,
    "Danh mục",
    catalogHeaders,
    demoRows.length,
  );
  await verifyWorkbook(
    "boq",
    boqPath,
    "Vật tư",
    boqHeaders,
    demoRows.length,
  );

  console.log("Generated paired demo material samples:");
  console.log(`  ${catalogPath}`);
  console.log(`  ${boqPath}`);
  console.log("");
  console.log("Suggested demo flow:");
  console.log("  1. /materials/import — upload demo-catalog-6.xlsx");
  console.log("  2. /material-profiles — create TBMT-DEMO-2026-001");
  console.log("  3. Upload demo-boq-6.xlsx at step 1");
  console.log("  4. Map sheet → match → expect 6 high-confidence matches");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
