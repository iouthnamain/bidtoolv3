export const WORKSPACE_TERMS = ["term_1", "term_2"] as const;

export type WorkspaceTerm = (typeof WORKSPACE_TERMS)[number];

export const WORKSPACE_TERM_LABELS: Record<WorkspaceTerm, string> = {
  term_1: "Học kỳ I",
  term_2: "Học kỳ II",
};

export const standardColumnKeys = [
  "materialName",
  "specText",
  "unit",
  "term",
  "qtyTotal",
  "qtyInStock",
  "depreciation",
  "reusePct",
  "inspectionQtyTerm1",
  "inspectionQtyTerm2",
  "unitPrice",
  "vendorHint",
  "originHint",
  "sourceUrl",
  "notes",
] as const;

export type StandardColumnKey = (typeof standardColumnKeys)[number];
export type StandardColumnMapping = Partial<
  Record<StandardColumnKey, string | null>
>;

export const standardSheetTemplateIds = [
  "thvt",
  "purchase_request",
  "inspection_term_1",
  "inspection_term_2",
  "evidence",
] as const;

export type StandardSheetTemplateId = (typeof standardSheetTemplateIds)[number];

export type StandardSheetTemplate = {
  id: StandardSheetTemplateId;
  label: string;
  description: string;
  requiredFields: StandardColumnKey[];
};

export const standardSheetTemplates: StandardSheetTemplate[] = [
  {
    id: "thvt",
    label: "THVT",
    description: "Bảng tổng hợp vật tư theo học kỳ.",
    requiredFields: ["materialName", "unit", "qtyTotal", "qtyInStock"],
  },
  {
    id: "purchase_request",
    label: "Đề nghị mua",
    description: "Bảng đề nghị mua, chỉ gồm dòng có thực mua lớn hơn 0.",
    requiredFields: ["materialName", "unit", "qtyTotal", "qtyInStock"],
  },
  {
    id: "inspection_term_1",
    label: "BB kiểm tra kỳ I",
    description: "Biên bản kiểm tra vật tư cuối học kỳ I.",
    requiredFields: ["materialName", "unit", "inspectionQtyTerm1"],
  },
  {
    id: "inspection_term_2",
    label: "BB kiểm tra kỳ II",
    description: "Biên bản kiểm tra vật tư cuối học kỳ II.",
    requiredFields: ["materialName", "unit", "inspectionQtyTerm2"],
  },
  {
    id: "evidence",
    label: "Evidence",
    description: "Nguồn đối chiếu, giá, nhà cung cấp và bằng chứng.",
    requiredFields: [],
  },
];

export const defaultSelectedSheetTemplateIds: StandardSheetTemplateId[] = [
  "thvt",
  "purchase_request",
  "inspection_term_1",
  "inspection_term_2",
  "evidence",
];

export type WorkspaceTemplateConfig = {
  organizationLine1: string;
  organizationLine2: string;
  departmentLine: string;
  rightHeaderLine1: string;
  rightHeaderLine2: string;
  schoolYearLabel: string;
  siteLabel: string;
  thvtTitle: string;
  purchaseRequestTitle: string;
  inspectionTitle: string;
  requestRecipients: string[];
  basisParagraphs: string[];
  signerLabels: string[];
};

export const defaultWorkspaceTemplateConfig: WorkspaceTemplateConfig = {
  organizationLine1: "UBND TỈNH ĐỒNG NAI",
  organizationLine2: "TRƯỜNG CAO ĐẲNG KỸ THUẬT - CÔNG NGHỆ ĐỒNG NAI",
  departmentLine: "KHOA / PHÒNG BAN",
  rightHeaderLine1: "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM",
  rightHeaderLine2: "Độc lập - Tự do - Hạnh phúc",
  schoolYearLabel: "Năm học 2026 - 2027",
  siteLabel: "Cơ sở",
  thvtTitle: "BẢNG TỔNG HỢP VẬT TƯ THỰC HÀNH",
  purchaseRequestTitle: "BẢNG ĐỀ NGHỊ MUA VẬT TƯ THỰC HÀNH",
  inspectionTitle: "BIÊN BẢN KIỂM TRA VẬT TƯ THỰC HÀNH CUỐI HỌC KỲ",
  requestRecipients: ["Ban Giám hiệu", "Phòng Đào tạo", "Phòng TCKT"],
  basisParagraphs: [
    "Căn cứ vào kế hoạch giảng dạy, định mức vật tư và nhu cầu thực hành.",
    "Căn cứ vào số lượng máy móc, trang thiết bị hiện có tại đơn vị.",
    "Đơn vị kính đề nghị mua các vật tư phục vụ công tác đào tạo theo bảng dưới đây.",
  ],
  signerLabels: ["Người lập", "Đơn vị", "Phòng vật tư", "Hiệu trưởng"],
};

export function normalizeWorkspaceTemplateConfig(
  value: unknown,
): WorkspaceTemplateConfig {
  const input = value && typeof value === "object" ? value : {};
  const record = input as Partial<WorkspaceTemplateConfig>;

  return {
    ...defaultWorkspaceTemplateConfig,
    ...record,
    requestRecipients: Array.isArray(record.requestRecipients)
      ? record.requestRecipients.filter((item) => typeof item === "string")
      : defaultWorkspaceTemplateConfig.requestRecipients,
    basisParagraphs: Array.isArray(record.basisParagraphs)
      ? record.basisParagraphs.filter((item) => typeof item === "string")
      : defaultWorkspaceTemplateConfig.basisParagraphs,
    signerLabels: Array.isArray(record.signerLabels)
      ? record.signerLabels.filter((item) => typeof item === "string")
      : defaultWorkspaceTemplateConfig.signerLabels,
  };
}

export function normalizeSelectedSheetTemplateIds(
  value: unknown,
): StandardSheetTemplateId[] {
  if (!Array.isArray(value)) {
    return defaultSelectedSheetTemplateIds;
  }

  const valid = new Set<string>(standardSheetTemplateIds);
  const selected = value.filter(
    (item): item is StandardSheetTemplateId =>
      typeof item === "string" && valid.has(item),
  );

  return selected.length > 0 ? Array.from(new Set(selected)) : [];
}

export function calculateBuyQuantity(input: {
  qtyTotal: number | null | undefined;
  qtyInStock: number | null | undefined;
}) {
  return Number(input.qtyTotal ?? 0) - Number(input.qtyInStock ?? 0);
}
