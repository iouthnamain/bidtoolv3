import {
  calculateBuyQuantity,
  normalizeSelectedSheetTemplateIds,
  type StandardSheetTemplateId,
} from "~/lib/excel-workspace-standard";

export type ExcelWorkspaceValidationIssue = {
  severity: "error" | "warning";
  code:
    | "EMPTY_WORKSPACE"
    | "NO_SELECTED_TEMPLATES"
    | "MISSING_MATERIAL_NAME"
    | "MISSING_UNIT"
    | "INVALID_QTY_TOTAL"
    | "STOCK_OVERFLOW"
    | "INVALID_REUSE_PCT"
    | "EMPTY_TEMPLATE_SHEET"
    | "DUPLICATE_MATERIAL_TERM"
    | "NO_PURCHASE"
    | "MISSING_EVIDENCE"
    | "MISSING_INSPECTION_QTY"
    | "MISSING_UNIT_PRICE";
  message: string;
  itemId?: number;
  templateId?: StandardSheetTemplateId;
};

export type ValidatableWorkspace = {
  selectedSheetTemplateIds: unknown;
};

export type ValidatableWorkspaceItem = {
  id: number;
  productName: string;
  unit: string;
  term: string;
  qtyTotal: number | null;
  qtyInStock: number | null;
  reusePct: number;
  inspectionQtyTerm1: number | null;
  inspectionQtyTerm2: number | null;
  unitPrice: number | null;
  selectedCandidateId: number | null;
  includedInExport: boolean;
};

function itemLabel(item: ValidatableWorkspaceItem) {
  return item.productName || `Dòng #${item.id}`;
}

export function validateWorkspaceForStandardExport(input: {
  workspace: ValidatableWorkspace;
  items: ValidatableWorkspaceItem[];
}): ExcelWorkspaceValidationIssue[] {
  const issues: ExcelWorkspaceValidationIssue[] = [];
  const selectedTemplates = normalizeSelectedSheetTemplateIds(
    input.workspace.selectedSheetTemplateIds,
  );
  const includedItems = input.items.filter((item) => item.includedInExport);

  if (selectedTemplates.length === 0) {
    issues.push({
      severity: "error",
      code: "NO_SELECTED_TEMPLATES",
      message: "Cần chọn ít nhất một mẫu sheet để xuất.",
    });
  }

  if (includedItems.length === 0) {
    issues.push({
      severity: "error",
      code: "EMPTY_WORKSPACE",
      message: "Workspace chưa có dòng vật tư nào được đưa vào xuất.",
    });
  }

  const duplicateKeys = new Map<string, ValidatableWorkspaceItem[]>();
  let purchaseRows = 0;
  let evidenceMissing = 0;

  for (const item of includedItems) {
    const name = item.productName.trim();
    const unit = item.unit.trim();
    const qtyTotal = Number(item.qtyTotal ?? 0);
    const qtyInStock = Number(item.qtyInStock ?? 0);
    const buyQty = calculateBuyQuantity({
      qtyTotal: item.qtyTotal,
      qtyInStock: item.qtyInStock,
    });

    if (!name) {
      issues.push({
        severity: "error",
        code: "MISSING_MATERIAL_NAME",
        message: "Dòng vật tư thiếu tên.",
        itemId: item.id,
      });
    }

    if (!unit) {
      issues.push({
        severity: "error",
        code: "MISSING_UNIT",
        message: `${itemLabel(item)} thiếu đơn vị tính.`,
        itemId: item.id,
      });
    }

    if (!item.qtyTotal || qtyTotal <= 0) {
      issues.push({
        severity: "error",
        code: "INVALID_QTY_TOTAL",
        message: `${itemLabel(item)} cần số lượng tổng hợp lớn hơn 0.`,
        itemId: item.id,
      });
    }

    if (qtyInStock > qtyTotal) {
      issues.push({
        severity: "error",
        code: "STOCK_OVERFLOW",
        message: `${itemLabel(item)} có số lượng tồn lớn hơn số lượng tổng hợp.`,
        itemId: item.id,
      });
    }

    if (item.reusePct < 0 || item.reusePct > 100) {
      issues.push({
        severity: "error",
        code: "INVALID_REUSE_PCT",
        message: `${itemLabel(item)} có % sử dụng lại ngoài khoảng 0-100.`,
        itemId: item.id,
      });
    }

    if (buyQty > 0) {
      purchaseRows += 1;
    }

    if (!item.selectedCandidateId) {
      evidenceMissing += 1;
      issues.push({
        severity: "warning",
        code: "MISSING_EVIDENCE",
        message: `${itemLabel(item)} chưa có nguồn đối chiếu.`,
        itemId: item.id,
      });
    }

    if (!item.unitPrice) {
      issues.push({
        severity: "warning",
        code: "MISSING_UNIT_PRICE",
        message: `${itemLabel(item)} chưa có đơn giá.`,
        itemId: item.id,
      });
    }

    const duplicateKey = `${name.toLocaleLowerCase("vi-VN")}::${unit.toLocaleLowerCase("vi-VN")}::${item.term}`;
    const duplicates = duplicateKeys.get(duplicateKey) ?? [];
    duplicates.push(item);
    duplicateKeys.set(duplicateKey, duplicates);
  }

  for (const rows of duplicateKeys.values()) {
    if (rows.length > 1) {
      issues.push({
        severity: "warning",
        code: "DUPLICATE_MATERIAL_TERM",
        message: `${rows[0]?.productName ?? "Vật tư"} bị trùng tên, ĐVT và học kỳ (${rows.length} dòng).`,
        itemId: rows[0]?.id,
      });
    }
  }

  if (includedItems.length > 0 && purchaseRows === 0) {
    issues.push({
      severity: "warning",
      code: "NO_PURCHASE",
      message: "Tất cả dòng đều có thực mua bằng 0.",
    });
  }

  if (selectedTemplates.includes("purchase_request") && purchaseRows === 0) {
    issues.push({
      severity: "error",
      code: "EMPTY_TEMPLATE_SHEET",
      message: "Sheet Đề nghị mua không có dòng thực mua lớn hơn 0.",
      templateId: "purchase_request",
    });
  }

  if (selectedTemplates.includes("inspection_term_1")) {
    const rows = includedItems.filter(
      (item) => Number(item.inspectionQtyTerm1 ?? 0) > 0,
    );
    if (rows.length === 0) {
      issues.push({
        severity: "error",
        code: "EMPTY_TEMPLATE_SHEET",
        message: "Sheet BB kiểm tra kỳ I không có dòng kiểm tra.",
        templateId: "inspection_term_1",
      });
    }
    for (const item of includedItems) {
      if (item.inspectionQtyTerm1 == null) {
        issues.push({
          severity: "warning",
          code: "MISSING_INSPECTION_QTY",
          message: `${itemLabel(item)} chưa có số lượng kiểm tra kỳ I.`,
          itemId: item.id,
          templateId: "inspection_term_1",
        });
      }
    }
  }

  if (selectedTemplates.includes("inspection_term_2")) {
    const rows = includedItems.filter(
      (item) => Number(item.inspectionQtyTerm2 ?? 0) > 0,
    );
    if (rows.length === 0) {
      issues.push({
        severity: "error",
        code: "EMPTY_TEMPLATE_SHEET",
        message: "Sheet BB kiểm tra kỳ II không có dòng kiểm tra.",
        templateId: "inspection_term_2",
      });
    }
    for (const item of includedItems) {
      if (item.inspectionQtyTerm2 == null) {
        issues.push({
          severity: "warning",
          code: "MISSING_INSPECTION_QTY",
          message: `${itemLabel(item)} chưa có số lượng kiểm tra kỳ II.`,
          itemId: item.id,
          templateId: "inspection_term_2",
        });
      }
    }
  }

  if (
    selectedTemplates.includes("evidence") &&
    evidenceMissing === includedItems.length &&
    includedItems.length > 0
  ) {
    issues.push({
      severity: "warning",
      code: "MISSING_EVIDENCE",
      message:
        "Sheet Evidence được chọn nhưng chưa dòng nào có nguồn đối chiếu.",
      templateId: "evidence",
    });
  }

  return issues;
}

export function hasBlockingExportIssues(
  issues: ExcelWorkspaceValidationIssue[],
) {
  return issues.some((issue) => issue.severity === "error");
}
