"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";

import { Badge, Button, EmptyState, PageSkeleton } from "~/app/_components/ui";
import {
  inlineSecondaryButtonClass,
  stepNavReachableClass,
} from "~/app/_components/ui/button-classes";
import { useToast } from "~/app/_components/ui/toast";
import { MaterialProfileReviewStep } from "~/app/_components/material-profiles/material-profile-review-step";
import { downloadMaterialProfileRevisionZip } from "~/lib/material-profile-export-dir";
import { materialProfileActionMessage } from "~/lib/materials/profile-user-message";
import { restoredMaterialProfileStep } from "~/lib/materials/profile-workflow-step";
import { api, type RouterOutputs } from "~/trpc/react";

type WorkspaceDetail = RouterOutputs["materialProfile"]["get"];
type Sheet = WorkspaceDetail["workbook"]["sheets"][number];
type PreviewResult = RouterOutputs["materialProfile"]["previewExportWorkbook"];
type CleanExportPreview =
  RouterOutputs["materialProfile"]["previewCleanExport"];
type ExportRevision =
  RouterOutputs["materialProfile"]["listExportRevisions"][number];
type PreviewSheet = PreviewResult["sheets"][number];
type ExportEditState = PreviewResult["exportEditState"];
type CellEdits = Record<string, Record<string, string>>;
type MaterialProfileStep = 1 | 2 | 3 | 4;

const materialProfileSteps: Array<{
  id: MaterialProfileStep;
  label: string;
  description: string;
}> = [
  {
    id: 1,
    label: "Tải lên Excel",
    description: "Chọn workbook .xlsx để giữ nguyên dữ liệu và bố cục gốc.",
  },
  {
    id: 2,
    label: "Kiểm tra dữ liệu",
    description: "Xác nhận sheet, dòng tiêu đề và ba cột bắt buộc.",
  },
  {
    id: 3,
    label: "Tự tìm & điền",
    description: "Tìm nguồn, thu thập dữ liệu và duyệt từng dòng vật tư.",
  },
  {
    id: 4,
    label: "Tải file chuẩn",
    description: "Rà cảnh báo, xem đúng nội dung rồi tải file Excel.",
  },
];

const mappingFields = [
  { key: "materialName", label: "Tên vật tư", required: true },
  { key: "code", label: "Mã vật tư" },
  { key: "unit", label: "ĐVT", required: true },
  { key: "category", label: "Nhóm" },
  { key: "specText", label: "Thông số kỹ thuật", required: true },
  { key: "vendorHint", label: "NCC" },
  { key: "originHint", label: "Xuất xứ" },
  { key: "unitPrice", label: "Đơn giá" },
  { key: "sourceUrl", label: "Nguồn" },
  { key: "catalogPdfUrls", label: "URL catalog" },
] as const;

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = reader.result;
      if (typeof value === "string") {
        resolve(value);
        return;
      }
      reject(new Error("Không đọc được file Excel."));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Không đọc được file Excel."));
    reader.readAsDataURL(file);
  });
}

function cellKey(rowIndex: number, colIndex: number) {
  return `${rowIndex + 1}:${colIndex + 1}`;
}

function editedCellValue(
  sheetName: string,
  rawValue: string | undefined,
  edits: CellEdits,
  rowIndex: number,
  colIndex: number,
) {
  const key = cellKey(rowIndex, colIndex);
  return edits[sheetName]?.[key] ?? rawValue ?? "";
}

function hasLastBulkApply(config: Record<string, unknown> | null | undefined) {
  if (!config) return false;
  return Boolean(config.materialProfileLastBulkApply);
}

function toggleNumber(values: number[], value: number) {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value].sort((a, b) => a - b);
}

function MaterialProfileStepHeader({
  current,
  maxReached,
  onJump,
  isTransitioning = false,
}: {
  current: MaterialProfileStep;
  maxReached: MaterialProfileStep;
  onJump: (step: MaterialProfileStep) => void;
  isTransitioning?: boolean;
}) {
  const progressPercent = (current / materialProfileSteps.length) * 100;
  const currentStep = materialProfileSteps[current - 1];

  return (
    <nav
      aria-label="Các bước hồ sơ vật tư"
      className="panel overflow-hidden rounded shadow-[var(--shadow-flat)]"
    >
      <div
        className="bg-surface-2 h-1.5 w-full"
        role="progressbar"
        aria-label="Tiến độ hồ sơ vật tư"
        aria-valuemin={1}
        aria-valuemax={materialProfileSteps.length}
        aria-valuenow={current}
      >
        <div
          className="brand-rule h-full transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <div className="border-line bg-surface-2 flex items-start gap-3 border-b px-3 py-3 sm:px-4">
        <span className="bg-brand inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-extrabold text-white tabular-nums">
          {current}
        </span>
        <div className="min-w-0">
          <p className="text-ink-3 text-xs font-semibold tracking-[0.1em] uppercase">
            Bước {current}/{materialProfileSteps.length}
          </p>
          <p className="text-ink-1 mt-0.5 text-sm font-bold">
            {currentStep?.label}
          </p>
          <p className="text-ink-2 mt-0.5 text-xs leading-5">
            {currentStep?.description}
          </p>
        </div>
      </div>

      <ol className="grid grid-cols-4 gap-1 p-2 sm:p-3">
        {materialProfileSteps.map((step) => {
          const isCurrent = step.id === current;
          const isDone = step.id < current;
          const isReachable = step.id <= maxReached;

          return (
            <li key={step.id} className="min-w-0">
              <button
                type="button"
                disabled={!isReachable || isTransitioning}
                onClick={() => isReachable && onJump(step.id)}
                aria-current={isCurrent ? "step" : undefined}
                className={`focus-visible:ring-ring focus-visible:ring-offset-surface-1 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-panel)] px-1.5 py-1.5 text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed motion-reduce:transition-none sm:px-2.5 md:min-h-11 ${
                  isCurrent
                    ? "bg-brand text-white"
                    : isReachable
                      ? stepNavReachableClass
                      : "text-ink-3"
                }`}
              >
                <span
                  className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-extrabold tabular-nums ${
                    isCurrent
                      ? "bg-white/20 text-white"
                      : isDone
                        ? "bg-emerald-600 text-white"
                        : "bg-surface-3 text-ink-1"
                  }`}
                >
                  {isDone ? <Check className="h-3 w-3" aria-hidden /> : step.id}
                </span>
                <span className="hidden min-w-0 text-balance min-[480px]:inline">
                  {step.label}
                </span>
                <span className="sr-only min-[480px]:hidden">{step.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function WorkbookGrid({
  sheet,
  edits,
  onEdit,
  maxHeight = "max-h-[560px]",
}: {
  sheet: Sheet | PreviewSheet;
  edits?: CellEdits;
  onEdit: (rowIndex: number, colIndex: number, value: string) => void;
  maxHeight?: string;
}) {
  const rows = "rawRows" in sheet ? sheet.rawRows : sheet.rows;
  const maxColumns = Math.max(...rows.map((row) => row.length), 1);
  const headerRowIndex =
    "rawRows" in sheet ? sheet.activeHeaderRowIndex : sheet.headerRowIndex;
  const headerRow = rows[headerRowIndex - 1];

  return (
    <div
      className={`${maxHeight} border-line-strong bg-surface-1 overflow-auto rounded-[var(--radius-panel)] border shadow-[var(--shadow-flat)]`}
    >
      <table
        aria-label={`Bảng dữ liệu sheet ${sheet.name}`}
        className="min-w-full border-separate border-spacing-0 text-xs"
      >
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${sheet.name}-${rowIndex}`}>
              <th className="border-line bg-surface-2 text-ink-2 sticky left-0 z-10 border-r border-b px-2 py-1 text-right font-semibold tabular-nums">
                {rowIndex + 1}
              </th>
              {Array.from({ length: maxColumns }).map((_, colIndex) => {
                const isHeader = rowIndex + 1 === headerRowIndex;
                const header = edits
                  ? editedCellValue(
                      sheet.name,
                      headerRow?.[colIndex],
                      edits,
                      headerRowIndex - 1,
                      colIndex,
                    ).trim()
                  : headerRow?.[colIndex]?.trim();
                const value = edits
                  ? editedCellValue(
                      sheet.name,
                      row[colIndex],
                      edits,
                      rowIndex,
                      colIndex,
                    )
                  : (row[colIndex] ?? "");
                return (
                  <td
                    key={`${sheet.name}-${rowIndex}-${colIndex}`}
                    className="border-line min-w-36 border-r border-b"
                  >
                    <input
                      aria-label={`Sheet ${sheet.name}, dòng ${rowIndex + 1}, ${header ? `cột ${header}` : `cột ${colIndex + 1}`}`}
                      value={value}
                      onChange={(event) =>
                        onEdit(rowIndex, colIndex, event.target.value)
                      }
                      className={`text-ink-2 focus-visible:bg-surface-2 focus-visible:ring-ring h-8 w-full px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset ${
                        isHeader
                          ? "bg-surface-2 text-ink-1 font-semibold"
                          : "bg-surface-1"
                      }`}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UploadStep({
  workspace,
  sheets,
  isUploading,
  onFile,
  onContinue,
}: {
  workspace: WorkspaceDetail["workspace"];
  sheets: Sheet[];
  isUploading: boolean;
  onFile: (file: File | null) => void;
  onContinue: () => void;
}) {
  const checklist = [
    { label: "Đã tải file Excel", done: Boolean(workspace.sourceFileName) },
    {
      label: sheets.length > 0 ? `${sheets.length} sheet` : "Chưa đọc sheet",
      done: sheets.length > 0,
    },
    {
      label:
        workspace.rowCount > 0
          ? `${workspace.rowCount.toLocaleString("vi-VN")} dòng vật tư`
          : "Chưa có dòng vật tư",
      done: workspace.rowCount > 0,
    },
  ];
  const readyCount = checklist.filter((item) => item.done).length;
  const hasWorkbook = sheets.length > 0;

  return (
    <section className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(19rem,0.85fr)]">
      <div className="panel p-4">
        <p className="section-title">Workbook nguồn</p>
        <h2 className="text-ink-1 mt-1 text-base font-semibold">
          {hasWorkbook ? "Đổi file Excel" : "Chọn file Excel để bắt đầu"}
        </h2>
        <p className="text-ink-2 mt-2 text-sm leading-6">
          BidTool đọc file gốc để bạn kiểm tra cột, đối chiếu vật tư và xuất lại
          đúng dữ liệu. Chỉ nhận định dạng <strong>.xlsx</strong>.
        </p>
        <label
          className={`border-brand bg-surface-2 text-brand focus-within:ring-ring mt-4 flex min-h-40 flex-col items-center justify-center gap-2 rounded-[var(--radius-panel)] border border-dashed px-4 py-4 text-center transition-colors focus-within:ring-2 motion-reduce:transition-none ${
            isUploading
              ? "cursor-wait opacity-70"
              : "hover:bg-surface-3 cursor-pointer"
          }`}
          aria-busy={isUploading}
        >
          {isUploading ? (
            <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
          ) : (
            <Upload className="h-6 w-6" aria-hidden />
          )}
          <span className="text-sm font-bold">
            {isUploading
              ? "Đang đọc workbook…"
              : hasWorkbook
                ? "Chọn file khác"
                : "Chọn file từ máy"}
          </span>
          <span className="text-ink-2 max-w-full text-xs font-medium break-all">
            {workspace.sourceFileName ?? "Tối đa một workbook .xlsx mỗi hồ sơ"}
          </span>
          <input
            type="file"
            accept=".xlsx"
            disabled={isUploading}
            className="sr-only"
            onChange={(event) => {
              onFile(event.target.files?.[0] ?? null);
              event.currentTarget.value = "";
            }}
          />
        </label>
        {hasWorkbook ? (
          <p className="text-ink-3 mt-3 text-xs leading-5">
            Tải file khác sẽ thay workbook nguồn và bạn cần kiểm tra lại ánh xạ
            trước khi tiếp tục.
          </p>
        ) : null}
      </div>

      <aside className="panel p-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="section-title">Sẵn sàng kiểm tra</p>
            <h2 className="text-ink-1 mt-1 text-base font-semibold">
              Dữ liệu đã nhận
            </h2>
          </div>
          <span className="text-ink-2 text-sm font-bold tabular-nums">
            {readyCount}/{checklist.length}
          </span>
        </div>
        <div className="mt-3 grid gap-2">
          {checklist.map((item) => (
            <div
              key={item.label}
              className={`flex items-center gap-2 rounded border px-3 py-2 text-sm ${
                item.done
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-line-strong bg-surface-1 text-ink-1 shadow-[var(--shadow-flat)]"
              }`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full ${
                  item.done ? "bg-emerald-600 text-white" : "bg-surface-3"
                }`}
              >
                {item.done ? <Check className="h-3 w-3" aria-hidden /> : null}
              </span>
              {item.label}
            </div>
          ))}
        </div>
        {workspace.noticeNumber ? (
          <div className="border-line bg-surface-2 text-ink-2 mt-3 rounded border px-3 py-2 text-xs">
            Số TBMT:{" "}
            <strong className="text-ink-1">{workspace.noticeNumber}</strong>
          </div>
        ) : (
          <p className="text-ink-3 mt-3 text-xs leading-5">
            Số TBMT là thông tin tùy chọn và không ảnh hưởng đến việc xử lý
            file.
          </p>
        )}
        <Button
          className="mt-4 w-full"
          disabled={!hasWorkbook}
          onClick={onContinue}
          rightIcon={<ArrowRight className="h-4 w-4" />}
        >
          Kiểm tra dữ liệu
        </Button>
      </aside>
    </section>
  );
}

function WorkbookMappingStep({
  sheets,
  activeSheet,
  selectedSheetName,
  headerRowIndex,
  mapping,
  edits,
  isSaving,
  isMatching,
  onSheetChange,
  onHeaderRowChange,
  onMappingChange,
  onEdit,
  onSave,
  onRunMatch,
  onContinueToReview,
  canContinueToReview,
}: {
  sheets: Sheet[];
  activeSheet: Sheet;
  selectedSheetName: string;
  headerRowIndex: number;
  mapping: Record<string, string | null>;
  edits: CellEdits;
  isSaving: boolean;
  isMatching: boolean;
  onSheetChange: (sheetName: string) => void;
  onHeaderRowChange: (rowIndex: number) => void;
  onMappingChange: (key: string, value: string | null) => void;
  onEdit: (rowIndex: number, colIndex: number, value: string) => void;
  onSave: () => void;
  onRunMatch: () => void;
  onContinueToReview: () => void;
  canContinueToReview: boolean;
}) {
  const requiredFields = mappingFields.filter(
    (field) => "required" in field && field.required,
  );
  const hasRequiredColumns = requiredFields.every((field) =>
    Boolean(mapping[field.key]),
  );
  const optionalMapped = mappingFields.filter(
    (field) =>
      !("required" in field && field.required) && Boolean(mapping[field.key]),
  ).length;
  const optionalFields = mappingFields.filter(
    (field) => !("required" in field && field.required),
  );
  const missingRequiredLabels = requiredFields
    .filter((field) => !mapping[field.key])
    .map((field) => field.label);

  return (
    <section className="panel overflow-hidden">
      <div className="border-line bg-surface-1 border-b px-4 py-4">
        <p className="section-title">Ánh xạ & chỉnh workbook</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-ink-1 text-base font-semibold">
              Ánh xạ cột vật tư và chỉnh ô
            </h2>
            <p className="text-ink-2 mt-1 text-sm">
              Đã ánh xạ{" "}
              {requiredFields.filter((field) => mapping[field.key]).length}/
              {requiredFields.length} cột bắt buộc và {optionalMapped} cột bổ
              sung.
            </p>
          </div>
          <div className="flex w-full flex-wrap gap-2 lg:w-auto lg:justify-end">
            <Button
              variant="secondary"
              onClick={onSave}
              isLoading={isSaving}
              leftIcon={<Check className="h-4 w-4" />}
            >
              Lưu thay đổi
            </Button>
            <Button
              variant={canContinueToReview ? "secondary" : "primary"}
              disabled={!hasRequiredColumns}
              onClick={onRunMatch}
              isLoading={isMatching}
              leftIcon={<Search className="h-4 w-4" />}
            >
              {canContinueToReview
                ? "Chạy lại đối chiếu"
                : "Kiểm tra & đối chiếu"}
            </Button>
            {canContinueToReview ? (
              <Button
                variant="primary"
                onClick={onContinueToReview}
                rightIcon={<ArrowRight className="h-4 w-4" />}
              >
                Mở kết quả đối chiếu
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-2 p-4">
        {!hasRequiredColumns ? (
          <div
            className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"
            role="alert"
          >
            Còn thiếu ánh xạ:{" "}
            <strong>{missingRequiredLabels.join(", ")}</strong>. Chọn đủ ba cột
            bắt buộc để chạy đối chiếu. Dòng thiếu giá trị vẫn được giữ lại để
            bạn sửa.
          </div>
        ) : null}
        <div className="grid gap-1 lg:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-ink-3 text-xs font-semibold tracking-[0.12em] uppercase">
              Sheet vật tư
            </span>
            <select
              value={selectedSheetName}
              onChange={(event) => onSheetChange(event.target.value)}
              className="border-line-strong bg-surface-1 text-ink-1 focus-visible:ring-ring h-10 rounded-[var(--radius-panel)] border px-3 text-sm shadow-[var(--shadow-flat)] focus-visible:ring-2 focus-visible:outline-none"
            >
              {sheets.map((sheet) => (
                <option key={sheet.name} value={sheet.name}>
                  {sheet.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-ink-3 text-xs font-semibold tracking-[0.12em] uppercase">
              Dòng tiêu đề
            </span>
            <input
              type="number"
              min={1}
              value={headerRowIndex}
              onChange={(event) =>
                onHeaderRowChange(Math.max(1, Number(event.target.value)))
              }
              className="border-line-strong bg-surface-1 text-ink-1 focus-visible:ring-ring h-10 rounded-[var(--radius-panel)] border px-3 text-sm shadow-[var(--shadow-flat)] focus-visible:ring-2 focus-visible:outline-none"
            />
          </label>
          <div
            className={`rounded-[var(--radius-panel)] border px-3 py-2 text-xs ${
              hasRequiredColumns
                ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                : "border-line bg-surface-2 text-ink-2"
            }`}
          >
            <p className="font-semibold">
              {hasRequiredColumns
                ? "Đã đủ cột bắt buộc"
                : "Điều kiện đối chiếu"}
            </p>
            <p className="mt-1">
              {hasRequiredColumns
                ? "Bấm “Kiểm tra & đối chiếu” để tạo danh sách duyệt ở bước 3."
                : "Cần Tên vật tư, ĐVT và Thông số kỹ thuật."}
            </p>
          </div>
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-ink-1 text-sm font-semibold">Cột bắt buộc</p>
            <span className="text-ink-3 text-xs tabular-nums">
              {requiredFields.length - missingRequiredLabels.length}/
              {requiredFields.length} đã chọn
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {requiredFields.map((field) => (
              <label key={field.key} className="flex flex-col gap-1">
                <span className="text-ink-3 text-xs font-semibold tracking-[0.12em] uppercase">
                  {field.label} <span className="text-rose-500">*</span>
                </span>
                <select
                  value={mapping[field.key] ?? ""}
                  onChange={(event) =>
                    onMappingChange(field.key, event.target.value || null)
                  }
                  className="border-line-strong bg-surface-1 text-ink-1 focus-visible:ring-ring h-10 rounded-[var(--radius-panel)] border px-2 text-sm shadow-[var(--shadow-flat)] focus-visible:ring-2 focus-visible:outline-none"
                >
                  <option value="">Chọn cột…</option>
                  {activeSheet.headers.map((header) => (
                    <option key={`${field.key}-${header}`} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>

        <details
          className="border-line rounded-[var(--radius-panel)] border"
          open={optionalMapped > 0 || undefined}
        >
          <summary className="focus-visible:ring-ring flex min-h-11 cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none">
            <span>Cột bổ sung (tùy chọn)</span>
            <span className="text-ink-3 text-xs font-medium tabular-nums">
              {optionalMapped}/{optionalFields.length} đã chọn
            </span>
          </summary>
          <div className="border-line grid gap-2 border-t p-3 sm:grid-cols-2 lg:grid-cols-4">
            {optionalFields.map((field) => (
              <label key={field.key} className="flex flex-col gap-1">
                <span className="text-ink-3 text-xs font-semibold tracking-[0.12em] uppercase">
                  {field.label}
                </span>
                <select
                  value={mapping[field.key] ?? ""}
                  onChange={(event) =>
                    onMappingChange(field.key, event.target.value || null)
                  }
                  className="border-line-strong bg-surface-1 text-ink-1 focus-visible:ring-ring h-9 rounded-[var(--radius-panel)] border px-2 text-xs shadow-[var(--shadow-flat)] focus-visible:ring-2 focus-visible:outline-none"
                >
                  <option value="">Không ánh xạ</option>
                  {activeSheet.headers.map((header) => (
                    <option key={`${field.key}-${header}`} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </details>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-ink-2 text-xs leading-5">
            Có thể sửa trực tiếp tên cột hoặc giá trị trong bảng. Nhớ lưu trước
            khi rời hồ sơ.
          </p>
          <Badge tone={hasRequiredColumns ? "success" : "warning"}>
            {hasRequiredColumns ? "Sẵn sàng đối chiếu" : "Chưa đủ ánh xạ"}
          </Badge>
        </div>
        <WorkbookGrid sheet={activeSheet} edits={edits} onEdit={onEdit} />
      </div>
    </section>
  );
}

function CleanExportStep({
  preview,
  revisions,
  isLoading,
  isHistoryLoading,
  errorMessage,
  isCreatingRevision,
  downloadingRevisionId,
  onRefresh,
  onCreateRevision,
  onDownloadRevision,
  onBackToReview,
}: {
  preview: CleanExportPreview | undefined;
  revisions: ExportRevision[];
  isLoading: boolean;
  isHistoryLoading: boolean;
  errorMessage?: string;
  isCreatingRevision: boolean;
  downloadingRevisionId: string | null;
  onRefresh: () => void;
  onCreateRevision: () => void;
  onDownloadRevision: (revisionId: string) => void;
  onBackToReview: () => void;
}) {
  const incompleteRows = preview?.incompleteRows ?? 0;
  const canExport = preview?.canExport === true;

  return (
    <section className="space-y-4">
      <div className="panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-3xl">
            <p className="section-title">Bản nháp đang xem</p>
            <h2 className="text-ink-1 mt-1 text-base font-semibold">
              Kiểm tra trước khi tạo bản xuất
            </h2>
            <p className="text-ink-2 mt-2 text-sm leading-6">
              Bản nháp lấy trực tiếp từ quyết định đã lưu ở Bước 3. Mọi dòng
              hiện tại đều được giữ lại; dòng thiếu, bỏ qua hoặc loại khỏi phạm
              vi có mã trạng thái và lý do riêng.
            </p>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
            <Button
              variant="secondary"
              className="flex-1 sm:flex-none"
              onClick={onRefresh}
              isLoading={isLoading}
              leftIcon={<RefreshCw className="h-4 w-4" />}
            >
              Làm mới kiểm tra
            </Button>
            <Button
              className="flex-1 sm:flex-none"
              onClick={onCreateRevision}
              disabled={!canExport}
              isLoading={isCreatingRevision}
              leftIcon={<Check className="h-4 w-4" />}
              title={
                canExport
                  ? "Tạo bản xuất mới và tải file ZIP"
                  : "Chưa có dòng vật tư hiện tại để tạo bản xuất"
              }
              rightIcon={<ArrowRight className="h-4 w-4" />}
            >
              Tạo bản xuất mới
            </Button>
          </div>
        </div>

        {preview ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <div className="border-line bg-surface-2 text-ink-2 rounded-[var(--radius-panel)] border px-3 py-3 text-sm">
              <p className="text-ink-1 font-semibold">Dòng sẽ xuất</p>
              <p className="text-ink-1 mt-1 text-2xl font-bold tabular-nums">
                {preview.totalRows.toLocaleString("vi-VN")}
              </p>
            </div>
            <div className="rounded border border-emerald-300 bg-emerald-50 px-3 py-3 text-sm text-emerald-950">
              <p className="font-bold">Đủ điều kiện</p>
              <p className="mt-1 text-2xl font-extrabold tabular-nums">
                {preview.completeRows.toLocaleString("vi-VN")}
              </p>
            </div>
            <div
              className={`rounded border px-3 py-3 text-sm ${
                incompleteRows > 0
                  ? "border-amber-300 bg-amber-50 text-amber-950"
                  : "border-line bg-surface-2 text-ink-2"
              }`}
            >
              <p className="font-bold">Có cảnh báo</p>
              <p className="mt-1 text-2xl font-extrabold tabular-nums">
                {incompleteRows.toLocaleString("vi-VN")}
              </p>
            </div>
          </div>
        ) : null}

        {preview?.canExport ? (
          <div
            className={`mt-3 flex items-start gap-2 rounded border px-3 py-2 text-sm ${
              incompleteRows > 0
                ? "border-amber-300 bg-amber-50 text-amber-950"
                : "border-emerald-200 bg-emerald-50 text-emerald-950"
            }`}
            role="status"
          >
            {incompleteRows > 0 ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            )}
            <p>
              {incompleteRows > 0
                ? "Có thể tạo bản xuất. Các dòng cần xác minh được giữ lại và đánh dấu rõ trong file."
                : "Dữ liệu đã sẵn sàng để tạo một bản xuất bất biến."}
            </p>
          </div>
        ) : null}
      </div>

      {errorMessage && !preview ? (
        <div className="panel p-4">
          <EmptyState
            title="Không kiểm tra được file xuất"
            description={materialProfileActionMessage(
              errorMessage,
              "Kiểm tra kết nối rồi thử làm mới bản xem trước.",
            )}
            cta={
              <Button variant="secondary" onClick={onRefresh}>
                Thử lại
              </Button>
            }
          />
        </div>
      ) : null}

      {isLoading && !preview ? (
        <div className="panel text-ink-2 p-4 text-sm" aria-live="polite">
          Đang kiểm tra dữ liệu trước khi xuất…
        </div>
      ) : null}

      {preview && incompleteRows > 0 ? (
        <div className="panel border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-bold">File sẽ được tạo kèm cảnh báo</p>
          <p className="mt-1 leading-6">
            Các dòng dưới đây vẫn được xuất. Trường chưa có dữ liệu sẽ để trống
            và trạng thái dòng là “Cần xác minh”.
          </p>
          <ul className="mt-3 space-y-1 text-xs leading-5">
            {preview.issues.slice(0, 8).map((issue) => (
              <li key={`${issue.originalRowIndex}-${issue.name}`}>
                Dòng {issue.originalRowIndex} · {issue.name}:{" "}
                {issue.reasons.join(" ")}
              </li>
            ))}
          </ul>
          <Button className="mt-3" variant="secondary" onClick={onBackToReview}>
            Quay lại tự tìm & điền
          </Button>
        </div>
      ) : null}

      {preview?.emptyReason ? (
        <div className="panel border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-bold">Chưa có dòng để xuất</p>
          <p className="mt-1 leading-6">{preview.emptyReason}</p>
          <Button className="mt-3" onClick={onBackToReview}>
            Quay lại tự tìm & điền
          </Button>
        </div>
      ) : null}

      {preview ? (
        <div className="panel overflow-hidden">
          <div className="border-line bg-surface-2 border-b px-4 py-3">
            <p className="text-ink-1 text-base font-semibold">
              Xem trước đúng file sẽ tải
            </p>
            <p className="text-ink-2 mt-1 text-xs">
              Các cột và giá trị dưới đây là định dạng chính thức của file
              Excel.
            </p>
          </div>
          <div className="max-h-[580px] overflow-auto">
            <table
              aria-label="Bản xem trước danh mục vật tư sẽ xuất"
              className="min-w-full border-separate border-spacing-0 text-xs"
            >
              <thead>
                <tr>
                  {preview.headers.map((header) => (
                    <th
                      key={header}
                      className="border-line bg-surface-2 text-ink-1 sticky top-0 z-10 min-w-32 border-r border-b px-3 py-2 text-left font-semibold"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {preview.headers.map((header) => (
                      <td
                        key={header}
                        className="border-line text-ink-2 max-w-72 border-r border-b px-3 py-2 align-top"
                      >
                        {String(
                          (row as Record<string, string | number>)[header] ??
                            "",
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="panel overflow-hidden">
        <div className="border-line bg-surface-2 flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3">
          <div>
            <p className="text-ink-1 text-base font-semibold">
              Lịch sử bản xuất
            </p>
            <p className="text-ink-2 mt-1 text-xs leading-5">
              Mỗi bản xuất là bất biến. File ZIP luôn gồm đúng Excel,
              manifest.json và warnings.csv.
            </p>
          </div>
          <Badge tone="info" count={revisions.length}>
            Bản xuất
          </Badge>
        </div>
        {isHistoryLoading ? (
          <p className="text-ink-2 px-4 py-4 text-sm">Đang tải lịch sử…</p>
        ) : revisions.length === 0 ? (
          <p className="text-ink-2 px-4 py-4 text-sm">
            Chưa có bản xuất. Kiểm tra bản nháp rồi chọn “Tạo bản xuất mới”.
          </p>
        ) : (
          <ul className="divide-line divide-y">
            {revisions.map((revision) => (
              <li
                key={revision.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-ink-1 font-semibold">
                    Bản xuất #{revision.revisionNumber}
                  </p>
                  <p className="text-ink-3 mt-1 text-xs">
                    {new Date(revision.createdAt).toLocaleString("vi-VN")} ·{" "}
                    {revision.summary.totalRows.toLocaleString("vi-VN")} dòng ·{" "}
                    {revision.summary.needs_review.toLocaleString("vi-VN")} cần
                    xác minh ·{" "}
                    {revision.summary.skipped.toLocaleString("vi-VN")} bỏ qua ·{" "}
                    {revision.summary.excluded.toLocaleString("vi-VN")} loại
                  </p>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => onDownloadRevision(revision.id)}
                  isLoading={downloadingRevisionId === revision.id}
                  leftIcon={<Download className="h-4 w-4" />}
                >
                  Tải ZIP
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function ExportPreviewStep({
  preview,
  exportEditState,
  isPreviewing,
  isSaving,
  isExporting,
  onRefreshPreview,
  onPreviewEdit,
  onDeleteSelection,
  onRestoreDeleted,
  onSavePreview,
  onExport,
}: {
  preview: PreviewResult | null;
  exportEditState: ExportEditState;
  isPreviewing: boolean;
  isSaving: boolean;
  isExporting: boolean;
  onRefreshPreview: () => void;
  onPreviewEdit: (
    sheetName: string,
    rowNumber: number,
    colNumber: number,
    value: string,
  ) => void;
  onDeleteSelection: (
    sheetName: string,
    rowNumbers: number[],
    colNumbers: number[],
  ) => void;
  onRestoreDeleted: (
    sheetName: string,
    kind: "row" | "column",
    value: number,
  ) => void;
  onSavePreview: () => void;
  onExport: () => void;
}) {
  const [activePreviewSheetName, setActivePreviewSheetName] = useState("");
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [selectedColumns, setSelectedColumns] = useState<number[]>([]);
  const activeSheet =
    preview?.sheets.find((sheet) => sheet.name === activePreviewSheetName) ??
    preview?.sheets.find((sheet) => sheet.name === preview.selectedSheetName) ??
    preview?.sheets[0];

  useEffect(() => {
    if (!preview) return;
    setActivePreviewSheetName(
      (current) => current || preview.selectedSheetName,
    );
  }, [preview]);

  useEffect(() => {
    setSelectedRows([]);
    setSelectedColumns([]);
  }, [activePreviewSheetName]);

  const rowNumbers =
    activeSheet?.rowNumbers ??
    activeSheet?.rows.map((_, index) => index + 1) ??
    [];
  const columnNumbers =
    activeSheet?.columnNumbers ??
    (activeSheet
      ? Array.from({
          length: Math.max(...activeSheet.rows.map((row) => row.length), 0),
        }).map((_, index) => index + 1)
      : []);
  const deletedRows = activeSheet
    ? (exportEditState.deletedRows[activeSheet.name] ?? [])
    : [];
  const deletedColumns = activeSheet
    ? (exportEditState.deletedColumns[activeSheet.name] ?? [])
    : [];
  const selectedCount = selectedRows.length + selectedColumns.length;
  const editSummary = preview?.editSummary;
  const matchCounts = preview?.matchCounts;
  const reviewReadiness = preview?.reviewReadiness;
  const unresolvedReviewCount = reviewReadiness?.unresolvedRows ?? 0;

  const deleteSelected = () => {
    if (!activeSheet || selectedCount === 0) return;
    const ok = window.confirm(
      `Xóa ${selectedRows.length} dòng và ${selectedColumns.length} cột khỏi bản export?`,
    );
    if (!ok) return;
    onDeleteSelection(activeSheet.name, selectedRows, selectedColumns);
    setSelectedRows([]);
    setSelectedColumns([]);
  };

  return (
    <section className="space-y-4">
      <div className="panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-1">
          <div>
            <p className="section-title">Xem trước kết quả</p>
            <h2 className="mt-1 text-lg font-bold text-slate-950">
              Kiểm tra workbook trước export
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Xem trước toàn bộ workbook. Sheet vật tư có thêm các cột BT, các
              sheet khác vẫn có thể chỉnh giá trị trước khi xuất.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={onRefreshPreview}
              isLoading={isPreviewing}
              leftIcon={<RefreshCw className="h-4 w-4" />}
            >
              Làm mới preview
            </Button>
            <Button
              variant="secondary"
              onClick={onSavePreview}
              isLoading={isSaving}
              leftIcon={<Check className="h-4 w-4" />}
            >
              Lưu preview
            </Button>
            <Button
              onClick={onExport}
              isLoading={isExporting}
              leftIcon={<Download className="h-4 w-4" />}
            >
              Chọn thư mục & export
            </Button>
          </div>
        </div>
        {preview ? (
          <div className="mt-4 grid gap-1 lg:grid-cols-2">
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
              <p className="font-bold">Cảnh báo chỉnh workbook</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <Badge tone="warning" count={editSummary?.editedCellCount ?? 0}>
                  Ô đã sửa
                </Badge>
                <Badge tone="warning" count={editSummary?.deletedRowCount ?? 0}>
                  Dòng đã xóa
                </Badge>
                <Badge
                  tone="warning"
                  count={editSummary?.deletedColumnCount ?? 0}
                >
                  Cột đã xóa
                </Badge>
                <Badge
                  tone="warning"
                  count={editSummary?.deletedMaterialRowCount ?? 0}
                >
                  Dòng vật tư đã xóa
                </Badge>
              </div>
            </div>
            <div className="rounded border border-slate-400 bg-slate-50 px-3 py-3 text-sm text-slate-700">
              <p className="font-bold text-slate-950">
                Trạng thái duyệt/catalog
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <Badge tone="success" count={matchCounts?.matchedCount ?? 0}>
                  Đã khớp
                </Badge>
                <Badge tone="warning" count={matchCounts?.reviewCount ?? 0}>
                  Cần duyệt
                </Badge>
                <Badge tone="neutral" count={matchCounts?.unmatchedCount ?? 0}>
                  Chưa khớp
                </Badge>
                <Badge
                  tone="info"
                  count={matchCounts?.missingCatalogCount ?? 0}
                >
                  Thiếu catalog
                </Badge>
                <Badge tone="warning" count={unresolvedReviewCount}>
                  Chưa chọn/bỏ qua
                </Badge>
              </div>
            </div>
          </div>
        ) : null}
        {unresolvedReviewCount > 0 ? (
          <div className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950">
            <p className="font-bold">Hồ sơ chưa duyệt xong</p>
            <p className="mt-1">
              Còn {unresolvedReviewCount.toLocaleString("vi-VN")} dòng chưa chọn
              hoặc bỏ qua. Bạn vẫn có thể export, nhưng file có thể thiếu dữ
              liệu.
            </p>
          </div>
        ) : null}
      </div>

      {!preview || !activeSheet ? (
        <EmptyState
          title="Chưa có bản xem trước"
          description="Bấm Làm mới preview để tạo workbook kết quả trước khi export."
          cta={
            <Button onClick={onRefreshPreview} isLoading={isPreviewing}>
              Tạo preview
            </Button>
          }
        />
      ) : (
        <div className="panel overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-400 bg-slate-50 px-4 py-3">
            {preview.sheets.map((sheet) => (
              <button
                key={sheet.name}
                type="button"
                onClick={() => setActivePreviewSheetName(sheet.name)}
                className={`rounded px-3 py-1.5 text-xs font-bold ${
                  activeSheet.name === sheet.name
                    ? "bg-blue-700 text-white"
                    : "bg-white text-slate-700 hover:bg-slate-100"
                }`}
              >
                {sheet.name}
                {sheet.isMaterialSheet ? " · vật tư" : ""}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-400 bg-white px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-600">
              <span>Đã chọn {selectedRows.length} dòng</span>
              <span>Đã chọn {selectedColumns.length} cột</span>
              <span>Đã xóa {deletedRows.length} dòng</span>
              <span>Đã xóa {deletedColumns.length} cột</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="danger"
                disabled={selectedCount === 0}
                onClick={deleteSelected}
                leftIcon={<Trash2 className="h-4 w-4" />}
              >
                Xóa khỏi bản export
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={deletedRows.length + deletedColumns.length === 0}
                onClick={onRefreshPreview}
              >
                Làm mới sau khôi phục
              </Button>
            </div>
          </div>
          {deletedRows.length + deletedColumns.length > 0 ? (
            <div className="border-b border-slate-400 bg-rose-50 px-4 py-3 text-xs text-rose-950">
              <p className="font-bold">Đã xóa khỏi bản export</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {deletedRows.map((rowNumber) => (
                  <button
                    key={`row-${rowNumber}`}
                    type="button"
                    onClick={() =>
                      onRestoreDeleted(activeSheet.name, "row", rowNumber)
                    }
                    className="rounded-full bg-white px-2 py-1 font-semibold text-rose-700"
                  >
                    Khôi phục dòng {rowNumber}
                  </button>
                ))}
                {deletedColumns.map((colNumber) => (
                  <button
                    key={`col-${colNumber}`}
                    type="button"
                    onClick={() =>
                      onRestoreDeleted(activeSheet.name, "column", colNumber)
                    }
                    className="rounded-full bg-white px-2 py-1 font-semibold text-rose-700"
                  >
                    Khôi phục cột {colNumber}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="p-4">
            <div className="max-h-[640px] overflow-auto rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)]">
              <table className="min-w-full border-separate border-spacing-0 text-xs">
                <thead>
                  <tr>
                    <th className="sticky top-0 left-0 z-20 border-r border-b border-slate-400 bg-slate-100 px-2 py-1 text-slate-700">
                      #
                    </th>
                    {columnNumbers.map((colNumber, colIndex) => (
                      <th
                        key={`${activeSheet.name}-col-${colNumber}`}
                        className={`sticky top-0 z-10 min-w-36 cursor-pointer border-r border-b border-slate-400 px-2 py-1 text-left font-bold ${
                          selectedColumns.includes(colNumber)
                            ? "bg-blue-100 text-blue-900"
                            : "bg-slate-100 text-slate-700"
                        }`}
                        onClick={() =>
                          setSelectedColumns((current) =>
                            toggleNumber(current, colNumber),
                          )
                        }
                      >
                        C{colNumber}
                        {colIndex + 1 !== colNumber ? ` (${colIndex + 1})` : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeSheet.rows.map((row, rowIndex) => {
                    const rowNumber = rowNumbers[rowIndex] ?? rowIndex + 1;
                    return (
                      <tr key={`${activeSheet.name}-${rowNumber}`}>
                        <th
                          className={`sticky left-0 z-10 cursor-pointer border-r border-b border-slate-400 px-2 py-1 text-right font-semibold tabular-nums ${
                            selectedRows.includes(rowNumber)
                              ? "bg-blue-100 text-blue-900"
                              : "bg-slate-100 text-slate-700"
                          }`}
                          onClick={() =>
                            setSelectedRows((current) =>
                              toggleNumber(current, rowNumber),
                            )
                          }
                        >
                          {rowNumber}
                        </th>
                        {columnNumbers.map((colNumber, colIndex) => {
                          const value = row[colIndex] ?? "";
                          const edited =
                            exportEditState.cellEdits[activeSheet.name]?.[
                              `${rowNumber}:${colNumber}`
                            ] !== undefined;
                          return (
                            <td
                              key={`${activeSheet.name}-${rowNumber}-${colNumber}`}
                              className="min-w-36 border-r border-b border-slate-400"
                            >
                              <input
                                value={value}
                                onChange={(event) =>
                                  onPreviewEdit(
                                    activeSheet.name,
                                    rowNumber,
                                    colNumber,
                                    event.target.value,
                                  )
                                }
                                className={`h-8 w-full px-2 text-xs outline-none focus:bg-blue-50 ${
                                  edited
                                    ? "bg-amber-50 font-semibold text-amber-950"
                                    : "bg-white text-slate-700"
                                }`}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export function MaterialProfileDetailClient({
  workspaceId,
}: {
  workspaceId: number;
}) {
  const toast = useToast();
  const router = useRouter();
  const utils = api.useUtils();
  const query = api.materialProfile.get.useQuery(
    { workspaceId },
    { refetchOnWindowFocus: false },
  );
  const [step, setStep] = useState<MaterialProfileStep>(1);
  const [maxReached, setMaxReached] = useState<MaterialProfileStep>(1);
  const [selectedSheetName, setSelectedSheetName] = useState("");
  const [headerRowIndex, setHeaderRowIndex] = useState(1);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [edits, setEdits] = useState<CellEdits>({});
  const [isStepTransitioning, setIsStepTransitioning] = useState(false);
  const [downloadingRevisionId, setDownloadingRevisionId] = useState<
    string | null
  >(null);
  const initializedWorkspaceId = useRef<number | null>(null);
  const reviewFlushRef = useRef<(() => Promise<void>) | null>(null);
  const createRevisionInFlightRef = useRef(false);

  const detail = query.data;
  const sheets = useMemo(
    () => detail?.workbook.sheets ?? [],
    [detail?.workbook.sheets],
  );
  const activeSheet = useMemo(
    () =>
      sheets.find((sheet) => sheet.name === selectedSheetName) ??
      sheets.find(
        (sheet) => sheet.name === detail?.workspace.sourceSheetName,
      ) ??
      sheets[0],
    [detail?.workspace.sourceSheetName, selectedSheetName, sheets],
  );

  const reach = useCallback((nextStep: MaterialProfileStep) => {
    setStep(nextStep);
    setMaxReached((current) => (nextStep > current ? nextStep : current));
  }, []);

  const upload = api.materialProfile.uploadWorkbook.useMutation({
    onSuccess: async () => {
      await utils.materialProfile.get.invalidate({ workspaceId });
      toast.success("Đã tải lên và đọc workbook.");
      setStep(2);
      setMaxReached(2);
    },
    onError: (error) =>
      toast.error(
        materialProfileActionMessage(
          error.message,
          "Không thể tải workbook. Kiểm tra file .xlsx rồi thử lại.",
        ),
      ),
  });
  const updateState = api.materialProfile.updateState.useMutation({
    onSuccess: async () => {
      await utils.materialProfile.get.invalidate({ workspaceId });
      toast.success("Đã lưu trạng thái workbook.");
    },
    onError: (error) =>
      toast.error(
        materialProfileActionMessage(
          error.message,
          "Không thể lưu ánh xạ. Kiểm tra các cột bắt buộc rồi thử lại.",
        ),
      ),
  });
  const match = api.materialProfile.match.useMutation({
    onSuccess: async () => {
      await utils.materialProfile.get.invalidate({ workspaceId });
      reach(3);
      toast.success("Đã đối chiếu vật tư. Bạn có thể rà soát kết quả ngay.");
    },
    onError: (error) =>
      toast.error(
        materialProfileActionMessage(
          error.message,
          "Không thể đối chiếu vật tư. Kiểm tra ánh xạ rồi thử lại.",
        ),
      ),
  });
  const downloadExportRevision =
    api.materialProfile.downloadExportRevision.useMutation();
  const createExportRevision =
    api.materialProfile.createExportRevision.useMutation({
      onSuccess: async (revision) => {
        setDownloadingRevisionId(revision.id);
        const refreshHistory = Promise.all([
          utils.materialProfile.listExportRevisions.invalidate({ workspaceId }),
          utils.materialProfile.get.invalidate({ workspaceId }),
        ]).catch(() => undefined);
        try {
          const bundle = await downloadExportRevision.mutateAsync({
            workspaceId,
            revisionId: revision.id,
          });
          const saved = await downloadMaterialProfileRevisionZip(bundle);
          await refreshHistory;
          toast.success(
            `Đã tạo bản xuất #${revision.revisionNumber} và tải ${saved.label}.`,
          );
        } catch {
          await refreshHistory;
          toast.error(
            `Đã tạo bản xuất #${revision.revisionNumber} nhưng không thể tự tải ZIP. Dùng nút Tải ZIP trong lịch sử để thử lại.`,
          );
        } finally {
          setDownloadingRevisionId(null);
        }
      },
      onError: (error) =>
        toast.error(
          materialProfileActionMessage(
            error.message,
            "Không thể tạo bản xuất mới. Kiểm tra bản nháp rồi thử lại.",
          ),
        ),
    });
  const cleanExportPreviewQuery =
    api.materialProfile.previewCleanExport.useQuery(
      { workspaceId },
      {
        enabled: step === 4,
        staleTime: 0,
        refetchOnWindowFocus: false,
      },
    );
  const exportRevisionsQuery = api.materialProfile.listExportRevisions.useQuery(
    { workspaceId },
    {
      enabled: step === 4,
      staleTime: 0,
      refetchOnWindowFocus: false,
    },
  );

  const handleReviewFlushReady = useCallback(
    (flushDecisions: (() => Promise<void>) | null) => {
      reviewFlushRef.current = flushDecisions;
    },
    [],
  );

  const goToStep = useCallback(
    async (
      nextStep: MaterialProfileStep,
      flushOverride?: () => Promise<void>,
    ) => {
      if (nextStep === step || isStepTransitioning) return;
      setIsStepTransitioning(true);
      try {
        if (step === 3) {
          const flushDecisions = flushOverride ?? reviewFlushRef.current;
          if (!flushDecisions) {
            throw new Error("Chưa thể chuẩn bị dữ liệu duyệt để lưu.");
          }
          await flushDecisions();
        }
        if (nextStep === 4) {
          await utils.materialProfile.previewCleanExport.invalidate({
            workspaceId,
          });
          await utils.materialProfile.previewCleanExport.fetch({ workspaceId });
        }
        reach(nextStep);
      } catch {
        toast.error(
          nextStep === 4
            ? "Không thể lưu quyết định và làm mới file xuất. Bạn vẫn ở Bước 3; hãy thử lại."
            : "Không thể lưu quyết định trước khi rời Bước 3. Hãy thử lại.",
        );
      } finally {
        setIsStepTransitioning(false);
      }
    },
    [isStepTransitioning, reach, step, toast, utils, workspaceId],
  );

  const leaveReview = useCallback(async () => {
    if (step !== 3) {
      router.push("/material-profiles");
      return;
    }
    if (isStepTransitioning) return;
    setIsStepTransitioning(true);
    try {
      const flushDecisions = reviewFlushRef.current;
      if (!flushDecisions) {
        throw new Error("Chưa thể chuẩn bị dữ liệu duyệt để lưu.");
      }
      await flushDecisions();
      router.push("/material-profiles");
    } catch {
      toast.error(
        "Không thể lưu quyết định trước khi rời Bước 3. Hãy thử lại.",
      );
      setIsStepTransitioning(false);
    }
  }, [isStepTransitioning, router, step, toast]);

  useEffect(() => {
    if (detail?.workspace.id !== workspaceId) return;
    const nextSheet =
      detail.workspace.sourceSheetName ?? detail.workbook.sheets[0]?.name ?? "";
    setSelectedSheetName((current) => current || nextSheet);
    const sheet =
      detail.workbook.sheets.find((item) => item.name === nextSheet) ??
      detail.workbook.sheets[0];
    setHeaderRowIndex(sheet?.activeHeaderRowIndex ?? 1);
    setMapping(detail.workspace.columnMappingJson);
    setEdits(detail.workspace.editStateJson);
    const reachableStep = restoredMaterialProfileStep({
      sheetCount: detail.workbook.sheets.length,
      itemCount: detail.items.length,
      unresolvedReviewCount: detail.reviewReadiness.unresolvedRows,
      workspaceStatus: detail.workspace.status,
    });

    if (initializedWorkspaceId.current !== workspaceId) {
      initializedWorkspaceId.current = workspaceId;
      setStep(reachableStep);
      setMaxReached(reachableStep);
      return;
    }

    if (reachableStep < 3) {
      setMaxReached(reachableStep);
      setStep((current) => (current > reachableStep ? reachableStep : current));
      return;
    }
    setMaxReached((current) =>
      current > reachableStep ? current : reachableStep,
    );
  }, [detail, workspaceId]);

  const saveState = async () => {
    await updateState.mutateAsync({
      workspaceId,
      sheetName: activeSheet?.name,
      headerRowIndex,
      mapping,
      editState: edits,
    });
  };

  const runMatch = async () => {
    await updateState.mutateAsync({
      workspaceId,
      sheetName: activeSheet?.name,
      headerRowIndex,
      mapping,
      editState: edits,
    });
    match.mutate({
      workspaceId,
      sheetName: activeSheet?.name,
      headerRowIndex,
      mapping,
    });
  };

  const handleFile = async (file: File | null) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      toast.warning("Chỉ nhận file Excel định dạng .xlsx.");
      return;
    }
    try {
      const workbookBase64 = await fileToBase64(file);
      upload.mutate({ workspaceId, fileName: file.name, workbookBase64 });
    } catch (error) {
      toast.error(
        materialProfileActionMessage(
          error instanceof Error ? error.message : undefined,
          "Không thể đọc file .xlsx. Chọn lại file rồi thử lại.",
        ),
      );
    }
  };

  const updateSourceEdit = (
    sheetName: string,
    rowIndex: number,
    colIndex: number,
    value: string,
  ) => {
    const key = cellKey(rowIndex, colIndex);
    setEdits((prev) => ({
      ...prev,
      [sheetName]: {
        ...(prev[sheetName] ?? {}),
        [key]: value,
      },
    }));
  };

  const handleDownloadRevision = async (revisionId: string) => {
    if (downloadingRevisionId || downloadExportRevision.isPending) return;
    setDownloadingRevisionId(revisionId);
    try {
      const bundle = await downloadExportRevision.mutateAsync({
        workspaceId,
        revisionId,
      });
      const saved = await downloadMaterialProfileRevisionZip(bundle);
      toast.success(`Đã tải ${saved.label}.`);
    } catch (error) {
      toast.error(
        materialProfileActionMessage(
          error instanceof Error ? error.message : undefined,
          "Không thể tải bản xuất. Hãy thử lại.",
        ),
      );
    } finally {
      setDownloadingRevisionId(null);
    }
  };

  const handleCreateExportRevision = () => {
    if (
      createRevisionInFlightRef.current ||
      createExportRevision.isPending ||
      downloadExportRevision.isPending
    ) {
      return;
    }
    createRevisionInFlightRef.current = true;
    createExportRevision.mutate(
      { workspaceId },
      {
        onSettled: () => {
          createRevisionInFlightRef.current = false;
        },
      },
    );
  };

  if (query.isError) {
    return (
      <section className="panel p-4">
        <EmptyState
          title="Không tải được hồ sơ vật tư"
          description={materialProfileActionMessage(
            query.error.message,
            "Kiểm tra kết nối rồi tải lại hồ sơ. Nếu lỗi vẫn lặp lại, quay lại danh sách và mở lại hồ sơ này.",
          )}
          cta={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="secondary" onClick={() => void query.refetch()}>
                Tải lại
              </Button>
              <Link
                href="/material-profiles"
                className={inlineSecondaryButtonClass}
              >
                Quay lại danh sách
              </Link>
            </div>
          }
        />
      </section>
    );
  }

  if (query.isLoading || !detail) {
    return <PageSkeleton />;
  }

  const workspace = detail.workspace;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <Link
          href="/material-profiles"
          onClick={(event) => {
            if (step !== 3) return;
            event.preventDefault();
            void leaveReview();
          }}
          className="text-brand focus-visible:ring-ring inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-panel)] px-1 text-sm font-semibold hover:underline focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none sm:min-h-10"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Quay lại danh sách
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge tone="info">{workspace.name?.trim() || "Hồ sơ vật tư"}</Badge>
          {workspace.noticeNumber ? (
            <span className="text-ink-3 text-xs">
              Số TBMT: {workspace.noticeNumber}
            </span>
          ) : null}
        </div>
      </div>

      <MaterialProfileStepHeader
        current={step}
        maxReached={maxReached}
        onJump={(nextStep) => void goToStep(nextStep)}
        isTransitioning={isStepTransitioning}
      />

      {step === 1 ? (
        <UploadStep
          workspace={workspace}
          sheets={sheets}
          isUploading={upload.isPending}
          onFile={handleFile}
          onContinue={() => reach(2)}
        />
      ) : null}

      {step === 2 && activeSheet ? (
        <WorkbookMappingStep
          sheets={sheets}
          activeSheet={activeSheet}
          selectedSheetName={activeSheet.name}
          headerRowIndex={headerRowIndex}
          mapping={mapping}
          edits={edits}
          isSaving={updateState.isPending}
          isMatching={match.isPending}
          onSheetChange={(sheetName) => {
            const sheet = sheets.find((item) => item.name === sheetName);
            setSelectedSheetName(sheetName);
            setHeaderRowIndex(sheet?.activeHeaderRowIndex ?? 1);
            setMapping(sheet?.suggestedMapping ?? {});
          }}
          onHeaderRowChange={setHeaderRowIndex}
          onMappingChange={(key, value) =>
            setMapping((prev) => ({ ...prev, [key]: value }))
          }
          onEdit={(rowIndex, colIndex, value) =>
            updateSourceEdit(activeSheet.name, rowIndex, colIndex, value)
          }
          onSave={() => void saveState()}
          onRunMatch={() => void runMatch()}
          onContinueToReview={() => reach(3)}
          canContinueToReview={(detail?.items.length ?? 0) > 0}
        />
      ) : null}

      {step === 2 && !activeSheet ? (
        <EmptyState
          title="Chưa có workbook"
          description="Quay lại bước 1 để tải lên Excel."
          icon={<FileSpreadsheet className="h-6 w-6" aria-hidden />}
        />
      ) : null}

      {step === 3 ? (
        <MaterialProfileReviewStep
          items={detail.items}
          workspaceId={workspaceId}
          bulkApplyUndoAvailable={hasLastBulkApply(
            workspace.templateConfigJson,
          )}
          onContinue={(flushDecisions) => goToStep(4, flushDecisions)}
          onFlushReady={handleReviewFlushReady}
        />
      ) : null}

      {step === 4 ? (
        <CleanExportStep
          preview={cleanExportPreviewQuery.data}
          revisions={exportRevisionsQuery.data ?? []}
          isLoading={cleanExportPreviewQuery.isLoading}
          isHistoryLoading={exportRevisionsQuery.isLoading}
          errorMessage={cleanExportPreviewQuery.error?.message}
          isCreatingRevision={createExportRevision.isPending}
          downloadingRevisionId={downloadingRevisionId}
          onRefresh={() => void cleanExportPreviewQuery.refetch()}
          onCreateRevision={handleCreateExportRevision}
          onDownloadRevision={(revisionId) =>
            void handleDownloadRevision(revisionId)
          }
          onBackToReview={() => void goToStep(3)}
        />
      ) : null}
    </div>
  );
}
