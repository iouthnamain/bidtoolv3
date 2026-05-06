import ExcelJS from "exceljs";

import {
  calculateBuyQuantity,
  normalizeSelectedSheetTemplateIds,
  normalizeWorkspaceTemplateConfig,
  WORKSPACE_TERM_LABELS,
  type WorkspaceTemplateConfig,
  type WorkspaceTerm,
} from "~/lib/excel-workspace-standard";

export type StandardWorkbookWorkspace = {
  id: number;
  name: string;
  templateConfigJson: unknown;
  selectedSheetTemplateIds: unknown;
};

export type StandardWorkbookItem = {
  id: number;
  originalRowIndex: number;
  productName: string;
  specText: string;
  unit: string;
  term: string;
  qtyTotal: number | null;
  qtyInStock: number | null;
  depreciation: number;
  reusePct: number;
  inspectionQtyTerm1: number | null;
  inspectionQtyTerm2: number | null;
  unitPrice: number | null;
  vendorHint: string | null;
  originHint: string | null;
  selectedCandidateId: number | null;
  includedInExport: boolean;
};

export type StandardWorkbookCandidate = {
  id: number;
  workspaceItemId: number;
  provider: string;
  title: string;
  url: string;
  domain: string;
  rawEvidence: string;
  confidenceScore: number;
  extractedSpecJson: Record<string, unknown>;
};

type ExportRow = StandardWorkbookItem & {
  term: WorkspaceTerm;
  candidate: StandardWorkbookCandidate | null;
};

const thinBorder: Partial<ExcelJS.Borders> = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" },
};

function normalizeTerm(value: string): WorkspaceTerm {
  return value === "term_2" ? "term_2" : "term_1";
}

function cleanSheetName(value: string) {
  return (
    value
      .replace(/[\\/*?:[\]]/g, " ")
      .slice(0, 31)
      .trim() || "Sheet"
  );
}

function applyHeader(
  sheet: ExcelJS.Worksheet,
  config: WorkspaceTemplateConfig,
  title: string,
) {
  sheet.mergeCells("A1:B1");
  sheet.mergeCells("C1:H1");
  sheet.mergeCells("A2:B2");
  sheet.mergeCells("C2:H2");
  sheet.mergeCells("A3:B3");
  sheet.mergeCells("A5:H5");
  sheet.mergeCells("A6:H6");

  sheet.getCell("A1").value = config.organizationLine1;
  sheet.getCell("A2").value = config.organizationLine2;
  sheet.getCell("A3").value = config.departmentLine;
  sheet.getCell("C1").value = config.rightHeaderLine1;
  sheet.getCell("C2").value = config.rightHeaderLine2;
  sheet.getCell("A5").value = title;
  sheet.getCell("A6").value =
    `${config.schoolYearLabel}${config.siteLabel ? ` (${config.siteLabel})` : ""}`;

  for (const cell of ["A1", "A2", "A3", "C1", "C2", "A5", "A6"]) {
    sheet.getCell(cell).font = { bold: true };
    sheet.getCell(cell).alignment = {
      horizontal:
        cell.startsWith("C") || cell === "A5" || cell === "A6"
          ? "center"
          : "left",
      vertical: "middle",
      wrapText: true,
    };
  }
  sheet.getCell("A5").font = { bold: true, size: 14 };
}

function applyTableHeader(row: ExcelJS.Row) {
  row.font = { bold: true };
  row.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  row.eachCell((cell) => {
    cell.border = thinBorder;
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE2E8F0" },
    };
  });
}

function applyTableRow(row: ExcelJS.Row) {
  row.alignment = { vertical: "middle", wrapText: true };
  row.eachCell((cell) => {
    cell.border = thinBorder;
  });
}

function formatNumberColumns(sheet: ExcelJS.Worksheet, columns: number[]) {
  for (const index of columns) {
    sheet.getColumn(index).numFmt = '#,##0.##;[Red]-#,##0.##;"-"';
  }
}

function sortRows(rows: ExportRow[]) {
  return [...rows].sort((left, right) => {
    if (left.term !== right.term) {
      return left.term.localeCompare(right.term);
    }
    return left.productName.localeCompare(right.productName, "vi");
  });
}

function addTermLabelRow(
  sheet: ExcelJS.Worksheet,
  rowNumber: number,
  label: string,
  colCount: number,
) {
  sheet.mergeCells(rowNumber, 1, rowNumber, colCount);
  const row = sheet.getRow(rowNumber);
  row.getCell(1).value = label;
  row.font = { bold: true };
  row.alignment = { horizontal: "left" };
  row.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF8FAFC" },
    };
    cell.border = thinBorder;
  });
}

function addSignatureBlock(
  sheet: ExcelJS.Worksheet,
  startRow: number,
  config: WorkspaceTemplateConfig,
  colCount: number,
) {
  const labels =
    config.signerLabels.length > 0
      ? config.signerLabels
      : ["Người lập", "Đơn vị", "Phòng vật tư", "Hiệu trưởng"];
  const span = Math.max(1, Math.floor(colCount / labels.length));
  let col = 1;
  for (const label of labels) {
    const endCol = Math.min(colCount, col + span - 1);
    sheet.mergeCells(startRow, col, startRow, endCol);
    sheet.getCell(startRow, col).value = label;
    sheet.getCell(startRow, col).font = { bold: true };
    sheet.getCell(startRow, col).alignment = { horizontal: "center" };
    col = endCol + 1;
    if (col > colCount) break;
  }
}

function addThvtSheet(
  workbook: ExcelJS.Workbook,
  rows: ExportRow[],
  config: WorkspaceTemplateConfig,
) {
  const sheet = workbook.addWorksheet(cleanSheetName("THVT"));
  applyHeader(sheet, config, config.thvtTitle);
  sheet.views = [{ state: "frozen", ySplit: 8 }];
  sheet.columns = [
    { width: 8 },
    { width: 52 },
    { width: 12 },
    { width: 16 },
    { width: 16 },
    { width: 14 },
    { width: 12 },
    { width: 16 },
  ];
  const header = sheet.getRow(8);
  header.values = [
    "STT",
    "TÊN QUI CÁCH VẬT TƯ",
    "ĐVT",
    "SỐ LƯỢNG TỔNG HỢP",
    "SỐ LƯỢNG CÒN TỒN",
    "THỰC MUA",
    "KHẤU HAO",
    "% SỬ DỤNG LẠI",
  ];
  applyTableHeader(header);

  const rowByItemId = new Map<number, number>();
  let excelRow = 9;
  let index = 1;
  for (const term of ["term_1", "term_2"] as const) {
    const termRows = rows.filter((row) => row.term === term);
    if (termRows.length === 0) continue;
    addTermLabelRow(sheet, excelRow, WORKSPACE_TERM_LABELS[term], 8);
    excelRow += 1;
    for (const item of termRows) {
      const row = sheet.getRow(excelRow);
      const buyQty = calculateBuyQuantity(item);
      row.values = [
        index,
        item.productName,
        item.unit,
        item.qtyTotal ?? 0,
        item.qtyInStock ?? 0,
        { formula: `D${excelRow}-E${excelRow}`, result: buyQty },
        item.depreciation,
        item.reusePct,
      ];
      applyTableRow(row);
      rowByItemId.set(item.id, excelRow);
      index += 1;
      excelRow += 1;
    }
  }

  formatNumberColumns(sheet, [4, 5, 6, 7, 8]);
  return rowByItemId;
}

function addPurchaseRequestSheet(
  workbook: ExcelJS.Workbook,
  rows: ExportRow[],
  config: WorkspaceTemplateConfig,
  thvtRowByItemId: Map<number, number> | null,
) {
  const sheet = workbook.addWorksheet(cleanSheetName("De nghi mua"));
  applyHeader(sheet, config, config.purchaseRequestTitle);
  sheet.columns = [
    { width: 8 },
    { width: 58 },
    { width: 12 },
    { width: 16 },
    { width: 12 },
    { width: 18 },
  ];

  let rowNumber = 8;
  sheet.getCell(rowNumber, 1).value = "Kính gửi:";
  sheet.getCell(rowNumber, 1).font = { bold: true };
  rowNumber += 1;
  for (const recipient of config.requestRecipients) {
    sheet.mergeCells(rowNumber, 2, rowNumber, 6);
    sheet.getCell(rowNumber, 2).value = `- ${recipient}`;
    rowNumber += 1;
  }
  rowNumber += 1;
  for (const paragraph of config.basisParagraphs) {
    sheet.mergeCells(rowNumber, 1, rowNumber, 6);
    sheet.getCell(rowNumber, 1).value = paragraph;
    sheet.getCell(rowNumber, 1).alignment = { wrapText: true };
    rowNumber += 1;
  }
  rowNumber += 1;

  const header = sheet.getRow(rowNumber);
  header.values = [
    "STT",
    "TÊN QUI CÁCH VẬT TƯ",
    "ĐVT",
    "SỐ LƯỢNG",
    "KHẤU HAO",
    "% SỬ DỤNG CÒN LẠI",
  ];
  applyTableHeader(header);
  rowNumber += 1;

  let index = 1;
  for (const item of rows.filter((row) => calculateBuyQuantity(row) > 0)) {
    const thvtRow = thvtRowByItemId?.get(item.id);
    const buyQty = calculateBuyQuantity(item);
    const row = sheet.getRow(rowNumber);
    row.values = [
      index,
      item.productName,
      item.unit,
      thvtRow ? { formula: `'THVT'!F${thvtRow}`, result: buyQty } : buyQty,
      item.depreciation,
      item.reusePct,
    ];
    applyTableRow(row);
    index += 1;
    rowNumber += 1;
  }

  formatNumberColumns(sheet, [4, 5, 6]);
  addSignatureBlock(sheet, rowNumber + 3, config, 6);
}

function addInspectionSheet(
  workbook: ExcelJS.Workbook,
  rows: ExportRow[],
  config: WorkspaceTemplateConfig,
  term: "term_1" | "term_2",
) {
  const sheetName =
    term === "term_1"
      ? "BB kiem tra VT cuoi ky I"
      : "BB kiem tra VT cuoi ky II";
  const sheet = workbook.addWorksheet(cleanSheetName(sheetName));
  applyHeader(
    sheet,
    config,
    `${config.inspectionTitle} ${WORKSPACE_TERM_LABELS[term]}`,
  );
  sheet.columns = [{ width: 8 }, { width: 64 }, { width: 12 }, { width: 16 }];
  const header = sheet.getRow(8);
  header.values = ["STT", "TÊN VẬT TƯ", "ĐVT", "SỐ LƯỢNG"];
  applyTableHeader(header);
  let rowNumber = 9;
  let index = 1;
  const qtyKey =
    term === "term_1" ? "inspectionQtyTerm1" : "inspectionQtyTerm2";
  for (const item of rows.filter((row) => Number(row[qtyKey] ?? 0) > 0)) {
    const row = sheet.getRow(rowNumber);
    row.values = [
      index,
      item.productName,
      item.unit,
      Number(item[qtyKey] ?? 0),
    ];
    applyTableRow(row);
    index += 1;
    rowNumber += 1;
  }
  formatNumberColumns(sheet, [4]);
  addSignatureBlock(sheet, rowNumber + 3, config, 4);
}

function addEvidenceSheet(workbook: ExcelJS.Workbook, rows: ExportRow[]) {
  const sheet = workbook.addWorksheet(cleanSheetName("Evidence"));
  sheet.columns = [
    { width: 10 },
    { width: 44 },
    { width: 12 },
    { width: 16 },
    { width: 14 },
    { width: 40 },
    { width: 28 },
    { width: 42 },
    { width: 16 },
    { width: 12 },
    { width: 70 },
  ];
  const header = sheet.getRow(1);
  header.values = [
    "Dòng",
    "Tên vật tư",
    "ĐVT",
    "Học kỳ",
    "Nguồn",
    "Tiêu đề",
    "Nhà cung cấp/domain",
    "URL",
    "Giá",
    "Confidence",
    "Evidence",
  ];
  applyTableHeader(header);
  let rowNumber = 2;
  for (const item of rows) {
    const candidate = item.candidate;
    const spec = candidate?.extractedSpecJson as {
      priceText?: string | null;
      priceVnd?: number | null;
      vendorName?: string | null;
      vendorDomain?: string | null;
      evidenceText?: string | null;
    } | null;
    const row = sheet.getRow(rowNumber);
    row.values = [
      item.originalRowIndex,
      item.productName,
      item.unit,
      WORKSPACE_TERM_LABELS[item.term],
      candidate?.provider ?? "",
      candidate?.title ?? "",
      spec?.vendorName ?? spec?.vendorDomain ?? candidate?.domain ?? "",
      candidate?.url ?? "",
      spec?.priceText ?? spec?.priceVnd ?? item.unitPrice ?? "",
      candidate?.confidenceScore ?? "",
      spec?.evidenceText ?? candidate?.rawEvidence ?? "",
    ];
    applyTableRow(row);
    rowNumber += 1;
  }
}

export async function buildStandardWorkbookBuffer(input: {
  workspace: StandardWorkbookWorkspace;
  items: StandardWorkbookItem[];
  candidates: StandardWorkbookCandidate[];
}) {
  const config = normalizeWorkspaceTemplateConfig(
    input.workspace.templateConfigJson,
  );
  const selectedTemplates = normalizeSelectedSheetTemplateIds(
    input.workspace.selectedSheetTemplateIds,
  );
  const candidateById = new Map(input.candidates.map((row) => [row.id, row]));
  const rows = sortRows(
    input.items
      .filter((item) => item.includedInExport)
      .map((item) => ({
        ...item,
        term: normalizeTerm(item.term),
        candidate: item.selectedCandidateId
          ? (candidateById.get(item.selectedCandidateId) ?? null)
          : null,
      })),
  );

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BidTool";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  let thvtRowByItemId: Map<number, number> | null = null;
  if (selectedTemplates.includes("thvt")) {
    thvtRowByItemId = addThvtSheet(workbook, rows, config);
  }
  if (selectedTemplates.includes("purchase_request")) {
    addPurchaseRequestSheet(workbook, rows, config, thvtRowByItemId);
  }
  if (selectedTemplates.includes("inspection_term_1")) {
    addInspectionSheet(workbook, rows, config, "term_1");
  }
  if (selectedTemplates.includes("inspection_term_2")) {
    addInspectionSheet(workbook, rows, config, "term_2");
  }
  if (selectedTemplates.includes("evidence")) {
    addEvidenceSheet(workbook, rows);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function buildStandardWorkbookFileName(workspace: { name: string }) {
  const stem =
    workspace.name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\w-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "workspace";
  return `${stem}-standard.xlsx`;
}
