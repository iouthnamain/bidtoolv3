"use client";

import {
  Check,
  ClipboardPaste,
  Copy,
  FileDown,
  FileSpreadsheet,
  LinkIcon,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import {
  defaultWorkspaceTemplateConfig,
  standardSheetTemplates,
  WORKSPACE_TERM_LABELS,
  type StandardColumnKey,
  type StandardSheetTemplateId,
  type WorkspaceTerm,
  type WorkspaceTemplateConfig,
} from "~/lib/excel-workspace-standard";
import {
  isExcelWorkspaceStepAccessible,
  type ExcelWorkspaceStepId,
} from "~/lib/excel-workspace-steps";
import { Badge, EmptyState } from "~/app/_components/ui";
import { api, type RouterOutputs } from "~/trpc/react";

type WorkspacePayload = RouterOutputs["excelWorkspace"]["getWorkspace"];
type WorkspaceItem = WorkspacePayload["items"][number];
type WebCandidate = WorkspacePayload["candidates"][number];
type MaterialCandidate =
  RouterOutputs["excelWorkspace"]["searchMaterialCandidates"][number];
type SheetPreview =
  RouterOutputs["excelWorkspace"]["previewWorkbookSheets"][number];
type StepId = ExcelWorkspaceStepId;

const steps: Array<{ id: StepId; label: string }> = [
  { id: "setup", label: "Cấu hình" },
  { id: "import", label: "Nhập Excel" },
  { id: "rows", label: "Dòng vật tư" },
  { id: "research", label: "Research" },
  { id: "export", label: "Xuất Excel" },
];

const mappingFields: Array<{
  key: StandardColumnKey;
  label: string;
  description: string;
  required?: boolean;
}> = [
  {
    key: "materialName",
    label: "Tên vật tư",
    description: "Tên hoặc quy cách vật tư.",
    required: true,
  },
  { key: "specText", label: "Thông số", description: "Mô tả kỹ thuật." },
  { key: "unit", label: "ĐVT", description: "Đơn vị tính.", required: true },
  { key: "term", label: "Học kỳ", description: "Học kỳ I hoặc II." },
  {
    key: "qtyTotal",
    label: "SL tổng hợp",
    description: "Tổng số lượng cần cho kỳ.",
    required: true,
  },
  { key: "qtyInStock", label: "SL còn tồn", description: "Số lượng tồn." },
  { key: "depreciation", label: "Khấu hao", description: "Hệ số khấu hao." },
  { key: "reusePct", label: "% sử dụng lại", description: "Tỷ lệ dùng lại." },
  {
    key: "inspectionQtyTerm1",
    label: "BB kỳ I",
    description: "Số lượng kiểm tra kỳ I.",
  },
  {
    key: "inspectionQtyTerm2",
    label: "BB kỳ II",
    description: "Số lượng kiểm tra kỳ II.",
  },
  { key: "unitPrice", label: "Đơn giá", description: "Đơn giá dự kiến." },
  { key: "vendorHint", label: "Nhà cung cấp", description: "NCC / NSX." },
  { key: "originHint", label: "Xuất xứ", description: "Nước xuất xứ." },
  { key: "sourceUrl", label: "Link nguồn", description: "URL tham khảo." },
  { key: "notes", label: "Ghi chú", description: "Ghi chú nội bộ." },
];

const workspaceStatusLabels: Record<
  WorkspacePayload["workspace"]["status"],
  string
> = {
  draft: "Bản nháp",
  imported: "Đã nhập tệp",
  mapped: "Đã ghép cột",
  reviewed: "Đang chuẩn hóa",
  matched: "Đã có evidence",
  exported: "Đã xuất tệp",
  catalog_generated: "Đã tạo danh mục",
  checked: "Đã kiểm tra",
  approved: "Đã duyệt cuối",
};

const workspaceStatusTone: Record<
  WorkspacePayload["workspace"]["status"],
  "neutral" | "info" | "warning" | "success"
> = {
  draft: "neutral",
  imported: "info",
  mapped: "info",
  reviewed: "warning",
  matched: "success",
  exported: "success",
  catalog_generated: "warning",
  checked: "warning",
  approved: "success",
};

type RowFormState = {
  productName: string;
  specText: string;
  unit: string;
  term: WorkspaceTerm;
  qtyTotal: string;
  qtyInStock: string;
  depreciation: string;
  reusePct: string;
  inspectionQtyTerm1: string;
  inspectionQtyTerm2: string;
  unitPrice: string;
  vendorHint: string;
  originHint: string;
  notes: string;
};

const emptyRowForm: RowFormState = {
  productName: "",
  specText: "",
  unit: "",
  term: "term_1",
  qtyTotal: "",
  qtyInStock: "0",
  depreciation: "1",
  reusePct: "0",
  inspectionQtyTerm1: "",
  inspectionQtyTerm2: "",
  unitPrice: "",
  vendorHint: "",
  originHint: "",
  notes: "",
};

const emptyMaterialForm = {
  code: "",
  name: "",
  unit: "",
  category: "",
  specText: "",
  manufacturer: "",
  originCountry: "",
  defaultUnitPrice: "",
  sourceUrl: "",
  defaultDepreciation: "1",
  defaultReusePct: "0",
};

const emptyManualSpec = {
  productName: "",
  sourceUrl: "",
  specSummary: "",
  priceText: "",
  originCountry: "",
  evidenceText: "",
};

function numberOrNull(value: string) {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function configFromPayload(payload: WorkspacePayload): WorkspaceTemplateConfig {
  return {
    ...defaultWorkspaceTemplateConfig,
    ...(payload.workspace
      .templateConfigJson as Partial<WorkspaceTemplateConfig>),
  };
}

function selectedTemplatesFromPayload(
  payload: WorkspacePayload,
): StandardSheetTemplateId[] {
  const ids = payload.workspace.selectedSheetTemplateIds as string[];
  return ids.filter((id): id is StandardSheetTemplateId =>
    standardSheetTemplates.some((template) => template.id === id),
  );
}

function formatNumber(value: number | null | undefined) {
  return value == null ? "" : String(value);
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = reader.result;
      if (typeof value === "string") resolve(value);
      else reject(new Error("Không đọc được tệp."));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Không đọc được tệp."));
    reader.readAsDataURL(file);
  });
}

function specFromCandidate(candidate: WebCandidate | undefined) {
  return candidate?.extractedSpecJson as
    | {
        priceText?: string | null;
        priceVnd?: number | null;
        originCountry?: string | null;
        vendorName?: string | null;
        vendorDomain?: string | null;
        sourceUrl?: string | null;
        evidenceText?: string | null;
      }
    | undefined;
}

function SetupStep({
  payload,
  refetchWorkspace,
}: {
  payload: WorkspacePayload;
  refetchWorkspace: () => Promise<unknown>;
}) {
  const [config, setConfig] = useState(() => configFromPayload(payload));
  const [selectedTemplates, setSelectedTemplates] = useState(
    () => new Set(selectedTemplatesFromPayload(payload)),
  );
  const [message, setMessage] = useState<string | null>(null);
  const updateConfig =
    api.excelWorkspace.updateWorkspaceTemplateConfig.useMutation();
  const updateTemplates =
    api.excelWorkspace.setSelectedSheetTemplates.useMutation();

  useEffect(() => {
    setConfig(configFromPayload(payload));
    setSelectedTemplates(new Set(selectedTemplatesFromPayload(payload)));
  }, [payload]);

  const save = async () => {
    setMessage(null);
    await updateConfig.mutateAsync({
      workspaceId: payload.workspace.id,
      config,
    });
    await updateTemplates.mutateAsync({
      workspaceId: payload.workspace.id,
      templateIds: Array.from(selectedTemplates),
    });
    await refetchWorkspace();
    setMessage("Đã lưu cấu hình workbook.");
  };

  const updateList = (
    key: "requestRecipients" | "basisParagraphs" | "signerLabels",
    value: string,
  ) => {
    setConfig((prev) => ({
      ...prev,
      [key]: value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    }));
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
      <section className="panel p-4">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
          <div>
            <p className="text-xs font-bold tracking-[0.16em] text-slate-500 uppercase">
              Workbook standard
            </p>
            <h2 className="mt-1 text-lg font-bold text-slate-950">
              Cấu hình header và mẫu sheet
            </h2>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            disabled={updateConfig.isPending || updateTemplates.isPending}
            onClick={() => void save()}
          >
            <Check className="h-4 w-4" />
            Lưu cấu hình
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {(
            [
              ["organizationLine1", "Dòng tổ chức 1"],
              ["organizationLine2", "Dòng tổ chức 2"],
              ["departmentLine", "Đơn vị / khoa / phòng"],
              ["rightHeaderLine1", "Header phải 1"],
              ["rightHeaderLine2", "Header phải 2"],
              ["schoolYearLabel", "Năm / kỳ"],
              ["siteLabel", "Cơ sở / địa điểm"],
              ["thvtTitle", "Tiêu đề THVT"],
              ["purchaseRequestTitle", "Tiêu đề đề nghị mua"],
              ["inspectionTitle", "Tiêu đề BB kiểm tra"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="grid gap-1">
              <span className="text-xs font-semibold text-slate-600">
                {label}
              </span>
              <input
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={config[key]}
                onChange={(event) =>
                  setConfig((prev) => ({ ...prev, [key]: event.target.value }))
                }
              />
            </label>
          ))}
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <label className="grid gap-1">
            <span className="text-xs font-semibold text-slate-600">
              Kính gửi
            </span>
            <textarea
              className="h-28 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={config.requestRecipients.join("\n")}
              onChange={(event) =>
                updateList("requestRecipients", event.target.value)
              }
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-semibold text-slate-600">Căn cứ</span>
            <textarea
              className="h-28 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={config.basisParagraphs.join("\n")}
              onChange={(event) =>
                updateList("basisParagraphs", event.target.value)
              }
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-semibold text-slate-600">
              Khối ký
            </span>
            <textarea
              className="h-28 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={config.signerLabels.join("\n")}
              onChange={(event) =>
                updateList("signerLabels", event.target.value)
              }
            />
          </label>
        </div>
        {message ? (
          <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {message}
          </p>
        ) : null}
      </section>

      <section className="panel p-4">
        <h3 className="text-sm font-bold">Sheet xuất</h3>
        <p className="mt-1 text-xs text-slate-500">
          Các mẫu được chọn sẽ xuất thành tab riêng trong file Excel chuẩn.
        </p>
        <div className="mt-3 grid gap-2">
          {standardSheetTemplates.map((template) => {
            const checked = selectedTemplates.has(template.id);
            return (
              <label
                key={template.id}
                className={`rounded-xl border p-3 transition ${
                  checked
                    ? "border-sky-400 bg-sky-50"
                    : "border-slate-200 bg-white"
                }`}
              >
                <span className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={checked}
                    onChange={() =>
                      setSelectedTemplates((prev) => {
                        const next = new Set(prev);
                        if (next.has(template.id)) next.delete(template.id);
                        else next.add(template.id);
                        return next;
                      })
                    }
                  />
                  <span>
                    <span className="block text-sm font-semibold text-slate-900">
                      {template.label}
                    </span>
                    <span className="mt-1 block text-xs text-slate-500">
                      {template.description}
                    </span>
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function ImportStep({
  workspaceId,
  refetchWorkspace,
  goRows,
}: {
  workspaceId: number;
  refetchWorkspace: () => Promise<unknown>;
  goRows: () => void;
}) {
  const [sheetName, setSheetName] = useState("");
  const [headerRowIndex, setHeaderRowIndex] = useState(1);
  const [mapping, setMapping] = useState<
    Partial<Record<StandardColumnKey, string>>
  >({});
  const [message, setMessage] = useState<string | null>(null);
  const uploadWorkbook = api.excelWorkspace.uploadWorkbook.useMutation();
  const setHeader = api.excelWorkspace.setSheetHeaderRow.useMutation();
  const setMappingMutation =
    api.excelWorkspace.setStandardColumnMapping.useMutation();
  const importRows = api.excelWorkspace.importStandardRows.useMutation();
  const { data: sheets = [], refetch } =
    api.excelWorkspace.previewWorkbookSheets.useQuery(
      { workspaceId },
      { retry: false },
    );
  const activeSheet =
    sheets.find((sheet) => sheet.name === sheetName) ?? sheets[0];

  useEffect(() => {
    if (activeSheet) {
      setSheetName(activeSheet.name);
      setHeaderRowIndex(activeSheet.activeHeaderRowIndex);
      setMapping(
        activeSheet.suggestedMapping as Partial<
          Record<StandardColumnKey, string>
        >,
      );
    }
  }, [activeSheet]);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setMessage(null);
    const workbookBase64 = await fileToBase64(file);
    const result = await uploadWorkbook.mutateAsync({
      workspaceId,
      fileName: file.name,
      workbookBase64,
    });
    await Promise.all([refetch(), refetchWorkspace()]);
    setMessage(
      result.warnings.length > 0
        ? result.warnings.join(" ")
        : "Đã đọc workbook. Kiểm tra sheet, header và ghép cột trước khi nhập.",
    );
  };

  const applyHeader = async () => {
    if (!activeSheet) return;
    const result = await setHeader.mutateAsync({
      workspaceId,
      sheetName: activeSheet.name,
      headerRowIndex,
    });
    setMapping(
      result.suggestedMapping as Partial<Record<StandardColumnKey, string>>,
    );
    await Promise.all([refetch(), refetchWorkspace()]);
  };

  const importMappedRows = async () => {
    if (!activeSheet || !mapping.materialName) {
      setMessage("Cần ghép cột tên vật tư trước khi nhập.");
      return;
    }
    await setMappingMutation.mutateAsync({
      workspaceId,
      sheetName: activeSheet.name,
      headerRowIndex,
      mapping,
    });
    await importRows.mutateAsync({ workspaceId });
    await Promise.all([refetch(), refetchWorkspace()]);
    goRows();
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[0.75fr_1.25fr]">
      <section className="panel p-4">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5 text-sky-700" />
          <h2 className="text-sm font-bold">Nhập và chuẩn hóa Excel</h2>
        </div>
        <label className="mt-4 flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center hover:bg-white">
          <input
            type="file"
            accept=".xlsx"
            className="sr-only"
            aria-label="Chọn tệp Excel"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
          <span className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white">
            Chọn tệp Excel
          </span>
          <span className="mt-2 text-xs text-slate-500">
            Hỗ trợ workbook nhiều sheet, header sẽ được gợi ý tự động.
          </span>
        </label>

        {sheets.length > 0 ? (
          <>
            <label className="mt-4 grid gap-1">
              <span className="text-xs font-semibold text-slate-600">
                Sheet
              </span>
              <select
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={activeSheet?.name ?? ""}
                onChange={(event) => setSheetName(event.target.value)}
              >
                {sheets.map((sheet) => (
                  <option key={sheet.name} value={sheet.name}>
                    {sheet.name} ({sheet.rowCount} dòng)
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-3 flex items-end gap-2">
              <label className="grid flex-1 gap-1">
                <span className="text-xs font-semibold text-slate-600">
                  Dòng header
                </span>
                <input
                  type="number"
                  min={1}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={headerRowIndex}
                  onChange={(event) =>
                    setHeaderRowIndex(Number(event.target.value || 1))
                  }
                />
              </label>
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-100"
                onClick={() => void applyHeader()}
              >
                Áp dụng header
              </button>
            </div>

            <div className="mt-4 grid gap-2">
              {mappingFields.map((field) => (
                <label key={field.key} className="grid gap-1">
                  <span className="text-xs font-semibold text-slate-600">
                    {field.label}
                    {field.required ? " *" : ""}
                  </span>
                  <select
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={mapping[field.key] ?? ""}
                    onChange={(event) =>
                      setMapping((prev) => ({
                        ...prev,
                        [field.key]: event.target.value || undefined,
                      }))
                    }
                  >
                    <option value="">Chưa ghép</option>
                    {activeSheet?.headers.map((header) => (
                      <option key={`${field.key}-${header}`} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                  <span className="text-[11px] text-slate-500">
                    {field.description}
                  </span>
                </label>
              ))}
            </div>
            <button
              type="button"
              className="mt-4 w-full rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-50"
              disabled={!mapping.materialName || importRows.isPending}
              onClick={() => void importMappedRows()}
            >
              Nhập dòng chuẩn
            </button>
          </>
        ) : null}
        {message ? (
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            {message}
          </p>
        ) : null}
      </section>

      <SheetPreviewTable sheet={activeSheet} headerRowIndex={headerRowIndex} />
    </div>
  );
}

function SheetPreviewTable({
  sheet,
  headerRowIndex,
}: {
  sheet: SheetPreview | undefined;
  headerRowIndex: number;
}) {
  if (!sheet) {
    return (
      <section className="panel p-6 text-sm text-slate-500">
        Chưa có workbook để xem trước.
      </section>
    );
  }
  const rawRows = sheet.rawRows.slice(
    Math.max(0, headerRowIndex - 3),
    headerRowIndex + 8,
  );
  return (
    <section className="panel overflow-hidden p-4">
      <h2 className="text-sm font-bold">Xem trước: {sheet.name}</h2>
      <p className="mt-1 text-xs text-slate-500">
        Header gợi ý dòng {sheet.detectedHeaderRowIndex}; đang dùng dòng{" "}
        {sheet.activeHeaderRowIndex}.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-[900px] divide-y divide-slate-200 text-xs">
          <tbody className="divide-y divide-slate-100 bg-white">
            {rawRows.map((row, rowIndex) => {
              const absoluteRow =
                Math.max(0, headerRowIndex - 3) + rowIndex + 1;
              const isHeader = absoluteRow === headerRowIndex;
              return (
                <tr
                  key={`${sheet.name}-${absoluteRow}`}
                  className={isHeader ? "bg-sky-50 font-bold" : undefined}
                >
                  <td className="w-12 bg-slate-100 px-2 py-1 text-slate-500">
                    {absoluteRow}
                  </td>
                  {row.slice(0, 12).map((cell, index) => (
                    <td key={index} className="max-w-56 px-2 py-1">
                      {cell}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RowsStep({
  payload,
  refetchWorkspace,
}: {
  payload: WorkspacePayload;
  refetchWorkspace: () => Promise<unknown>;
}) {
  const [form, setForm] = useState(emptyRowForm);
  const [pasteText, setPasteText] = useState("");
  const [isPasteOpen, setIsPasteOpen] = useState(false);
  const createRow = api.excelWorkspace.createWorkspaceRow.useMutation({
    onSuccess: async () => refetchWorkspace(),
  });
  const updateRow = api.excelWorkspace.updateWorkspaceRow.useMutation({
    onSuccess: async () => refetchWorkspace(),
  });
  const deleteRow = api.excelWorkspace.deleteWorkspaceRow.useMutation({
    onSuccess: async () => refetchWorkspace(),
  });

  const rowInputFromForm = (nextForm = form) => ({
    productName: nextForm.productName,
    specText: nextForm.specText,
    unit: nextForm.unit,
    term: nextForm.term,
    qtyTotal: numberOrNull(nextForm.qtyTotal),
    qtyInStock: numberOrNull(nextForm.qtyInStock),
    depreciation: Number(nextForm.depreciation || 1),
    reusePct: Number.parseInt(nextForm.reusePct || "0", 10),
    inspectionQtyTerm1: numberOrNull(nextForm.inspectionQtyTerm1),
    inspectionQtyTerm2: numberOrNull(nextForm.inspectionQtyTerm2),
    unitPrice: numberOrNull(nextForm.unitPrice),
    vendorHint: nextForm.vendorHint || null,
    originHint: nextForm.originHint || null,
    notes: nextForm.notes,
  });

  const addRow = async () => {
    if (!form.productName.trim() || !form.unit.trim()) return;
    await createRow.mutateAsync({
      workspaceId: payload.workspace.id,
      row: rowInputFromForm(),
    });
    setForm(emptyRowForm);
  };

  const duplicateRow = async (item: WorkspaceItem) => {
    await createRow.mutateAsync({
      workspaceId: payload.workspace.id,
      row: {
        productName: item.productName,
        specText: item.specText,
        unit: item.unit,
        term: item.term === "term_2" ? "term_2" : "term_1",
        qtyTotal: item.qtyTotal,
        qtyInStock: item.qtyInStock,
        depreciation: item.depreciation,
        reusePct: item.reusePct,
        inspectionQtyTerm1: item.inspectionQtyTerm1,
        inspectionQtyTerm2: item.inspectionQtyTerm2,
        unitPrice: item.unitPrice,
        vendorHint: item.vendorHint,
        originHint: item.originHint,
        notes: item.notes,
      },
    });
  };

  const pasteRows = async () => {
    const rows = pasteText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split("\t"));
    for (const row of rows) {
      const [
        name,
        unit,
        qty,
        stock,
        term,
        specText,
        inspectionQtyTerm1,
        inspectionQtyTerm2,
        unitPrice,
        vendorHint,
        originHint,
        notes,
      ] = row;
      if (!name || !unit) continue;
      await createRow.mutateAsync({
        workspaceId: payload.workspace.id,
        row: {
          ...rowInputFromForm({
            ...emptyRowForm,
            productName: name,
            unit,
            qtyTotal: qty ?? "",
            qtyInStock: stock ?? "0",
            term: term?.includes("2") ? "term_2" : "term_1",
            specText: specText ?? "",
            inspectionQtyTerm1: inspectionQtyTerm1 ?? "",
            inspectionQtyTerm2: inspectionQtyTerm2 ?? "",
            unitPrice: unitPrice ?? "",
            vendorHint: vendorHint ?? "",
            originHint: originHint ?? "",
            notes: notes ?? "",
          }),
        },
      });
    }
    setPasteText("");
    setIsPasteOpen(false);
  };

  return (
    <section className="panel overflow-hidden p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <h2 className="text-sm font-bold">Dòng vật tư chuẩn</h2>
          <p className="mt-1 text-xs text-slate-500">
            Thực mua được tính khi xuất: SL tổng hợp trừ SL còn tồn.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            onClick={() => setIsPasteOpen(true)}
          >
            <ClipboardPaste className="h-3.5 w-3.5" />
            Dán nhiều dòng
          </button>
          <Badge tone="info">{payload.items.length} dòng</Badge>
        </div>
      </div>

      <div className="mt-4 grid gap-2 lg:grid-cols-6">
        <input
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm lg:col-span-2"
          placeholder="Tên vật tư"
          value={form.productName}
          onChange={(event) =>
            setForm({ ...form, productName: event.target.value })
          }
        />
        <input
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="ĐVT"
          value={form.unit}
          onChange={(event) => setForm({ ...form, unit: event.target.value })}
        />
        <input
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="SL tổng"
          value={form.qtyTotal}
          onChange={(event) =>
            setForm({ ...form, qtyTotal: event.target.value })
          }
        />
        <input
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="SL tồn"
          value={form.qtyInStock}
          onChange={(event) =>
            setForm({ ...form, qtyInStock: event.target.value })
          }
        />
        <button
          type="button"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          disabled={!form.productName.trim() || !form.unit.trim()}
          onClick={() => void addRow()}
        >
          <Plus className="h-4 w-4" />
          Thêm dòng
        </button>
        <input
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm lg:col-span-2"
          placeholder="Thông số"
          value={form.specText}
          onChange={(event) =>
            setForm({ ...form, specText: event.target.value })
          }
        />
        <select
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={form.term}
          onChange={(event) =>
            setForm({
              ...form,
              term: event.target.value === "term_2" ? "term_2" : "term_1",
            })
          }
        >
          <option value="term_1">Học kỳ I</option>
          <option value="term_2">Học kỳ II</option>
        </select>
        <input
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="BB kỳ I"
          value={form.inspectionQtyTerm1}
          onChange={(event) =>
            setForm({ ...form, inspectionQtyTerm1: event.target.value })
          }
        />
        <input
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="BB kỳ II"
          value={form.inspectionQtyTerm2}
          onChange={(event) =>
            setForm({ ...form, inspectionQtyTerm2: event.target.value })
          }
        />
        <input
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Đơn giá"
          value={form.unitPrice}
          onChange={(event) =>
            setForm({ ...form, unitPrice: event.target.value })
          }
        />
        <input
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Nhà cung cấp"
          value={form.vendorHint}
          onChange={(event) =>
            setForm({ ...form, vendorHint: event.target.value })
          }
        />
        <input
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Xuất xứ"
          value={form.originHint}
          onChange={(event) =>
            setForm({ ...form, originHint: event.target.value })
          }
        />
        <input
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm lg:col-span-2"
          placeholder="Ghi chú"
          value={form.notes}
          onChange={(event) => setForm({ ...form, notes: event.target.value })}
        />
      </div>

      {isPasteOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6">
          <div className="w-full max-w-3xl rounded-lg border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div>
                <h3 className="text-sm font-bold text-slate-950">
                  Dán nhanh nhiều dòng vật tư
                </h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Mỗi dòng dùng tab theo thứ tự: Tên, ĐVT, SL tổng, SL tồn, Học
                  kỳ, Thông số, BB I, BB II, Đơn giá, NCC, Xuất xứ, Ghi chú.
                </p>
              </div>
              <button
                type="button"
                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                onClick={() => setIsPasteOpen(false)}
                aria-label="Đóng nhập dán"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4">
              <textarea
                className="h-64 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs leading-5 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                value={pasteText}
                onChange={(event) => setPasteText(event.target.value)}
                placeholder={
                  "Dây điện\tMét\t10\t2\tHọc kỳ I\tCu/PVC\t1\t0\t25000\tNCC A\tViệt Nam\tGhi chú"
                }
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-500">
                  Dòng thiếu tên hoặc ĐVT sẽ được bỏ qua.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    onClick={() => setIsPasteOpen(false)}
                  >
                    Hủy
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-md bg-slate-950 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                    disabled={!pasteText.trim() || createRow.isPending}
                    onClick={() => void pasteRows()}
                  >
                    <ClipboardPaste className="h-4 w-4" />
                    Nhập dòng
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-[1780px] divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-100 text-left text-xs text-slate-600 uppercase">
            <tr>
              <th className="px-2 py-2">Xuất</th>
              <th className="px-2 py-2">Tên vật tư</th>
              <th className="px-2 py-2">Thông số</th>
              <th className="px-2 py-2">ĐVT</th>
              <th className="px-2 py-2">Kỳ</th>
              <th className="px-2 py-2">Tổng</th>
              <th className="px-2 py-2">Tồn</th>
              <th className="px-2 py-2">Thực mua</th>
              <th className="px-2 py-2">KH</th>
              <th className="px-2 py-2">% lại</th>
              <th className="px-2 py-2">BB I</th>
              <th className="px-2 py-2">BB II</th>
              <th className="px-2 py-2">Đơn giá</th>
              <th className="px-2 py-2">NCC</th>
              <th className="px-2 py-2">Xuất xứ</th>
              <th className="px-2 py-2">Ghi chú</th>
              <th className="px-2 py-2">Nguồn</th>
              <th className="px-2 py-2"> </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {payload.items.map((item) => {
              const buyQty =
                Number(item.qtyTotal ?? 0) - Number(item.qtyInStock ?? 0);
              const stockOverflow =
                Number(item.qtyInStock ?? 0) > Number(item.qtyTotal ?? 0);
              const candidate = payload.candidates.find(
                (row) => row.id === item.selectedCandidateId,
              );
              return (
                <tr key={item.id}>
                  <td className="px-2 py-2 align-top">
                    <input
                      type="checkbox"
                      checked={item.includedInExport}
                      onChange={(event) =>
                        updateRow.mutate({
                          rowId: item.id,
                          patch: { includedInExport: event.target.checked },
                        })
                      }
                    />
                  </td>
                  <EditableCell item={item} field="productName" width="w-60" />
                  <EditableCell item={item} field="specText" width="w-72" />
                  <EditableCell item={item} field="unit" width="w-20" />
                  <td className="px-2 py-2 align-top">
                    <select
                      className="w-28 rounded border border-slate-200 px-2 py-1"
                      defaultValue={item.term}
                      onChange={(event) =>
                        updateRow.mutate({
                          rowId: item.id,
                          patch: {
                            term:
                              event.target.value === "term_2"
                                ? "term_2"
                                : "term_1",
                          },
                        })
                      }
                    >
                      <option value="term_1">HK I</option>
                      <option value="term_2">HK II</option>
                    </select>
                  </td>
                  <EditableNumberCell item={item} field="qtyTotal" />
                  <EditableNumberCell item={item} field="qtyInStock" />
                  <td
                    className={`px-2 py-2 align-top font-semibold tabular-nums ${
                      stockOverflow ? "text-rose-700" : "text-slate-900"
                    }`}
                    title={
                      stockOverflow
                        ? "SL còn tồn lớn hơn SL tổng hợp; export sẽ bị chặn."
                        : undefined
                    }
                  >
                    {buyQty.toLocaleString("vi-VN")}
                  </td>
                  <EditableNumberCell item={item} field="depreciation" />
                  <EditableNumberCell item={item} field="reusePct" integer />
                  <EditableNumberCell item={item} field="inspectionQtyTerm1" />
                  <EditableNumberCell item={item} field="inspectionQtyTerm2" />
                  <EditableNumberCell item={item} field="unitPrice" integer />
                  <EditableCell item={item} field="vendorHint" width="w-40" />
                  <EditableCell item={item} field="originHint" width="w-32" />
                  <EditableCell item={item} field="notes" width="w-52" />
                  <td className="max-w-48 px-2 py-2 align-top text-xs text-slate-500">
                    {candidate ? candidate.title : "Chưa có"}
                  </td>
                  <td className="px-2 py-2 align-top">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold hover:bg-slate-100"
                        onClick={() => void duplicateRow(item)}
                      >
                        <span className="inline-flex items-center gap-1">
                          <Copy className="h-3.5 w-3.5" />
                          Nhân
                        </span>
                      </button>
                      <button
                        type="button"
                        className="rounded border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                        onClick={() => deleteRow.mutate({ rowId: item.id })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );

  function EditableCell({
    item,
    field,
    width,
  }: {
    item: WorkspaceItem;
    field:
      | "productName"
      | "specText"
      | "unit"
      | "vendorHint"
      | "originHint"
      | "notes";
    width: string;
  }) {
    return (
      <td className="px-2 py-2 align-top">
        <input
          className={`${width} rounded border border-slate-200 px-2 py-1`}
          defaultValue={item[field] ?? ""}
          onBlur={(event) =>
            updateRow.mutate({
              rowId: item.id,
              patch: { [field]: event.target.value },
            })
          }
        />
      </td>
    );
  }

  function EditableNumberCell({
    item,
    field,
    integer,
  }: {
    item: WorkspaceItem;
    field:
      | "qtyTotal"
      | "qtyInStock"
      | "depreciation"
      | "reusePct"
      | "inspectionQtyTerm1"
      | "inspectionQtyTerm2"
      | "unitPrice";
    integer?: boolean;
  }) {
    return (
      <td className="px-2 py-2 align-top">
        <input
          type="number"
          min={0}
          className="w-24 rounded border border-slate-200 px-2 py-1"
          defaultValue={formatNumber(item[field])}
          onBlur={(event) =>
            updateRow.mutate({
              rowId: item.id,
              patch: {
                [field]: event.target.value
                  ? integer
                    ? Number.parseInt(event.target.value, 10)
                    : Number(event.target.value)
                  : null,
              },
            })
          }
        />
      </td>
    );
  }
}

function ResearchStep({
  payload,
  refetchWorkspace,
}: {
  payload: WorkspacePayload;
  refetchWorkspace: () => Promise<unknown>;
}) {
  const utils = api.useUtils();
  const [activeId, setActiveId] = useState<number | null>(
    payload.items[0]?.id ?? null,
  );
  const [materialKeyword, setMaterialKeyword] = useState("");
  const [materialCandidates, setMaterialCandidates] = useState<
    MaterialCandidate[]
  >([]);
  const [activeProductTab, setActiveProductTab] = useState<"web" | "local">(
    "web",
  );
  const [manualSpec, setManualSpec] = useState(emptyManualSpec);
  const [materialForm, setMaterialForm] = useState(emptyMaterialForm);
  const [message, setMessage] = useState<string | null>(null);
  const activeItem =
    payload.items.find((item) => item.id === activeId) ?? payload.items[0];
  const candidates = payload.candidates.filter(
    (candidate) => candidate.workspaceItemId === activeItem?.id,
  );
  const localSavedCandidates = candidates.filter(
    (candidate) => candidate.provider === "material",
  );
  const localSavedMaterialIds = new Set(
    localSavedCandidates
      .map((candidate) => /^material:\/\/materials\/(\d+)$/.exec(candidate.url))
      .map((match) => (match ? Number(match[1]) : null))
      .filter((id): id is number => id !== null),
  );
  const localSearchCandidates = materialCandidates.filter(
    (candidate) => !localSavedMaterialIds.has(candidate.materialId),
  );
  const webCandidates = candidates.filter(
    (candidate) => candidate.provider !== "material",
  );
  const localProductCount =
    localSavedCandidates.length + localSearchCandidates.length;
  const selectedCandidate = payload.candidates.find(
    (candidate) => candidate.id === activeItem?.selectedCandidateId,
  );

  useEffect(() => {
    if (activeItem) {
      setMaterialKeyword(activeItem.productName);
      setMaterialForm({
        ...emptyMaterialForm,
        name: activeItem.productName,
        unit: activeItem.unit,
        specText: activeItem.specText,
        defaultUnitPrice: formatNumber(activeItem.unitPrice),
        manufacturer: activeItem.vendorHint ?? "",
        originCountry: activeItem.originHint ?? "",
      });
    }
  }, [activeItem]);

  useEffect(() => {
    setMaterialCandidates([]);
  }, [activeItem?.id]);

  const searchWeb = api.excelWorkspace.searchWebCandidates.useMutation({
    onSuccess: async (result) => {
      setActiveProductTab("web");
      setMessage(
        result.warning ?? `Tìm thấy ${result.candidates.length} nguồn web.`,
      );
      await refetchWorkspace();
    },
  });
  const searchMaterials =
    api.excelWorkspace.searchMaterialCandidates.useMutation({
      onSuccess: (result) => {
        setActiveProductTab("local");
        setMaterialCandidates(result);
        setMessage(`Tìm thấy ${result.length} vật tư trong danh mục.`);
      },
    });
  const selectWeb = api.excelWorkspace.selectWebCandidate.useMutation({
    onSuccess: async () => refetchWorkspace(),
  });
  const linkMaterial = api.excelWorkspace.linkMaterialToRow.useMutation({
    onSuccess: async () => {
      setActiveProductTab("local");
      await refetchWorkspace();
      setMaterialCandidates([]);
    },
  });
  const createMaterialAndLink =
    api.excelWorkspace.createMaterialAndLinkRow.useMutation({
      onSuccess: async () => {
        setActiveProductTab("local");
        await Promise.all([
          refetchWorkspace(),
          utils.material.searchMaterials.invalidate(),
        ]);
        setMessage("Đã tạo vật tư danh mục và liên kết dòng.");
      },
    });
  const manualMatch = api.excelWorkspace.manualMatch.useMutation({
    onSuccess: async () => {
      setManualSpec(emptyManualSpec);
      await refetchWorkspace();
    },
  });
  const clearSelected = api.excelWorkspace.clearSelectedCandidate.useMutation({
    onSuccess: async () => refetchWorkspace(),
  });

  if (!activeItem) {
    return (
      <section className="panel p-6 text-sm text-slate-500">
        Chưa có dòng vật tư để research.
      </section>
    );
  }

  const saveManual = () => {
    let domain = "manual";
    try {
      domain = new URL(manualSpec.sourceUrl).host;
    } catch {
      setMessage("URL nguồn không hợp lệ.");
      return;
    }
    manualMatch.mutate({
      rowId: activeItem.id,
      spec: {
        productName: manualSpec.productName || activeItem.productName,
        sourceUrl: manualSpec.sourceUrl,
        specSummary: manualSpec.specSummary,
        priceText: manualSpec.priceText || null,
        priceVnd: null,
        originCountry: manualSpec.originCountry || null,
        vendorDomain: domain,
        vendorName: domain,
        evidenceText: manualSpec.evidenceText || manualSpec.specSummary,
        imageUrl: null,
        brand: null,
        model: null,
        unit: activeItem.unit || null,
      },
    });
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[0.7fr_1.3fr]">
      <section className="panel p-4">
        <h2 className="text-sm font-bold">Dòng vật tư</h2>
        <div className="mt-3 grid max-h-[640px] gap-2 overflow-y-auto">
          {payload.items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`rounded-xl border p-3 text-left ${
                activeItem.id === item.id
                  ? "border-sky-400 bg-sky-50"
                  : "border-slate-200 bg-white hover:bg-slate-50"
              }`}
              onClick={() => setActiveId(item.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="line-clamp-2 text-sm font-semibold">
                  {item.productName}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold">
                  {item.selectedCandidateId ? "Có nguồn" : "Thiếu"}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {item.unit || "-"} •{" "}
                {
                  WORKSPACE_TERM_LABELS[
                    item.term === "term_2" ? "term_2" : "term_1"
                  ]
                }
              </p>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <article className="panel p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold">{activeItem.productName}</h2>
              <p className="mt-1 text-xs text-slate-500">
                {activeItem.specText || "Chưa có thông số"} • ĐVT{" "}
                {activeItem.unit || "-"}
              </p>
              {selectedCandidate ? (
                <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                  Đã chọn: {selectedCandidate.title}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                disabled={searchWeb.isPending}
                onClick={() => {
                  setActiveProductTab("web");
                  searchWeb.mutate({ rowId: activeItem.id });
                }}
              >
                <Search className="h-4 w-4" />
                {searchWeb.isPending ? "Đang tìm" : "Tìm web"}
              </button>
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-100 disabled:opacity-50"
                disabled={!selectedCandidate}
                onClick={() => clearSelected.mutate({ rowId: activeItem.id })}
              >
                Bỏ nguồn
              </button>
            </div>
          </div>
          {message ? (
            <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {message}
            </p>
          ) : null}
        </article>

        <article className="panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              className="grid w-full grid-cols-2 rounded-lg border border-slate-200 bg-slate-100 p-1 sm:w-auto"
              role="tablist"
              aria-label="Product result sources"
            >
              {(
                [
                  {
                    id: "web",
                    label: "Web searched",
                    suffix: " products",
                    count: webCandidates.length,
                  },
                  {
                    id: "local",
                    label: "Local saved",
                    suffix: " products",
                    count: localProductCount,
                  },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeProductTab === tab.id}
                  className={`inline-flex min-w-0 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-xs font-bold transition ${
                    activeProductTab === tab.id
                      ? "bg-white text-slate-950 shadow-sm"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                  onClick={() => setActiveProductTab(tab.id)}
                >
                  <span className="truncate">
                    {tab.label}
                    <span className="hidden md:inline">{tab.suffix}</span>
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] ${
                      activeProductTab === tab.id
                        ? "bg-slate-950 text-white"
                        : "bg-white text-slate-500"
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500">
              {activeProductTab === "web"
                ? "Nguồn lấy từ tìm kiếm web và nguồn ngoài."
                : "Vật tư đã lưu trong danh mục nội bộ."}
            </p>
          </div>

          {activeProductTab === "local" ? (
            <div className="mt-4 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <label className="min-w-64 flex-1">
                <span className="text-xs font-semibold text-slate-600">
                  Tìm danh mục
                </span>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={materialKeyword}
                  onChange={(event) => setMaterialKeyword(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-50"
                disabled={searchMaterials.isPending}
                onClick={() =>
                  searchMaterials.mutate({
                    rowId: activeItem.id,
                    keyword: materialKeyword,
                  })
                }
              >
                {searchMaterials.isPending ? "Đang tìm" : "Tìm danh mục"}
              </button>
            </div>
          ) : null}

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {activeProductTab === "local" ? (
              <>
                {localSavedCandidates.map((candidate) => {
                  const spec = specFromCandidate(candidate);
                  const sourceUrl = /https?:\/\//i.test(candidate.url)
                    ? candidate.url
                    : spec?.sourceUrl;
                  return (
                    <article
                      key={candidate.id}
                      className={`rounded-xl border bg-white p-4 shadow-sm ${
                        candidate.isSelected
                          ? "border-emerald-400 ring-2 ring-emerald-100"
                          : "border-sky-200"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700">
                            Danh mục
                          </span>
                          <h3 className="mt-2 font-semibold">
                            {candidate.title}
                          </h3>
                        </div>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold">
                          {candidate.confidenceScore}%
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {candidate.domain}
                      </p>
                      <p className="mt-2 line-clamp-3 text-sm text-slate-600">
                        {candidate.snippet}
                      </p>
                      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded bg-slate-50 px-2 py-1">
                          <dt className="text-slate-500">Giá</dt>
                          <dd className="font-semibold">
                            {spec?.priceText ?? spec?.priceVnd ?? "-"}
                          </dd>
                        </div>
                        <div className="rounded bg-slate-50 px-2 py-1">
                          <dt className="text-slate-500">Xuất xứ</dt>
                          <dd className="font-semibold">
                            {spec?.originCountry ?? "-"}
                          </dd>
                        </div>
                      </dl>
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
                          disabled={candidate.isSelected}
                          onClick={() =>
                            selectWeb.mutate({
                              rowId: activeItem.id,
                              candidateId: candidate.id,
                            })
                          }
                        >
                          {candidate.isSelected ? "Đã chọn" : "Chọn"}
                        </button>
                        {sourceUrl && /https?:\/\//i.test(sourceUrl) ? (
                          <a
                            href={sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold hover:bg-slate-100"
                          >
                            Mở nguồn
                          </a>
                        ) : null}
                      </div>
                    </article>
                  );
                })}

                {localSearchCandidates.map((candidate) => (
                  <article
                    key={`material-${candidate.materialId}`}
                    className="rounded-xl border border-sky-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700">
                          Danh mục
                        </span>
                        <h3 className="mt-2 font-semibold">
                          {candidate.title}
                        </h3>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold">
                        {candidate.confidenceScore}%
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      {candidate.code ? `Mã ${candidate.code} • ` : ""}ĐVT{" "}
                      {candidate.unit} • {candidate.category ?? "-"}
                    </p>
                    <button
                      type="button"
                      className="mt-3 inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-800"
                      onClick={() =>
                        linkMaterial.mutate({
                          rowId: activeItem.id,
                          materialId: candidate.materialId,
                        })
                      }
                    >
                      <LinkIcon className="h-3.5 w-3.5" />
                      Liên kết
                    </button>
                  </article>
                ))}

                {localProductCount === 0 ? (
                  <div className="col-span-full rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                    Chưa có sản phẩm đã lưu cho dòng này. Tìm danh mục để lấy
                    vật tư nội bộ.
                  </div>
                ) : null}
              </>
            ) : (
              <>
                {webCandidates.map((candidate) => {
                  const spec = specFromCandidate(candidate);
                  return (
                    <article
                      key={candidate.id}
                      className={`rounded-xl border bg-white p-4 shadow-sm ${
                        candidate.isSelected
                          ? "border-emerald-400 ring-2 ring-emerald-100"
                          : "border-slate-200"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold">{candidate.title}</h3>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold">
                          {candidate.confidenceScore}%
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {candidate.domain}
                      </p>
                      <p className="mt-2 line-clamp-3 text-sm text-slate-600">
                        {candidate.snippet}
                      </p>
                      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded bg-slate-50 px-2 py-1">
                          <dt className="text-slate-500">Giá</dt>
                          <dd className="font-semibold">
                            {spec?.priceText ?? spec?.priceVnd ?? "-"}
                          </dd>
                        </div>
                        <div className="rounded bg-slate-50 px-2 py-1">
                          <dt className="text-slate-500">Xuất xứ</dt>
                          <dd className="font-semibold">
                            {spec?.originCountry ?? "-"}
                          </dd>
                        </div>
                      </dl>
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
                          disabled={candidate.isSelected}
                          onClick={() =>
                            selectWeb.mutate({
                              rowId: activeItem.id,
                              candidateId: candidate.id,
                            })
                          }
                        >
                          {candidate.isSelected ? "Đã chọn" : "Chọn"}
                        </button>
                        {/https?:\/\//i.test(candidate.url) ? (
                          <a
                            href={candidate.url}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold hover:bg-slate-100"
                          >
                            Mở nguồn
                          </a>
                        ) : null}
                      </div>
                    </article>
                  );
                })}

                {webCandidates.length === 0 ? (
                  <div className="col-span-full rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                    Chưa có sản phẩm tìm từ web cho dòng này. Bấm Tìm web để lấy
                    nguồn.
                  </div>
                ) : null}
              </>
            )}
          </div>
        </article>

        <article className="panel p-4">
          <h3 className="text-sm font-bold">Thêm nguồn / danh mục thủ công</h3>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 p-3">
              <p className="text-xs font-bold text-slate-600">
                Tạo vật tư danh mục và liên kết
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {(
                  [
                    "code",
                    "name",
                    "unit",
                    "category",
                    "manufacturer",
                    "originCountry",
                    "defaultUnitPrice",
                    "sourceUrl",
                  ] as const
                ).map((key) => (
                  <input
                    key={key}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder={key}
                    value={materialForm[key]}
                    onChange={(event) =>
                      setMaterialForm((prev) => ({
                        ...prev,
                        [key]: event.target.value,
                      }))
                    }
                  />
                ))}
              </div>
              <textarea
                className="mt-2 h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Thông số"
                value={materialForm.specText}
                onChange={(event) =>
                  setMaterialForm((prev) => ({
                    ...prev,
                    specText: event.target.value,
                  }))
                }
              />
              <button
                type="button"
                className="mt-2 rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-50"
                disabled={!materialForm.name || !materialForm.unit}
                onClick={() =>
                  createMaterialAndLink.mutate({
                    rowId: activeItem.id,
                    material: {
                      code: materialForm.code || undefined,
                      name: materialForm.name,
                      unit: materialForm.unit,
                      category: materialForm.category || undefined,
                      specText: materialForm.specText || undefined,
                      manufacturer: materialForm.manufacturer || undefined,
                      originCountry: materialForm.originCountry || undefined,
                      defaultUnitPrice: numberOrNull(
                        materialForm.defaultUnitPrice,
                      ),
                      currency: "VND",
                      sourceUrl: materialForm.sourceUrl || undefined,
                      defaultDepreciation: Number(
                        materialForm.defaultDepreciation || 1,
                      ),
                      defaultReusePct: Number.parseInt(
                        materialForm.defaultReusePct || "0",
                        10,
                      ),
                    },
                  })
                }
              >
                Tạo và liên kết
              </button>
            </div>

            <div className="rounded-xl border border-slate-200 p-3">
              <p className="text-xs font-bold text-slate-600">
                Nguồn ngoài thủ công
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <input
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Tên khớp"
                  value={manualSpec.productName}
                  onChange={(event) =>
                    setManualSpec({
                      ...manualSpec,
                      productName: event.target.value,
                    })
                  }
                />
                <input
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="URL nguồn"
                  value={manualSpec.sourceUrl}
                  onChange={(event) =>
                    setManualSpec({
                      ...manualSpec,
                      sourceUrl: event.target.value,
                    })
                  }
                />
                <input
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Giá"
                  value={manualSpec.priceText}
                  onChange={(event) =>
                    setManualSpec({
                      ...manualSpec,
                      priceText: event.target.value,
                    })
                  }
                />
                <input
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Xuất xứ"
                  value={manualSpec.originCountry}
                  onChange={(event) =>
                    setManualSpec({
                      ...manualSpec,
                      originCountry: event.target.value,
                    })
                  }
                />
              </div>
              <textarea
                className="mt-2 h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Thông số / evidence"
                value={manualSpec.specSummary}
                onChange={(event) =>
                  setManualSpec({
                    ...manualSpec,
                    specSummary: event.target.value,
                  })
                }
              />
              <button
                type="button"
                className="mt-2 rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                disabled={!manualSpec.sourceUrl}
                onClick={saveManual}
              >
                Lưu nguồn ngoài
              </button>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}

function ExportStep({ payload }: { payload: WorkspacePayload }) {
  const { data, refetch, isLoading } =
    api.excelWorkspace.validateWorkspaceForExport.useQuery({
      workspaceId: payload.workspace.id,
    });
  const selectedTemplates = selectedTemplatesFromPayload(payload);
  const errors =
    data?.issues.filter((issue) => issue.severity === "error") ?? [];
  const warnings =
    data?.issues.filter((issue) => issue.severity === "warning") ?? [];

  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold tracking-[0.16em] text-slate-500 uppercase">
            Standard XLSX
          </p>
          <h2 className="mt-2 text-xl font-bold text-slate-950">
            Kiểm tra và xuất workbook chuẩn
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Export dùng các sheet đã chọn và công thức thực mua trong file
            Excel.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-100"
            onClick={() => void refetch()}
          >
            Kiểm tra lại
          </button>
          <a
            href={`/api/excel-workspace/${payload.workspace.id}/standard-export`}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ${
              errors.length > 0
                ? "pointer-events-none bg-slate-300 text-slate-500"
                : "bg-emerald-700 text-white hover:bg-emerald-800"
            }`}
          >
            <FileDown className="h-4 w-4" />
            Tải Excel
          </a>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <SummaryCard
          label="Dòng xuất"
          value={payload.items.filter((item) => item.includedInExport).length}
        />
        <SummaryCard label="Sheet" value={selectedTemplates.length} />
        <SummaryCard
          label="Lỗi chặn"
          value={isLoading ? "..." : errors.length}
        />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <IssueList title="Lỗi cần sửa" tone="error" issues={errors} />
        <IssueList title="Cảnh báo" tone="warning" issues={warnings} />
      </div>
    </section>
  );
}

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </article>
  );
}

function IssueList({
  title,
  tone,
  issues,
}: {
  title: string;
  tone: "error" | "warning";
  issues: Array<{ code: string; message: string }>;
}) {
  const color =
    tone === "error"
      ? "border-rose-200 bg-rose-50 text-rose-800"
      : "border-amber-200 bg-amber-50 text-amber-800";
  return (
    <article className={`rounded-xl border p-4 ${color}`}>
      <h3 className="text-sm font-bold">{title}</h3>
      {issues.length === 0 ? (
        <p className="mt-2 text-sm">Không có.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {issues.map((issue, index) => (
            <li key={`${issue.code}-${index}`}>
              <span className="font-semibold">{issue.code}:</span>{" "}
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function ExcelWorkspaceWizardClient({
  workspaceId,
  initialData,
}: {
  workspaceId: number;
  initialData?: WorkspacePayload;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const stepParam = searchParams.get("step") as StepId | null;
  const requestedStep = steps.some((step) => step.id === stepParam)
    ? stepParam
    : null;
  const workspaceQuery = api.excelWorkspace.getWorkspace.useQuery(
    { id: workspaceId },
    { initialData },
  );
  const payload = workspaceQuery.data;

  const setStep = (step: StepId) => {
    router.replace(`/excel-workspace/${workspaceId}?step=${step}`, {
      scroll: false,
    });
  };

  useEffect(() => {
    if (!payload) return;
    if (
      !requestedStep ||
      !isExcelWorkspaceStepAccessible(requestedStep, payload.routeMeta.maxStep)
    ) {
      router.replace(
        `/excel-workspace/${workspaceId}?step=${payload.routeMeta.nextStep}`,
        { scroll: false },
      );
    }
  }, [payload, requestedStep, router, workspaceId]);

  if (workspaceQuery.isError) {
    return (
      <EmptyState
        title="Không tải được workspace"
        description={workspaceQuery.error.message}
        cta={
          <button
            type="button"
            className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
            onClick={() => workspaceQuery.refetch()}
          >
            Tải lại
          </button>
        }
      />
    );
  }

  if (!payload) {
    return <div className="panel p-5 text-sm text-slate-600">Đang tải...</div>;
  }

  const activeStep =
    requestedStep &&
    isExcelWorkspaceStepAccessible(requestedStep, payload.routeMeta.maxStep)
      ? requestedStep
      : payload.routeMeta.nextStep;
  const maxStepIndex = steps.findIndex(
    (step) => step.id === payload.routeMeta.maxStep,
  );
  const evidenceCount = payload.items.filter(
    (item) => item.selectedCandidateId,
  ).length;

  return (
    <div className="space-y-3">
      <section className="panel px-4 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="min-w-0 flex-1">
            <Link
              href="/excel-workspace"
              className="inline-flex items-center text-[11px] font-semibold text-slate-500 transition-colors hover:text-slate-900"
            >
              ← Quay lại danh sách
            </Link>
            <h1 className="mt-0.5 truncate text-base leading-tight font-bold text-slate-950">
              {payload.workspace.name}
            </h1>
            <p className="truncate text-xs text-slate-500">
              {payload.workspace.sourceFileName ?? "Chưa nhập tệp"} ·{" "}
              {payload.workspace.sourceSheetName ?? "Chưa chọn sheet"} ·{" "}
              {payload.routeMeta.importedItemCount.toLocaleString("vi-VN")} dòng
              · {evidenceCount.toLocaleString("vi-VN")} có nguồn
            </p>
          </div>
          <Badge tone={workspaceStatusTone[payload.workspace.status]}>
            {workspaceStatusLabels[payload.workspace.status]}
          </Badge>
        </div>

        <nav className="mt-2 flex flex-wrap gap-1 border-t border-slate-200 pt-2">
          {steps.map((step, index) => {
            const isActive = activeStep === step.id;
            const isLocked = index > maxStepIndex;
            const isDone = !isActive && index < maxStepIndex;
            return (
              <button
                key={step.id}
                type="button"
                disabled={isLocked}
                onClick={() => setStep(step.id)}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition disabled:cursor-not-allowed ${
                  isActive
                    ? "bg-slate-950 text-white"
                    : isDone
                      ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                      : isLocked
                        ? "bg-white text-slate-400"
                        : "bg-white text-slate-700 hover:bg-slate-100"
                }`}
              >
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-current/10 text-[10px]">
                  {isDone ? "✓" : index + 1}
                </span>
                {step.label}
              </button>
            );
          })}
        </nav>
      </section>

      {activeStep === "setup" ? (
        <SetupStep
          payload={payload}
          refetchWorkspace={workspaceQuery.refetch}
        />
      ) : null}
      {activeStep === "import" ? (
        <ImportStep
          workspaceId={workspaceId}
          refetchWorkspace={workspaceQuery.refetch}
          goRows={() => setStep("rows")}
        />
      ) : null}
      {activeStep === "rows" ? (
        <RowsStep payload={payload} refetchWorkspace={workspaceQuery.refetch} />
      ) : null}
      {activeStep === "research" ? (
        <ResearchStep
          payload={payload}
          refetchWorkspace={workspaceQuery.refetch}
        />
      ) : null}
      {activeStep === "export" ? <ExportStep payload={payload} /> : null}
    </div>
  );
}
