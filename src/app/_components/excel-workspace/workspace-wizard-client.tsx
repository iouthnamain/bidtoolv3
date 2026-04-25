"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { api, type RouterOutputs } from "~/trpc/react";

type WorkspacePayload = RouterOutputs["excelWorkspace"]["getWorkspace"];
type WorkspaceItem = WorkspacePayload["items"][number];
type WebCandidate = WorkspacePayload["candidates"][number];
type MaterialCandidate =
  RouterOutputs["excelWorkspace"]["searchMaterialCandidates"][number];
type SheetPreview =
  RouterOutputs["excelWorkspace"]["previewWorkbookSheets"][number];

type StepId = "import" | "map" | "review" | "find" | "export";
type MappingKey =
  | "productName"
  | "specText"
  | "unit"
  | "quantity"
  | "targetPrice"
  | "currency"
  | "vendorHint"
  | "originHint"
  | "notes";

const steps: Array<{ id: StepId; label: string }> = [
  { id: "import", label: "Nhập tệp" },
  { id: "map", label: "Ghép cột" },
  { id: "review", label: "Duyệt dòng" },
  { id: "find", label: "Tìm sản phẩm" },
  { id: "export", label: "Xuất tệp" },
];

const mappingFields: Array<{
  key: MappingKey;
  label: string;
  description: string;
  required?: boolean;
}> = [
  {
    key: "productName",
    label: "Tên sản phẩm",
    description:
      "Cột bắt buộc, dùng làm tên hàng để tạo dòng sản phẩm và tìm nguồn đối chiếu.",
    required: true,
  },
  {
    key: "specText",
    label: "Thông số / mô tả",
    description:
      "Cột chứa quy cách, cấu hình, mã mẫu hoặc yêu cầu kỹ thuật của sản phẩm.",
  },
  {
    key: "unit",
    label: "Đơn vị tính",
    description:
      "Cột đơn vị như cái, bộ, hộp hoặc kg để so sánh báo giá chính xác hơn.",
  },
  {
    key: "quantity",
    label: "Số lượng",
    description: "Cột số lượng cần mua cho từng dòng trong tệp Excel.",
  },
  {
    key: "targetPrice",
    label: "Giá mục tiêu",
    description: "Cột ngân sách hoặc đơn giá dự kiến nếu tệp có thông tin này.",
  },
  {
    key: "currency",
    label: "Tiền tệ",
    description: "Cột mã hoặc tên tiền tệ, ví dụ VND hoặc USD.",
  },
  {
    key: "vendorHint",
    label: "Gợi ý nhà cung cấp",
    description: "Cột tên hãng, đại lý hoặc nhà bán hàng muốn ưu tiên.",
  },
  {
    key: "originHint",
    label: "Gợi ý xuất xứ",
    description: "Cột nước xuất xứ hoặc vùng sản xuất cần đối chiếu.",
  },
  {
    key: "notes",
    label: "Ghi chú",
    description: "Cột ràng buộc bổ sung, yêu cầu giao hàng hoặc lưu ý nội bộ.",
  },
];

const workspaceStatusLabels: Record<
  WorkspacePayload["workspace"]["status"],
  string
> = {
  draft: "Bản nháp",
  imported: "Đã nhập tệp",
  mapped: "Đã ghép cột",
  reviewed: "Đã duyệt dòng",
  matched: "Đã chọn sản phẩm",
  exported: "Đã xuất tệp",
  catalog_generated: "Đã tạo danh mục",
  checked: "Đã kiểm tra",
  approved: "Đã duyệt cuối",
};

const matchStatusLabels: Record<WorkspaceItem["matchStatus"], string> = {
  unmatched: "Chưa khớp",
  candidates_found: "Có gợi ý",
  matched: "Đã chọn",
  manual: "Nhập thủ công",
};

function displayWorkspaceName(name: string) {
  return name === "Product sourcing workspace"
    ? "Không gian tìm nguồn sản phẩm"
    : name;
}

const emptyManualSpec = {
  productName: "",
  sourceUrl: "",
  specSummary: "",
  priceText: "",
  originCountry: "",
  evidenceText: "",
};

const emptyMaterialForm = {
  code: "",
  name: "",
  unit: "",
  category: "",
  defaultDepreciation: "1",
  defaultReusePct: "0",
};

function specFromCandidate(candidate: WebCandidate | undefined) {
  return candidate?.extractedSpecJson as
    | {
        productName?: string;
        brand?: string | null;
        model?: string | null;
        specSummary?: string;
        unit?: string | null;
        priceText?: string | null;
        priceVnd?: number | null;
        originCountry?: string | null;
        vendorName?: string | null;
        vendorDomain?: string;
        sourceUrl?: string;
        evidenceText?: string;
        imageUrl?: string | null;
      }
    | undefined;
}

function candidateSourceLabel(provider: string) {
  if (provider === "material") {
    return "Danh mục";
  }
  if (provider === "manual") {
    return "Thủ công";
  }
  return "Nguồn web";
}

function candidateBadgeClass(provider: string) {
  if (provider === "material") {
    return "bg-sky-100 text-sky-700";
  }
  if (provider === "manual") {
    return "bg-violet-100 text-violet-700";
  }
  return "bg-slate-100 text-slate-700";
}

function formatOptionalValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (typeof value === "number") {
    return value.toLocaleString("vi-VN");
  }
  return value;
}

function statusClass(status: WorkspaceItem["matchStatus"]) {
  if (status === "matched" || status === "manual") {
    return "bg-emerald-100 text-emerald-700";
  }
  if (status === "candidates_found") {
    return "bg-amber-100 text-amber-700";
  }
  return "bg-slate-100 text-slate-600";
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = reader.result;
      if (typeof value === "string") {
        resolve(value);
      } else {
        reject(new Error("Không đọc được tệp."));
      }
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Không đọc được tệp."));
    reader.readAsDataURL(file);
  });
}

function downloadBase64Xlsx(fileName: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function StepNav({
  activeStep,
  setStep,
}: {
  activeStep: StepId;
  setStep: (step: StepId) => void;
}) {
  return (
    <nav
      className="panel flex flex-wrap gap-2 p-2"
      aria-label="Các bước xử lý tệp Excel"
    >
      {steps.map((step, index) => {
        const isActive = activeStep === step.id;
        return (
          <button
            key={step.id}
            type="button"
            onClick={() => setStep(step.id)}
            aria-current={isActive ? "step" : undefined}
            aria-label={`${index + 1}. ${step.label}${isActive ? " đang mở" : ""}`}
            className={`rounded-lg px-3 py-2 text-xs font-bold transition ${
              isActive
                ? "bg-slate-950 text-white"
                : "bg-white text-slate-700 hover:bg-slate-100"
            }`}
          >
            {index + 1}. {step.label}
          </button>
        );
      })}
    </nav>
  );
}

function ImportStep({
  workspaceId,
  refetchWorkspace,
  goMap,
}: {
  workspaceId: number;
  refetchWorkspace: () => Promise<unknown>;
  goMap: () => void;
}) {
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const uploadWorkbook = api.excelWorkspace.uploadWorkbook.useMutation({
    onSuccess: async () => {
      setError(null);
      await refetchWorkspace();
      goMap();
    },
    onError: (nextError) => setError(nextError.message),
  });

  const handleFile = async (file: File | undefined) => {
    if (!file) {
      return;
    }

    setFileName(file.name);
    setError(null);
    const workbookBase64 = await fileToBase64(file);
    uploadWorkbook.mutate({
      workspaceId,
      fileName: file.name,
      workbookBase64,
    });
  };

  return (
    <section className="panel p-5">
      <div className="max-w-3xl">
        <p className="text-xs font-bold tracking-[0.16em] text-slate-500 uppercase">
          Tệp nguồn
        </p>
        <h2 className="mt-2 text-xl font-bold text-slate-950">
          Nhập bảng sản phẩm từ Excel
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Tải lên tệp `.xls` hoặc `.xlsx`. Các cột gốc được giữ nguyên; bước
          xuất tệp sẽ bổ sung thông tin sản phẩm khớp và bằng chứng đối chiếu.
        </p>
      </div>

      <label className="mt-5 flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center transition hover:border-slate-500 hover:bg-white">
        <input
          type="file"
          accept=".xls,.xlsx"
          className="sr-only"
          aria-label="Chọn tệp Excel để nhập vào không gian làm việc"
          onChange={(event) => void handleFile(event.target.files?.[0])}
        />
        <span className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800">
          Chọn tệp Excel
        </span>
        <span className="mt-3 text-sm text-slate-500">
          {fileName || "Chưa chọn tệp nào"}
        </span>
      </label>

      {uploadWorkbook.isPending ? (
        <p className="mt-3 text-sm text-slate-600">Đang đọc tệp...</p>
      ) : null}
      {error ? (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function MapStep({
  workspaceId,
  refetchWorkspace,
  goReview,
}: {
  workspaceId: number;
  refetchWorkspace: () => Promise<unknown>;
  goReview: () => void;
}) {
  const [sheetName, setSheetName] = useState("");
  const [mapping, setMapping] = useState<Partial<Record<MappingKey, string>>>(
    {},
  );
  const [error, setError] = useState<string | null>(null);
  const { data: sheets = [], refetch } =
    api.excelWorkspace.previewWorkbookSheets.useQuery({ workspaceId });
  const setColumnMapping = api.excelWorkspace.setColumnMapping.useMutation();
  const importMappedRows = api.excelWorkspace.importMappedRows.useMutation();
  const activeSheet =
    sheets.find((sheet) => sheet.name === sheetName) ?? sheets[0];

  useEffect(() => {
    if (!sheetName && sheets[0]) {
      setSheetName(sheets[0].name);
      setMapping(
        sheets[0].suggestedMapping as Partial<Record<MappingKey, string>>,
      );
    }
  }, [sheetName, sheets]);

  useEffect(() => {
    if (activeSheet) {
      setMapping(
        activeSheet.suggestedMapping as Partial<Record<MappingKey, string>>,
      );
    }
  }, [activeSheet]);

  const saveAndImport = async () => {
    if (!activeSheet || !mapping.productName) {
      setError("Cần chọn cột tên sản phẩm trước khi nhập dòng.");
      return;
    }

    setError(null);
    try {
      await setColumnMapping.mutateAsync({
        workspaceId,
        sheetName: activeSheet.name,
        mapping,
      });
      await importMappedRows.mutateAsync({ workspaceId });
      await Promise.all([refetchWorkspace(), refetch()]);
      goReview();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Không nhập được dòng.",
      );
    }
  };

  if (sheets.length === 0) {
    return (
      <section className="panel p-6 text-sm text-slate-600">
        Hãy tải tệp Excel lên trước khi ghép cột.
      </section>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[0.75fr_1.25fr]">
      <section className="panel p-4">
        <h2 className="text-sm font-bold">Ghép cột từ Excel</h2>
        <p className="mt-1 text-xs text-slate-500">
          Chọn trang tính và gán từng trường chuẩn với cột tương ứng trong tệp.
        </p>
        <label
          htmlFor="map-sheet-select"
          className="mt-4 block text-xs font-semibold text-slate-600"
        >
          Trang tính
        </label>
        <select
          id="map-sheet-select"
          className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          value={activeSheet?.name ?? ""}
          aria-describedby="map-sheet-description"
          aria-label="Chọn trang tính Excel để ghép cột"
          onChange={(event) => setSheetName(event.target.value)}
        >
          {sheets.map((sheet) => (
            <option key={sheet.name} value={sheet.name}>
              {sheet.name} ({sheet.rowCount.toLocaleString("vi-VN")} dòng)
            </option>
          ))}
        </select>
        <p id="map-sheet-description" className="mt-1 text-xs text-slate-500">
          Hệ thống dùng trang tính đang chọn để gợi ý cột và nhập dữ liệu.
        </p>

        <div className="mt-4 grid gap-3">
          {mappingFields.map((field) => {
            const fieldSelectId = `map-field-${field.key}`;
            const fieldDescriptionId = `map-field-${field.key}-description`;

            return (
              <label
                key={field.key}
                htmlFor={fieldSelectId}
                className="grid gap-1"
              >
                <span className="text-xs font-semibold text-slate-600">
                  {field.label}
                  {field.required ? " *" : ""}
                </span>
                <select
                  id={fieldSelectId}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={mapping[field.key] ?? ""}
                  aria-describedby={fieldDescriptionId}
                  aria-label={`Chọn cột Excel cho trường ${field.label}`}
                  aria-required={field.required ? true : undefined}
                  aria-invalid={
                    field.required && !mapping[field.key] ? true : undefined
                  }
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
                <span
                  id={fieldDescriptionId}
                  className="text-[11px] leading-snug text-slate-500"
                >
                  {field.description}
                </span>
              </label>
            );
          })}
        </div>

        <p id="map-save-description" className="mt-4 text-xs text-slate-500">
          Bắt buộc chọn cột tên sản phẩm. Sau khi lưu, hệ thống sẽ tạo các dòng
          để duyệt ở bước tiếp theo.
        </p>
        <button
          type="button"
          className="mt-3 w-full rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          aria-describedby="map-save-description"
          aria-label="Lưu cách ghép cột và nhập dòng từ trang tính đang chọn"
          disabled={
            !mapping.productName ||
            setColumnMapping.isPending ||
            importMappedRows.isPending
          }
          onClick={() => void saveAndImport()}
        >
          Lưu ghép cột và nhập dòng
        </button>
        {error ? (
          <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}
      </section>

      <SheetPreviewTable sheet={activeSheet} />
    </div>
  );
}

function SheetPreviewTable({ sheet }: { sheet: SheetPreview | undefined }) {
  if (!sheet) {
    return null;
  }

  return (
    <section
      className="panel overflow-hidden p-4"
      aria-labelledby="sheet-preview-title"
      aria-describedby="sheet-preview-description"
    >
      <div className="border-b border-slate-200 pb-3">
        <h2 id="sheet-preview-title" className="text-sm font-bold">
          Xem trước: {sheet.name}
        </h2>
        <p
          id="sheet-preview-description"
          className="mt-1 text-xs text-slate-500"
        >
          Dòng tiêu đề {sheet.headerRowIndex}; hiển thị tối đa 8 dòng đầu đã đọc
          từ trang tính để kiểm tra trước khi nhập.
        </p>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table
          className="min-w-[760px] divide-y divide-slate-200 text-sm"
          aria-describedby="sheet-preview-description"
        >
          <caption className="sr-only">
            Bảng xem trước trang tính {sheet.name}, gồm các cột được đọc từ tệp
            Excel.
          </caption>
          <thead className="bg-slate-100 text-left text-xs text-slate-600 uppercase">
            <tr>
              {sheet.headers.map((header) => (
                <th key={header} scope="col" className="px-3 py-2">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {sheet.previewRows.slice(0, 8).map((row, index) => (
              <tr key={`${sheet.name}-${index}`}>
                {sheet.headers.map((header) => (
                  <td key={`${index}-${header}`} className="px-3 py-2">
                    {row[header] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReviewStep({
  payload,
  refetchWorkspace,
  goFind,
}: {
  payload: WorkspacePayload;
  refetchWorkspace: () => Promise<unknown>;
  goFind: () => void;
}) {
  const updateRow = api.excelWorkspace.updateImportedRow.useMutation({
    onSuccess: async () => refetchWorkspace(),
  });
  const transitionState = api.excelWorkspace.transitionState.useMutation({
    onSuccess: async () => {
      await refetchWorkspace();
      goFind();
    },
  });

  return (
    <section className="panel overflow-hidden p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <h2 className="text-sm font-bold">Duyệt dòng sản phẩm đã nhập</h2>
          <p className="mt-1 text-xs text-slate-500">
            Sửa tên hoặc thông số trước khi tìm nguồn. Thay đổi được lưu khi rời
            khỏi ô nhập.
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          disabled={payload.items.length === 0 || transitionState.isPending}
          onClick={() =>
            transitionState.mutate({ id: payload.workspace.id, to: "reviewed" })
          }
        >
          Đánh dấu đã duyệt
        </button>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="min-w-[1180px] divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-100 text-left text-xs tracking-wide text-slate-600 uppercase">
            <tr>
              <th scope="col" className="px-3 py-2">
                Dòng Excel
              </th>
              <th scope="col" className="px-3 py-2">
                Tên sản phẩm
              </th>
              <th scope="col" className="px-3 py-2">
                Thông số
              </th>
              <th scope="col" className="px-3 py-2">
                Đơn vị
              </th>
              <th scope="col" className="px-3 py-2">
                Số lượng
              </th>
              <th scope="col" className="px-3 py-2">
                Ngân sách
              </th>
              <th scope="col" className="px-3 py-2">
                Tiền tệ
              </th>
              <th scope="col" className="px-3 py-2">
                Nhà cung cấp
              </th>
              <th scope="col" className="px-3 py-2">
                Xuất xứ
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {payload.items.map((item) => (
              <tr key={item.id}>
                <td className="px-3 py-2 align-top text-xs text-slate-500">
                  {item.originalRowIndex}
                </td>
                <td className="px-3 py-2 align-top">
                  <input
                    className="w-56 rounded border border-slate-200 px-2 py-1"
                    defaultValue={item.productName}
                    aria-label={`Tên sản phẩm ở dòng Excel ${item.originalRowIndex}`}
                    onBlur={(event) =>
                      updateRow.mutate({
                        rowId: item.id,
                        patch: { productName: event.target.value },
                      })
                    }
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <textarea
                    className="h-16 w-72 rounded border border-slate-200 px-2 py-1"
                    defaultValue={item.specText}
                    aria-label={`Thông số ở dòng Excel ${item.originalRowIndex}`}
                    onBlur={(event) =>
                      updateRow.mutate({
                        rowId: item.id,
                        patch: { specText: event.target.value },
                      })
                    }
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <input
                    className="w-20 rounded border border-slate-200 px-2 py-1"
                    defaultValue={item.unit}
                    aria-label={`Đơn vị tính ở dòng Excel ${item.originalRowIndex}`}
                    onBlur={(event) =>
                      updateRow.mutate({
                        rowId: item.id,
                        patch: { unit: event.target.value },
                      })
                    }
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <input
                    type="number"
                    min={0}
                    className="w-24 rounded border border-slate-200 px-2 py-1"
                    defaultValue={item.quantity ?? ""}
                    aria-label={`Số lượng ở dòng Excel ${item.originalRowIndex}`}
                    onBlur={(event) =>
                      updateRow.mutate({
                        rowId: item.id,
                        patch: {
                          quantity: event.target.value
                            ? Number(event.target.value)
                            : null,
                        },
                      })
                    }
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <input
                    type="number"
                    min={0}
                    className="w-28 rounded border border-slate-200 px-2 py-1"
                    defaultValue={item.targetPrice ?? ""}
                    aria-label={`Giá mục tiêu ở dòng Excel ${item.originalRowIndex}`}
                    onBlur={(event) =>
                      updateRow.mutate({
                        rowId: item.id,
                        patch: {
                          targetPrice: event.target.value
                            ? Number(event.target.value)
                            : null,
                        },
                      })
                    }
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <input
                    className="w-20 rounded border border-slate-200 px-2 py-1"
                    defaultValue={item.currency}
                    aria-label={`Tiền tệ ở dòng Excel ${item.originalRowIndex}`}
                    onBlur={(event) =>
                      updateRow.mutate({
                        rowId: item.id,
                        patch: { currency: event.target.value },
                      })
                    }
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <input
                    className="w-32 rounded border border-slate-200 px-2 py-1"
                    defaultValue={item.vendorHint ?? ""}
                    aria-label={`Nhà cung cấp gợi ý ở dòng Excel ${item.originalRowIndex}`}
                    onBlur={(event) =>
                      updateRow.mutate({
                        rowId: item.id,
                        patch: { vendorHint: event.target.value || null },
                      })
                    }
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <input
                    className="w-28 rounded border border-slate-200 px-2 py-1"
                    defaultValue={item.originHint ?? ""}
                    aria-label={`Xuất xứ gợi ý ở dòng Excel ${item.originalRowIndex}`}
                    onBlur={(event) =>
                      updateRow.mutate({
                        rowId: item.id,
                        patch: { originHint: event.target.value || null },
                      })
                    }
                  />
                </td>
              </tr>
            ))}
            {payload.items.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-3 py-8 text-center text-slate-500"
                >
                  Chưa có dòng nào từ Excel.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FindStep({
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
  const [warning, setWarning] = useState<string | null>(null);
  const [manualSpec, setManualSpec] = useState(emptyManualSpec);
  const [materialKeyword, setMaterialKeyword] = useState("");
  const [materialCandidates, setMaterialCandidates] = useState<
    MaterialCandidate[]
  >([]);
  const [materialForm, setMaterialForm] = useState(emptyMaterialForm);
  const [materialMessage, setMaterialMessage] = useState<string | null>(null);
  const activeItem =
    payload.items.find((item) => item.id === activeId) ?? payload.items[0];
  const activeItemId = activeItem?.id ?? null;
  const activeItemName = activeItem?.productName ?? "";
  const activeItemUnit = activeItem?.unit ?? "";
  const candidates = payload.candidates.filter(
    (candidate) => candidate.workspaceItemId === activeItem?.id,
  );
  const selectedCandidate = payload.candidates.find(
    (candidate) => candidate.id === activeItem?.selectedCandidateId,
  );
  const persistedMaterialUrls = new Set(
    candidates
      .filter((candidate) => candidate.provider === "material")
      .map((candidate) => candidate.url),
  );
  const visibleMaterialCandidates = materialCandidates.filter(
    (candidate) =>
      !persistedMaterialUrls.has(
        `material://materials/${candidate.materialId}`,
      ),
  );

  useEffect(() => {
    if (!activeItemId) {
      return;
    }

    setWarning(null);
    setMaterialMessage(null);
    setMaterialCandidates([]);
    setMaterialKeyword(activeItemName);
    setMaterialForm({
      ...emptyMaterialForm,
      name: activeItemName,
      unit: activeItemUnit,
    });
  }, [activeItemId, activeItemName, activeItemUnit]);

  const searchWeb = api.excelWorkspace.searchWebCandidates.useMutation({
    onSuccess: async (result) => {
      setWarning(result.warning ?? null);
      await refetchWorkspace();
    },
  });
  const searchMaterials =
    api.excelWorkspace.searchMaterialCandidates.useMutation({
      onSuccess: (result) => {
        setMaterialMessage(
          result.length > 0
            ? `Tìm thấy ${result.length.toLocaleString("vi-VN")} sản phẩm / vật tư.`
            : "Chưa tìm thấy sản phẩm / vật tư phù hợp.",
        );
        setMaterialCandidates(result);
      },
      onError: (nextError) => setMaterialMessage(nextError.message),
    });
  const selectCandidate = api.excelWorkspace.selectWebCandidate.useMutation({
    onSuccess: async () => refetchWorkspace(),
  });
  const selectMaterial = api.excelWorkspace.selectMaterialCandidate.useMutation(
    {
      onSuccess: async () => {
        setMaterialCandidates([]);
        setMaterialMessage("Đã chọn sản phẩm / vật tư từ danh mục nội bộ.");
        await refetchWorkspace();
      },
      onError: (nextError) => setMaterialMessage(nextError.message),
    },
  );
  const createMaterialAndMatch =
    api.excelWorkspace.createMaterialAndMatch.useMutation({
      onSuccess: async () => {
        setMaterialCandidates([]);
        setMaterialMessage(
          "Đã thêm sản phẩm / vật tư vào danh mục nội bộ và chọn cho dòng hiện tại.",
        );
        setMaterialForm(emptyMaterialForm);
        await Promise.all([
          refetchWorkspace(),
          utils.material.searchMaterials.invalidate(),
        ]);
      },
      onError: (nextError) => setMaterialMessage(nextError.message),
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

  const searchMaterialCandidates = () => {
    if (!activeItem) {
      return;
    }
    setMaterialMessage(null);
    searchMaterials.mutate({
      rowId: activeItem.id,
      keyword: materialKeyword || activeItem.productName,
    });
  };

  const saveMaterialAndMatch = () => {
    if (!activeItem || !materialForm.name.trim() || !materialForm.unit.trim()) {
      setMaterialMessage("Cần nhập tên và đơn vị tính.");
      return;
    }

    createMaterialAndMatch.mutate({
      rowId: activeItem.id,
      material: {
        code: materialForm.code || undefined,
        name: materialForm.name,
        unit: materialForm.unit,
        category: materialForm.category || undefined,
        defaultDepreciation: Number(materialForm.defaultDepreciation || 1),
        defaultReusePct: Number.parseInt(
          materialForm.defaultReusePct || "0",
          10,
        ),
      },
    });
  };

  const saveExternalManualMatch = () => {
    if (!activeItem) {
      return;
    }

    let domain: string;
    try {
      domain = new URL(manualSpec.sourceUrl).host;
    } catch {
      setWarning("Đường dẫn nguồn không hợp lệ.");
      return;
    }

    manualMatch.mutate({
      rowId: activeItem.id,
      spec: {
        productName: manualSpec.productName,
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

  if (!activeItem) {
    return (
      <section className="panel p-6 text-center text-sm text-slate-500">
        Hãy nhập và duyệt dòng trước khi tìm gợi ý sản phẩm.
      </section>
    );
  }

  const rowDetails = [
    { label: "Dòng Excel", value: activeItem.originalRowIndex },
    { label: "Tên sản phẩm", value: activeItem.productName },
    { label: "Thông số", value: activeItem.specText },
    { label: "Đơn vị tính", value: activeItem.unit },
    { label: "Số lượng", value: activeItem.quantity },
    { label: "Giá mục tiêu", value: activeItem.targetPrice },
    { label: "Tiền tệ", value: activeItem.currency },
    { label: "Nhà cung cấp", value: activeItem.vendorHint },
    { label: "Xuất xứ", value: activeItem.originHint },
    { label: "Ghi chú", value: activeItem.notes },
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-[0.72fr_1.28fr]">
      <section className="panel p-4">
        <h2 className="text-sm font-bold">Danh sách sản phẩm</h2>
        <div className="mt-3 grid max-h-[620px] gap-2 overflow-y-auto pr-1">
          {payload.items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveId(item.id)}
              aria-label={`Mở dòng sản phẩm ${item.productName}, trạng thái ${matchStatusLabels[item.matchStatus]}`}
              className={`rounded-xl border p-3 text-left transition ${
                activeItem.id === item.id
                  ? "border-slate-400 bg-slate-100"
                  : "border-slate-200 bg-white hover:bg-slate-50"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-slate-900">
                  {item.productName}
                </p>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusClass(item.matchStatus)}`}
                >
                  {matchStatusLabels[item.matchStatus]}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                {item.unit || "chưa có đơn vị"} •{" "}
                {item.specText || "chưa có thông số"}
              </p>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <article className="panel p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-950">
                {activeItem.productName}
              </h2>
              <p className="mt-1 max-w-2xl text-xs text-slate-500">
                Dòng {activeItem.originalRowIndex} •{" "}
                {activeItem.specText || "Chưa có thông số"} • Đơn vị{" "}
                {activeItem.unit || "-"}
              </p>
              {selectedCandidate ? (
                <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                  Đã chọn ({candidateSourceLabel(selectedCandidate.provider)}):{" "}
                  {selectedCandidate.title}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                disabled={searchWeb.isPending}
                onClick={() => searchWeb.mutate({ rowId: activeItem.id })}
                aria-label={`Tìm nguồn web cho ${activeItem.productName}`}
              >
                {searchWeb.isPending ? "Đang tìm..." : "Tìm nguồn web"}
              </button>
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-100"
                onClick={() => clearSelected.mutate({ rowId: activeItem.id })}
                aria-label={`Bỏ lựa chọn hiện tại của ${activeItem.productName}`}
              >
                Bỏ chọn
              </button>
            </div>
          </div>
          {warning ? (
            <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {warning}
            </p>
          ) : null}
        </article>

        <article className="panel p-4">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
            <div>
              <h3 className="text-sm font-bold">Thông tin dòng Excel</h3>
              <p className="mt-1 text-xs text-slate-500">
                Các trường đã duyệt dùng để tìm và đối chiếu sản phẩm.
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
              {matchStatusLabels[activeItem.matchStatus]}
            </span>
          </div>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {rowDetails.map((detail) => (
              <div
                key={detail.label}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2"
              >
                <dt className="text-[11px] font-semibold text-slate-500">
                  {detail.label}
                </dt>
                <dd className="mt-1 text-sm font-medium [overflow-wrap:anywhere] text-slate-900">
                  {formatOptionalValue(detail.value)}
                </dd>
              </div>
            ))}
          </dl>
        </article>

        <article className="panel p-4">
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-64 flex-1">
              <span className="text-xs font-semibold text-slate-600">
                Tìm trong danh mục nội bộ
              </span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={materialKeyword}
                onChange={(event) => setMaterialKeyword(event.target.value)}
                placeholder="Tên, mã, ĐVT hoặc nhóm sản phẩm / vật tư"
                aria-label="Từ khoá tìm trong danh mục nội bộ"
              />
            </label>
            <button
              type="button"
              className="rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-50"
              disabled={searchMaterials.isPending}
              onClick={searchMaterialCandidates}
            >
              {searchMaterials.isPending ? "Đang tìm..." : "Tìm danh mục"}
            </button>
          </div>
          {materialMessage ? (
            <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {materialMessage}
            </p>
          ) : null}
        </article>

        <div className="grid gap-3 lg:grid-cols-2">
          {candidates.map((candidate) => {
            const spec = specFromCandidate(candidate);
            const canOpenSource = /^https?:\/\//i.test(candidate.url);
            return (
              <article
                key={candidate.id}
                className={`rounded-xl border bg-white p-4 shadow-sm ${
                  candidate.isSelected
                    ? "border-emerald-300"
                    : "border-slate-200"
                }`}
              >
                {candidate.imageUrl ? (
                  // Candidate images come from arbitrary external domains.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={candidate.imageUrl}
                    alt={`Ảnh tham khảo cho sản phẩm ${candidate.title}`}
                    className="mb-3 h-28 w-full rounded-lg object-cover"
                  />
                ) : null}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span
                      className={`mb-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${candidateBadgeClass(candidate.provider)}`}
                    >
                      {candidateSourceLabel(candidate.provider)}
                    </span>
                    <h3 className="leading-tight font-semibold text-slate-900">
                      {candidate.title}
                    </h3>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-800">
                    {candidate.confidenceScore}%
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {candidate.domain}
                </p>
                <p className="mt-3 line-clamp-4 text-sm text-slate-700">
                  {spec?.specSummary ?? candidate.snippet}
                </p>
                <div className="mt-3 flex flex-wrap gap-1">
                  {candidate.matchReasons.map((reason) => (
                    <span
                      key={`${candidate.id}-${reason}`}
                      className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-600"
                    >
                      {reason}
                    </span>
                  ))}
                </div>
                <p className="mt-3 text-xs text-slate-600">
                  Giá: {spec?.priceText ?? "-"} • Xuất xứ:{" "}
                  {spec?.originCountry ?? "-"}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-800"
                    onClick={() =>
                      selectCandidate.mutate({
                        rowId: activeItem.id,
                        candidateId: candidate.id,
                      })
                    }
                    aria-label={`Chọn gợi ý ${candidate.title} cho ${activeItem.productName}`}
                  >
                    Chọn
                  </button>
                  {canOpenSource ? (
                    <a
                      href={candidate.url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold hover:bg-slate-100"
                      aria-label={`Mở trang nguồn của ${candidate.title}`}
                    >
                      Mở nguồn
                    </a>
                  ) : (
                    <span className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-500">
                      Nguồn nội bộ
                    </span>
                  )}
                </div>
              </article>
            );
          })}
          {visibleMaterialCandidates.map((candidate) => (
            <article
              key={`material-${candidate.materialId}`}
              className="rounded-xl border border-sky-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="mb-2 inline-flex rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700">
                    Danh mục
                  </span>
                  <h3 className="leading-tight font-semibold text-slate-900">
                    {candidate.title}
                  </h3>
                </div>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-800">
                  {candidate.confidenceScore}%
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-600">
                {candidate.code ? `Mã ${candidate.code} • ` : ""}ĐVT{" "}
                {candidate.unit} • Nhóm {candidate.category ?? "-"}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Khấu hao {candidate.defaultDepreciation} • Sử dụng lại{" "}
                {candidate.defaultReusePct}%
              </p>
              <div className="mt-3 flex flex-wrap gap-1">
                {candidate.matchReasons.map((reason) => (
                  <span
                    key={`${candidate.materialId}-${reason}`}
                    className="rounded-full border border-sky-100 bg-sky-50 px-2 py-1 text-[10px] text-sky-700"
                  >
                    {reason}
                  </span>
                ))}
              </div>
              <button
                type="button"
                className="mt-3 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
                disabled={selectMaterial.isPending}
                onClick={() =>
                  selectMaterial.mutate({
                    rowId: activeItem.id,
                    materialId: candidate.materialId,
                  })
                }
                aria-label={`Chọn ${candidate.title} từ danh mục nội bộ`}
              >
                Chọn
              </button>
            </article>
          ))}
          {candidates.length === 0 && visibleMaterialCandidates.length === 0 ? (
            <article className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
              Chưa có gợi ý. Hãy tìm web, tìm danh mục hoặc thêm sản phẩm mới.
            </article>
          ) : null}
        </div>

        <article className="panel p-4">
          <h3 className="text-sm font-bold">
            Thêm sản phẩm vào danh mục và chọn
          </h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Mã sản phẩm / vật tư (tuỳ chọn)"
              aria-label="Mã sản phẩm hoặc vật tư"
              value={materialForm.code}
              onChange={(event) =>
                setMaterialForm({ ...materialForm, code: event.target.value })
              }
            />
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Tên sản phẩm / vật tư"
              aria-label="Tên sản phẩm hoặc vật tư"
              value={materialForm.name}
              onChange={(event) =>
                setMaterialForm({ ...materialForm, name: event.target.value })
              }
            />
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="ĐVT"
              aria-label="Đơn vị tính sản phẩm hoặc vật tư"
              value={materialForm.unit}
              onChange={(event) =>
                setMaterialForm({ ...materialForm, unit: event.target.value })
              }
            />
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Nhóm sản phẩm / vật tư"
              aria-label="Nhóm sản phẩm hoặc vật tư"
              value={materialForm.category}
              onChange={(event) =>
                setMaterialForm({
                  ...materialForm,
                  category: event.target.value,
                })
              }
            />
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Khấu hao"
              type="number"
              min={0}
              step={0.1}
              aria-label="Khấu hao mặc định"
              value={materialForm.defaultDepreciation}
              onChange={(event) =>
                setMaterialForm({
                  ...materialForm,
                  defaultDepreciation: event.target.value,
                })
              }
            />
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="% sử dụng lại"
              type="number"
              min={0}
              max={100}
              aria-label="Phần trăm sử dụng lại mặc định"
              value={materialForm.defaultReusePct}
              onChange={(event) =>
                setMaterialForm({
                  ...materialForm,
                  defaultReusePct: event.target.value,
                })
              }
            />
          </div>
          <button
            type="button"
            className="mt-3 rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-50"
            disabled={
              !materialForm.name.trim() ||
              !materialForm.unit.trim() ||
              createMaterialAndMatch.isPending
            }
            onClick={saveMaterialAndMatch}
          >
            {createMaterialAndMatch.isPending
              ? "Đang lưu..."
              : "Thêm vào danh mục và chọn"}
          </button>
        </article>

        <article className="panel p-4">
          <h3 className="text-sm font-bold">Thêm nguồn ngoài thủ công</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Tên sản phẩm khớp"
              aria-label="Tên sản phẩm khớp nhập thủ công"
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
              placeholder="Đường dẫn nguồn"
              aria-label="Đường dẫn nguồn cho kết quả thủ công"
              value={manualSpec.sourceUrl}
              onChange={(event) =>
                setManualSpec({ ...manualSpec, sourceUrl: event.target.value })
              }
            />
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Giá"
              aria-label="Giá của kết quả thủ công"
              value={manualSpec.priceText}
              onChange={(event) =>
                setManualSpec({ ...manualSpec, priceText: event.target.value })
              }
            />
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Xuất xứ"
              aria-label="Xuất xứ của kết quả thủ công"
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
            className="mt-2 h-24 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Thông số khớp / bằng chứng"
            aria-label="Thông số khớp hoặc bằng chứng cho kết quả thủ công"
            value={manualSpec.specSummary}
            onChange={(event) =>
              setManualSpec({ ...manualSpec, specSummary: event.target.value })
            }
          />
          <button
            type="button"
            className="mt-2 rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            disabled={!manualSpec.productName || !manualSpec.sourceUrl}
            onClick={saveExternalManualMatch}
          >
            Lưu kết quả thủ công
          </button>
        </article>
      </section>
    </div>
  );
}

function ExportStep({ payload }: { payload: WorkspacePayload }) {
  const [error, setError] = useState<string | null>(null);
  const exportExcel = api.excelWorkspace.exportEnrichedExcel.useMutation({
    onSuccess: (result) => {
      setError(null);
      downloadBase64Xlsx(result.fileName, result.workbookBase64);
    },
    onError: (nextError) => setError(nextError.message),
  });
  const summary = useMemo(() => {
    const matched = payload.items.filter(
      (item) => item.matchStatus === "matched" || item.matchStatus === "manual",
    ).length;
    return {
      total: payload.items.length,
      matched,
      open: payload.items.length - matched,
    };
  }, [payload.items]);

  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold tracking-[0.16em] text-slate-500 uppercase">
            Tệp đã bổ sung dữ liệu
          </p>
          <h2 className="mt-2 text-xl font-bold text-slate-950">
            Xuất dòng gốc kèm bằng chứng sản phẩm đã chọn
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Chỉ xuất được khi mọi dòng đã có gợi ý Tavily được chọn hoặc kết quả
            nhập thủ công.
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          disabled={summary.open > 0 || exportExcel.isPending}
          onClick={() =>
            exportExcel.mutate({ workspaceId: payload.workspace.id })
          }
          aria-label="Xuất tệp Excel đã bổ sung dữ liệu sản phẩm"
        >
          {exportExcel.isPending ? "Đang xuất..." : "Xuất tệp Excel"}
        </button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <article className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Tổng dòng</p>
          <p className="mt-1 text-2xl font-bold">{summary.total}</p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Sẵn sàng</p>
          <p className="mt-1 text-2xl font-bold text-emerald-700">
            {summary.matched}
          </p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Còn thiếu</p>
          <p className="mt-1 text-2xl font-bold text-amber-700">
            {summary.open}
          </p>
        </article>
      </div>

      {error ? (
        <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export function ExcelWorkspaceWizardClient({
  workspaceId,
}: {
  workspaceId: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const stepParam = searchParams.get("step") as StepId | null;
  const activeStep = steps.some((step) => step.id === stepParam)
    ? stepParam!
    : "import";
  const workspaceQuery = api.excelWorkspace.getWorkspace.useQuery({
    id: workspaceId,
  });
  const payload = workspaceQuery.data;

  const setStep = (step: StepId) => {
    router.replace(`/excel-workspace/${workspaceId}?step=${step}`, {
      scroll: false,
    });
  };

  if (!payload) {
    return <div className="panel p-5 text-sm text-slate-600">Đang tải...</div>;
  }

  const matchedCount = payload.items.filter(
    (item) => item.matchStatus === "matched" || item.matchStatus === "manual",
  ).length;

  return (
    <div className="space-y-4">
      <section className="panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link
              href="/excel-workspace"
              className="text-xs font-semibold text-slate-700 hover:underline"
            >
              Quay lại danh sách
            </Link>
            <h2 className="mt-2 text-xl font-bold text-slate-950">
              {displayWorkspaceName(payload.workspace.name)}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {payload.workspace.sourceFileName ?? "Chưa nhập tệp"} •{" "}
              {payload.workspace.sourceSheetName ?? "Chưa chọn trang tính"} •{" "}
              {workspaceStatusLabels[payload.workspace.status]}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            {payload.items.length.toLocaleString("vi-VN")} dòng •{" "}
            {matchedCount.toLocaleString("vi-VN")} đã khớp
          </div>
        </div>
      </section>

      <StepNav activeStep={activeStep} setStep={setStep} />

      {activeStep === "import" ? (
        <ImportStep
          workspaceId={workspaceId}
          refetchWorkspace={workspaceQuery.refetch}
          goMap={() => setStep("map")}
        />
      ) : null}
      {activeStep === "map" ? (
        <MapStep
          workspaceId={workspaceId}
          refetchWorkspace={workspaceQuery.refetch}
          goReview={() => setStep("review")}
        />
      ) : null}
      {activeStep === "review" ? (
        <ReviewStep
          payload={payload}
          refetchWorkspace={workspaceQuery.refetch}
          goFind={() => setStep("find")}
        />
      ) : null}
      {activeStep === "find" ? (
        <FindStep payload={payload} refetchWorkspace={workspaceQuery.refetch} />
      ) : null}
      {activeStep === "export" ? <ExportStep payload={payload} /> : null}
    </div>
  );
}
