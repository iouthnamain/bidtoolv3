"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
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
import {
  getLastMaterialProfileExportDir,
  pickMaterialProfileBrowserExportDirectory,
  pickMaterialProfileExportDir,
  saveMaterialProfileExportBundleInBrowser,
  setLastMaterialProfileExportDir,
} from "~/lib/material-profile-export-dir";
import { api, type RouterOutputs } from "~/trpc/react";

type WorkspaceDetail = RouterOutputs["materialProfile"]["get"];
type Sheet = WorkspaceDetail["workbook"]["sheets"][number];
type PreviewResult = RouterOutputs["materialProfile"]["previewExportWorkbook"];
type CleanExportPreview =
  RouterOutputs["materialProfile"]["previewCleanExport"];
type PreviewSheet = PreviewResult["sheets"][number];
type ExportEditState = PreviewResult["exportEditState"];
type CellEdits = Record<string, Record<string, string>>;
type MaterialProfileStep = 1 | 2 | 3 | 4;

const materialProfileSteps: Array<{ id: MaterialProfileStep; label: string }> =
  [
    { id: 1, label: "Tải lên Excel" },
    { id: 2, label: "Kiểm tra dữ liệu" },
    { id: 3, label: "Tự tìm & điền" },
    { id: 4, label: "Tải file chuẩn" },
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

function profileActionError(error: unknown, fallback: string) {
  const detail = error instanceof Error ? error.message.trim() : "";
  if (!detail || /^(?:INTERNAL_SERVER_ERROR|UNKNOWN_ERROR)$/i.test(detail)) {
    return fallback;
  }
  return `${fallback} ${detail}`;
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
}: {
  current: MaterialProfileStep;
  maxReached: MaterialProfileStep;
  onJump: (step: MaterialProfileStep) => void;
}) {
  const progressPercent =
    ((current - 1) / (materialProfileSteps.length - 1)) * 100;

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

      <div className="flex flex-wrap items-center gap-2 p-2 sm:gap-1 sm:p-3">
        {materialProfileSteps.map((step, index) => {
          const isCurrent = step.id === current;
          const isDone = step.id < current;
          const isReachable = step.id <= maxReached;

          return (
            <div key={step.id} className="flex items-center gap-1 sm:gap-2">
              <button
                type="button"
                disabled={!isReachable}
                onClick={() => isReachable && onJump(step.id)}
                aria-current={isCurrent ? "step" : undefined}
                className={`focus-visible:ring-ring focus-visible:ring-offset-surface-1 inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-panel)] px-2.5 py-1.5 text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed motion-reduce:transition-none md:min-h-10 ${
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
                <span className="hidden text-balance sm:inline">
                  {step.label}
                </span>
                <span className="sr-only sm:hidden">{step.label}</span>
              </button>
              {index < materialProfileSteps.length - 1 ? (
                <span className="bg-line h-px w-3 sm:w-6" aria-hidden />
              ) : null}
            </div>
          );
        })}
      </div>
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
    { label: "Đã tạo hồ sơ từ Số TBMT", done: Boolean(workspace.noticeNumber) },
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

  return (
    <section className="grid gap-2 lg:grid-cols-[0.9fr_1.1fr]">
      <div className="panel p-4">
        <p className="section-title">Tải file Excel</p>
        <h2 className="text-ink-1 mt-1 text-base font-semibold">
          Chọn workbook làm việc
        </h2>
        <p className="text-ink-2 mt-2 text-sm leading-6">
          File gốc được lưu lại để các bước sau có thể ánh xạ vật tư, xem trước
          kết quả và xuất file giữ nguyên bố cục.
        </p>
        <label className="border-brand bg-surface-2 text-brand hover:bg-surface-3 focus-within:ring-ring mt-4 flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-panel)] border border-dashed px-4 py-2 text-center transition-colors focus-within:ring-2 motion-reduce:transition-none">
          {isUploading ? (
            <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
          ) : (
            <Upload className="h-6 w-6" aria-hidden />
          )}
          <span className="text-sm font-bold">Tải file Excel</span>
          <span className="text-ink-2 max-w-full truncate text-xs font-medium">
            {workspace.sourceFileName ?? ".xlsx"}
          </span>
          <input
            type="file"
            accept=".xlsx"
            className="sr-only"
            onChange={(event) => onFile(event.target.files?.[0] ?? null)}
          />
        </label>
      </div>

      <aside className="panel p-4">
        <p className="section-title">Checklist</p>
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
        <Button
          className="mt-4"
          disabled={sheets.length === 0}
          onClick={onContinue}
        >
          Tiếp tục ánh xạ sheet
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

  return (
    <section className="panel overflow-hidden">
      <div className="border-line bg-surface-1 border-b px-4 py-4">
        <p className="section-title">Ánh xạ & chỉnh workbook</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-1">
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
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={onSave}
              isLoading={isSaving}
              leftIcon={<Check className="h-4 w-4" />}
            >
              Lưu thay đổi
            </Button>
            <Button
              disabled={!hasRequiredColumns}
              onClick={onRunMatch}
              isLoading={isMatching}
              leftIcon={<Search className="h-4 w-4" />}
            >
              Kiểm tra & đối chiếu
            </Button>
            <Button
              variant="primary"
              disabled={!canContinueToReview}
              onClick={onContinueToReview}
            >
              Tiếp tục tự xử lý
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-2 p-4">
        {!hasRequiredColumns ? (
          <div
            className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"
            role="alert"
          >
            Chưa thể tự xử lý: hãy ánh xạ đủ <strong>Tên vật tư</strong>,
            <strong> ĐVT</strong> và <strong> Thông số kỹ thuật</strong>. Dòng
            thiếu giá trị ở các cột này sẽ được giữ lại để sửa, không bị gửi đi
            tìm kiếm.
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
          <div className="border-line bg-surface-2 text-ink-2 rounded-[var(--radius-panel)] border px-3 py-2 text-xs">
            <p className="text-ink-1 font-semibold">Điều kiện qua bước</p>
            <p className="mt-1">
              Cần ánh xạ Tên vật tư, ĐVT, Thông số kỹ thuật, chạy kiểm tra rồi
              bấm «Tiếp tục tự xử lý» để sang bước 3.
            </p>
          </div>
        </div>

        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-5">
          {mappingFields.map((field) => (
            <label key={field.key} className="flex flex-col gap-1">
              <span className="text-ink-3 text-xs font-semibold tracking-[0.12em] uppercase">
                {field.label}
                {"required" in field && field.required ? (
                  <span className="text-rose-500"> *</span>
                ) : null}
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

        <WorkbookGrid sheet={activeSheet} edits={edits} onEdit={onEdit} />
      </div>
    </section>
  );
}

function CleanExportStep({
  preview,
  isLoading,
  isExporting,
  onRefresh,
  onExport,
  onBackToReview,
}: {
  preview: CleanExportPreview | undefined;
  isLoading: boolean;
  isExporting: boolean;
  onRefresh: () => void;
  onExport: () => void;
  onBackToReview: () => void;
}) {
  const incompleteRows = preview?.incompleteRows ?? 0;
  const canExport = preview?.canExport === true;

  return (
    <section className="space-y-4">
      <div className="panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-3xl">
            <p className="section-title">Danh mục chuẩn</p>
            <h2 className="text-ink-1 mt-1 text-base font-semibold">
              Một sheet sạch, sẵn sàng gửi đi
            </h2>
            <p className="text-ink-2 mt-2 text-sm leading-6">
              File xuất giữ 11 cột chuẩn. Dòng còn thiếu dữ liệu vẫn được xuất
              với ô trống và trạng thái “Cần xác minh” để tiếp tục xử lý.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={onRefresh}
              isLoading={isLoading}
              leftIcon={<RefreshCw className="h-4 w-4" />}
            >
              Làm mới kiểm tra
            </Button>
            <Button
              onClick={onExport}
              disabled={!canExport}
              isLoading={isExporting}
              leftIcon={<Download className="h-4 w-4" />}
              title={
                canExport
                  ? "Tải danh mục vật tư chuẩn"
                  : "Chưa có dòng vật tư hiện tại để xuất"
              }
            >
              Tải danh mục chuẩn
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
      </div>

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
  const initializedWorkspaceId = useRef<number | null>(null);

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
        profileActionError(
          error,
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
        profileActionError(
          error,
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
        profileActionError(
          error,
          "Không thể đối chiếu vật tư. Kiểm tra ánh xạ rồi thử lại.",
        ),
      ),
  });
  const exportWorkspace = api.materialProfile.export.useMutation({
    onSuccess: async (result) => {
      setLastMaterialProfileExportDir(result.parentDirPath);
      await utils.materialProfile.get.invalidate({ workspaceId });
      if (
        result.missingCount > 0 ||
        result.warnings.length > 0 ||
        result.unresolvedReviewCount > 0
      ) {
        toast.warning(
          `Đã xuất file vào ${result.outputDirPath}, nhưng còn ${result.unresolvedReviewCount.toLocaleString("vi-VN")} dòng chưa duyệt và ${result.missingCount.toLocaleString("vi-VN")} cảnh báo catalog.`,
        );
      } else {
        toast.success(`Đã xuất file vào ${result.outputDirPath}`);
      }
    },
    onError: (error) =>
      toast.error(
        profileActionError(
          error,
          "Không thể xuất file workbook. Chọn lại thư mục đích rồi thử lại.",
        ),
      ),
  });
  const exportDownloadBundle =
    api.materialProfile.exportDownloadBundle.useMutation({
      onError: (error) =>
        toast.error(
          profileActionError(
            error,
            "Không thể tạo file tải xuống. Thử lại sau ít phút.",
          ),
        ),
    });
  const defaultExportDirQuery =
    api.materialProfile.getDefaultExportDir.useQuery(undefined, {
      enabled: step === 4,
      staleTime: Infinity,
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
    const reachableStep: MaterialProfileStep =
      detail.workbook.sheets.length === 0
        ? 1
        : detail.items.length === 0
          ? 2
          : 4;

    if (initializedWorkspaceId.current !== workspaceId) {
      initializedWorkspaceId.current = workspaceId;
      setStep(reachableStep);
      setMaxReached(reachableStep);
      return;
    }

    setMaxReached(reachableStep);
    setStep((current) => (current > reachableStep ? reachableStep : current));
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
    try {
      const workbookBase64 = await fileToBase64(file);
      upload.mutate({ workspaceId, fileName: file.name, workbookBase64 });
    } catch (error) {
      toast.error(
        profileActionError(
          error,
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

  const handleExportClick = async () => {
    if (exportWorkspace.isPending || exportDownloadBundle.isPending) {
      return;
    }

    const isDesktop = !!window.bidtoolDesktop?.isDesktop;
    let desktopOutputPath: string | null = null;
    let browserDirectoryHandle: FileSystemDirectoryHandle | null = null;

    try {
      if (isDesktop) {
        desktopOutputPath = await pickMaterialProfileExportDir(
          getLastMaterialProfileExportDir() ?? defaultExportDirQuery.data?.path,
        );
        if (!desktopOutputPath) {
          return;
        }
      } else {
        browserDirectoryHandle =
          await pickMaterialProfileBrowserExportDirectory();
      }

      if (isDesktop && desktopOutputPath) {
        exportWorkspace.mutate({
          workspaceId,
          outputDirPath: desktopOutputPath,
        });
        return;
      }

      const bundle = await exportDownloadBundle.mutateAsync({ workspaceId });
      const saved = await saveMaterialProfileExportBundleInBrowser(
        bundle,
        browserDirectoryHandle,
      );
      await utils.materialProfile.get.invalidate({ workspaceId });

      if (
        bundle.missingCount > 0 ||
        bundle.warnings.length > 0 ||
        bundle.unresolvedReviewCount > 0
      ) {
        toast.warning(
          `Đã lưu ${saved.label}, nhưng còn ${bundle.unresolvedReviewCount.toLocaleString("vi-VN")} dòng chưa duyệt và ${bundle.warnings.length.toLocaleString("vi-VN")} cảnh báo cần kiểm tra.`,
        );
      } else {
        toast.success(`Đã lưu file xuất: ${saved.label}`);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      toast.error(
        profileActionError(
          error,
          "Không thể xuất file workbook. Chọn lại thư mục đích rồi thử lại.",
        ),
      );
    }
  };

  if (query.isError) {
    return (
      <section className="panel p-4">
        <EmptyState
          title="Không tải được hồ sơ vật tư"
          description={`Kiểm tra kết nối rồi tải lại hồ sơ. Nếu lỗi vẫn lặp lại, quay lại danh sách và mở lại hồ sơ này. ${query.error.message}`}
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
        onJump={setStep}
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
          onContinue={() => reach(4)}
        />
      ) : null}

      {step === 4 ? (
        <CleanExportStep
          preview={cleanExportPreviewQuery.data}
          isLoading={cleanExportPreviewQuery.isLoading}
          isExporting={
            exportWorkspace.isPending || exportDownloadBundle.isPending
          }
          onRefresh={() => void cleanExportPreviewQuery.refetch()}
          onExport={() => void handleExportClick()}
          onBackToReview={() => reach(3)}
        />
      ) : null}
    </div>
  );
}
