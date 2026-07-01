"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
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

import { Badge, Button, EmptyState } from "~/app/_components/ui";
import { stepNavReachableClass } from "~/app/_components/ui/button-classes";
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
type PreviewSheet = PreviewResult["sheets"][number];
type ExportEditState = PreviewResult["exportEditState"];
type CellEdits = Record<string, Record<string, string>>;
type MaterialProfileStep = 1 | 2 | 3 | 4;

const materialProfileSteps: Array<{ id: MaterialProfileStep; label: string }> =
  [
    { id: 1, label: "Tải lên Excel" },
    { id: 2, label: "Ánh xạ & chỉnh sheet" },
    { id: 3, label: "Duyệt vật tư" },
    { id: 4, label: "Xem trước & xuất" },
  ];

const mappingFields = [
  { key: "materialName", label: "Tên vật tư", required: true },
  { key: "code", label: "Mã vật tư" },
  { key: "unit", label: "ĐVT" },
  { key: "category", label: "Nhóm" },
  { key: "specText", label: "Thông số" },
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

function emptyExportEditState(): ExportEditState {
  return {
    cellEdits: {},
    deletedRows: {},
    deletedColumns: {},
    updatedAt: undefined,
  };
}

function normalizeExportEditState(value: unknown): ExportEditState {
  if (!value || typeof value !== "object") return emptyExportEditState();
  const record = value as Partial<ExportEditState>;
  return {
    cellEdits: record.cellEdits ?? {},
    deletedRows: record.deletedRows ?? {},
    deletedColumns: record.deletedColumns ?? {},
    updatedAt: record.updatedAt,
  };
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
        className="h-1.5 w-full bg-slate-100"
        role="progressbar"
        aria-label="Tiến độ hồ sơ vật tư"
        aria-valuemin={1}
        aria-valuemax={materialProfileSteps.length}
        aria-valuenow={current}
      >
        <div
          className="brand-rule h-full transition-all duration-500 ease-out"
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
                className={`inline-flex items-center gap-2 rounded px-2.5 py-1.5 text-xs font-extrabold transition-colors disabled:cursor-not-allowed ${
                  isCurrent
                    ? "bg-blue-700 text-white"
                    : isReachable
                      ? stepNavReachableClass
                      : "text-slate-600"
                }`}
              >
                <span
                  className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-extrabold tabular-nums ${
                    isCurrent
                      ? "bg-white/20 text-white"
                      : isDone
                        ? "bg-emerald-600 text-white"
                        : "bg-slate-200 text-slate-900"
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
                <span className="h-px w-3 bg-slate-300 sm:w-6" aria-hidden />
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

  return (
    <div
      className={`${maxHeight} overflow-auto rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)]`}
    >
      <table className="min-w-full border-separate border-spacing-0 text-xs">
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${sheet.name}-${rowIndex}`}>
              <th className="sticky left-0 z-10 border-r border-b border-slate-400 bg-slate-100 px-2 py-1 text-right font-semibold text-slate-700 tabular-nums">
                {rowIndex + 1}
              </th>
              {Array.from({ length: maxColumns }).map((_, colIndex) => {
                const isHeader = rowIndex + 1 === headerRowIndex;
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
                    className="min-w-36 border-r border-b border-slate-400"
                  >
                    <input
                      value={value}
                      onChange={(event) =>
                        onEdit(rowIndex, colIndex, event.target.value)
                      }
                      className={`h-8 w-full px-2 text-xs outline-none focus:bg-blue-50 ${
                        isHeader
                          ? "bg-slate-50 font-bold text-slate-900"
                          : "bg-white text-slate-700"
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
    { label: "Đã tạo work từ Số TBMT", done: Boolean(workspace.noticeNumber) },
    { label: "Đã upload file Excel", done: Boolean(workspace.sourceFileName) },
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
        <h2 className="mt-1 text-lg font-bold text-slate-950">
          Chọn workbook làm việc
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          File gốc được lưu lại để các bước sau có thể map vật tư, preview kết
          quả và export giữ layout.
        </p>
        <label className="mt-4 flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded border border-dashed border-blue-300 bg-blue-50 px-4 py-2 text-center text-blue-900 transition-colors hover:bg-blue-100">
          {isUploading ? (
            <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
          ) : (
            <Upload className="h-6 w-6" aria-hidden />
          )}
          <span className="text-sm font-bold">Tải file Excel</span>
          <span className="max-w-full truncate text-xs font-medium text-slate-600">
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
                  : "border-slate-500 bg-white text-slate-900 shadow-sm"
              }`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full ${
                  item.done ? "bg-emerald-600 text-white" : "bg-slate-200"
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
          Tiếp tục map sheet
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
  const hasNameColumn = Boolean(mapping.materialName);
  const optionalMapped = mappingFields.filter(
    (field) =>
      !("required" in field && field.required) && Boolean(mapping[field.key]),
  ).length;

  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-slate-400 bg-white px-4 py-4">
        <p className="section-title">Map & chỉnh workbook</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-1">
          <div>
            <h2 className="text-lg font-bold text-slate-950">
              Map cột vật tư và chỉnh cell
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Đã map {optionalMapped}/{mappingFields.length - 1} cột phụ.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={onSave}
              isLoading={isSaving}
              leftIcon={<Check className="h-4 w-4" />}
            >
              Lưu state
            </Button>
            <Button
              disabled={!hasNameColumn}
              onClick={onRunMatch}
              isLoading={isMatching}
              leftIcon={<Search className="h-4 w-4" />}
            >
              Lưu & chạy match
            </Button>
            <Button
              variant="primary"
              disabled={!canContinueToReview}
              onClick={onContinueToReview}
            >
              Tiếp tục duyệt vật tư
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-2 p-4">
        <div className="grid gap-1 lg:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold tracking-[0.12em] text-slate-600 uppercase">
              Sheet vật tư
            </span>
            <select
              value={selectedSheetName}
              onChange={(event) => onSheetChange(event.target.value)}
              className="h-10 rounded border border-slate-500 bg-white px-3 text-sm text-slate-900 shadow-[var(--shadow-flat)]"
            >
              {sheets.map((sheet) => (
                <option key={sheet.name} value={sheet.name}>
                  {sheet.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold tracking-[0.12em] text-slate-600 uppercase">
              Header row
            </span>
            <input
              type="number"
              min={1}
              value={headerRowIndex}
              onChange={(event) =>
                onHeaderRowChange(Math.max(1, Number(event.target.value)))
              }
              className="h-10 rounded border border-slate-500 bg-white px-3 text-sm text-slate-900 shadow-[var(--shadow-flat)]"
            />
          </label>
          <div className="rounded border border-slate-400 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <p className="font-bold text-slate-900">Điều kiện qua bước</p>
            <p className="mt-1">
              Cần map cột Tên vật tư, chạy match, rồi bấm «Tiếp tục duyệt vật
              tư» để sang bước 3.
            </p>
          </div>
        </div>

        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-5">
          {mappingFields.map((field) => (
            <label key={field.key} className="flex flex-col gap-1">
              <span className="text-xs font-semibold tracking-[0.12em] text-slate-600 uppercase">
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
                className="h-9 rounded border border-slate-500 bg-white px-2 text-xs text-slate-900 shadow-[var(--shadow-flat)]"
              >
                <option value="">Không map</option>
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

function ExportPreviewStep({
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
              Refresh preview
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
              <p className="font-bold">Workbook edit warnings</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <Badge tone="warning" count={editSummary?.editedCellCount ?? 0}>
                  Cell edits
                </Badge>
                <Badge tone="warning" count={editSummary?.deletedRowCount ?? 0}>
                  Deleted rows
                </Badge>
                <Badge
                  tone="warning"
                  count={editSummary?.deletedColumnCount ?? 0}
                >
                  Deleted columns
                </Badge>
                <Badge
                  tone="warning"
                  count={editSummary?.deletedMaterialRowCount ?? 0}
                >
                  Material rows removed
                </Badge>
              </div>
            </div>
            <div className="rounded border border-slate-400 bg-slate-50 px-3 py-3 text-sm text-slate-700">
              <p className="font-bold text-slate-950">Match/catalog counts</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <Badge tone="success" count={matchCounts?.matchedCount ?? 0}>
                  Matched
                </Badge>
                <Badge tone="warning" count={matchCounts?.reviewCount ?? 0}>
                  Review
                </Badge>
                <Badge tone="neutral" count={matchCounts?.unmatchedCount ?? 0}>
                  Unmatched
                </Badge>
                <Badge
                  tone="info"
                  count={matchCounts?.missingCatalogCount ?? 0}
                >
                  Missing catalog
                </Badge>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {!preview || !activeSheet ? (
        <EmptyState
          title="Chưa có bản xem trước"
          description="Bấm Refresh preview để tạo workbook kết quả trước khi export."
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
              <span>{selectedRows.length} row selected</span>
              <span>{selectedColumns.length} column selected</span>
              <span>{deletedRows.length} deleted rows</span>
              <span>{deletedColumns.length} deleted columns</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="danger"
                disabled={selectedCount === 0}
                onClick={deleteSelected}
                leftIcon={<Trash2 className="h-4 w-4" />}
              >
                Delete selected
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={deletedRows.length + deletedColumns.length === 0}
                onClick={onRefreshPreview}
              >
                Refresh after restore
              </Button>
            </div>
          </div>
          {deletedRows.length + deletedColumns.length > 0 ? (
            <div className="border-b border-slate-400 bg-rose-50 px-4 py-3 text-xs text-rose-950">
              <p className="font-bold">Deleted in export preview</p>
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
                    Restore row {rowNumber}
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
                    Restore col {colNumber}
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
  const [exportEditState, setExportEditState] =
    useState<ExportEditState>(emptyExportEditState);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewAutoRequested, setPreviewAutoRequested] = useState(false);

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
      toast.success("Đã upload và đọc workbook.");
      reach(2);
    },
    onError: (error) => toast.error(error.message),
  });
  const updateState = api.materialProfile.updateState.useMutation({
    onSuccess: async () => {
      await utils.materialProfile.get.invalidate({ workspaceId });
      toast.success("Đã lưu trạng thái workbook.");
    },
    onError: (error) => toast.error(error.message),
  });
  const match = api.materialProfile.match.useMutation({
    onSuccess: async () => {
      await utils.materialProfile.get.invalidate({ workspaceId });
      setPreview(null);
      setPreviewAutoRequested(false);
      toast.success(
        "Đã match vật tư từ catalog. Bấm «Tiếp tục duyệt vật tư» để sang bước 3.",
      );
    },
    onError: (error) => toast.error(error.message),
  });
  const previewExport = api.materialProfile.previewExportWorkbook.useMutation({
    onSuccess: (result) => {
      setPreview(result);
      setExportEditState(result.exportEditState);
    },
    onError: (error) => toast.error(error.message),
  });
  const updateExportEditState =
    api.materialProfile.updateExportEditState.useMutation({
      onSuccess: async () => {
        await utils.materialProfile.get.invalidate({ workspaceId });
        toast.success("Đã lưu preview export.");
      },
      onError: (error) => toast.error(error.message),
    });
  const exportWorkspace = api.materialProfile.export.useMutation({
    onSuccess: async (result) => {
      setLastMaterialProfileExportDir(result.parentDirPath);
      await utils.materialProfile.get.invalidate({ workspaceId });
      if (result.missingCount > 0 || result.warnings.length > 0) {
        toast.warning(
          `Đã export vào ${result.outputDirPath}, nhưng có ${result.missingCount} cảnh báo catalog.`,
        );
      } else {
        toast.success(`Đã export vào ${result.outputDirPath}`);
      }
    },
    onError: (error) => toast.error(error.message),
  });
  const exportDownloadBundle =
    api.materialProfile.exportDownloadBundle.useMutation({
      onError: (error) => toast.error(error.message),
    });
  const defaultExportDirQuery =
    api.materialProfile.getDefaultExportDir.useQuery(undefined, {
      enabled: step === 4,
      staleTime: Infinity,
    });

  useEffect(() => {
    if (!detail) return;
    const nextSheet =
      detail.workspace.sourceSheetName ?? detail.workbook.sheets[0]?.name ?? "";
    setSelectedSheetName((current) => current || nextSheet);
    const sheet =
      detail.workbook.sheets.find((item) => item.name === nextSheet) ??
      detail.workbook.sheets[0];
    setHeaderRowIndex(sheet?.activeHeaderRowIndex ?? 1);
    setMapping(detail.workspace.columnMappingJson);
    setEdits(detail.workspace.editStateJson);
    setExportEditState(
      normalizeExportEditState(detail.workspace.exportEditStateJson),
    );

    let nextMax: MaterialProfileStep = 1;
    if (detail.workbook.sheets.length > 0) nextMax = 2;
    if (detail.items.length > 0) nextMax = 3;
    if (detail.items.length > 0) nextMax = 4;
    setMaxReached((current) => (nextMax > current ? nextMax : current));
  }, [detail]);

  const refreshPreview = useCallback(() => {
    setPreviewAutoRequested(true);
    previewExport.mutate({ workspaceId });
  }, [previewExport, workspaceId]);

  useEffect(() => {
    if (
      step === 4 &&
      !preview &&
      !previewExport.isPending &&
      !previewAutoRequested
    ) {
      refreshPreview();
    }
  }, [
    preview,
    previewAutoRequested,
    previewExport.isPending,
    refreshPreview,
    step,
  ]);

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
        error instanceof Error ? error.message : "Không đọc được file.",
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

  const updateExportCellEdit = (
    sheetName: string,
    rowNumber: number,
    colNumber: number,
    value: string,
  ) => {
    const key = `${rowNumber}:${colNumber}`;
    setExportEditState((prev) => ({
      ...prev,
      cellEdits: {
        ...prev.cellEdits,
        [sheetName]: {
          ...(prev.cellEdits[sheetName] ?? {}),
          [key]: value,
        },
      },
    }));
    setPreview((current) =>
      current
        ? {
            ...current,
            sheets: current.sheets.map((sheet) =>
              sheet.name === sheetName
                ? {
                    ...sheet,
                    rows: sheet.rows.map((row, rIndex) =>
                      sheet.rowNumbers?.[rIndex] === rowNumber
                        ? Array.from({
                            length: row.length,
                          }).map((_, cIndex) =>
                            sheet.columnNumbers?.[cIndex] === colNumber
                              ? value
                              : (row[cIndex] ?? ""),
                          )
                        : row,
                    ),
                  }
                : sheet,
            ),
          }
        : current,
    );
  };

  const saveExportEditState = async () => {
    await updateExportEditState.mutateAsync({
      workspaceId,
      exportEditState,
    });
  };

  const deleteExportSelection = (
    sheetName: string,
    rowNumbers: number[],
    colNumbers: number[],
  ) => {
    setExportEditState((prev) => ({
      ...prev,
      deletedRows: {
        ...prev.deletedRows,
        [sheetName]: Array.from(
          new Set([...(prev.deletedRows[sheetName] ?? []), ...rowNumbers]),
        ).sort((a, b) => a - b),
      },
      deletedColumns: {
        ...prev.deletedColumns,
        [sheetName]: Array.from(
          new Set([...(prev.deletedColumns[sheetName] ?? []), ...colNumbers]),
        ).sort((a, b) => a - b),
      },
    }));
    setPreview((current) =>
      current
        ? {
            ...current,
            sheets: current.sheets.map((sheet) =>
              sheet.name === sheetName
                ? {
                    ...sheet,
                    rowNumbers: sheet.rowNumbers.filter(
                      (rowNumber) => !rowNumbers.includes(rowNumber),
                    ),
                    columnNumbers: sheet.columnNumbers.filter(
                      (colNumber) => !colNumbers.includes(colNumber),
                    ),
                    rows: sheet.rows
                      .filter(
                        (_, rowIndex) =>
                          !rowNumbers.includes(
                            sheet.rowNumbers[rowIndex] ?? -1,
                          ),
                      )
                      .map((row) =>
                        row.filter(
                          (_, colIndex) =>
                            !colNumbers.includes(
                              sheet.columnNumbers[colIndex] ?? -1,
                            ),
                        ),
                      ),
                  }
                : sheet,
            ),
          }
        : current,
    );
  };

  const restoreDeletedExportValue = (
    sheetName: string,
    kind: "row" | "column",
    value: number,
  ) => {
    setExportEditState((prev) => ({
      ...prev,
      deletedRows:
        kind === "row"
          ? {
              ...prev.deletedRows,
              [sheetName]: (prev.deletedRows[sheetName] ?? []).filter(
                (rowNumber) => rowNumber !== value,
              ),
            }
          : prev.deletedRows,
      deletedColumns:
        kind === "column"
          ? {
              ...prev.deletedColumns,
              [sheetName]: (prev.deletedColumns[sheetName] ?? []).filter(
                (colNumber) => colNumber !== value,
              ),
            }
          : prev.deletedColumns,
    }));
    setPreview(null);
    setPreviewAutoRequested(false);
    toast.info("Đã restore trong state. Lưu preview rồi refresh để hiện lại.");
  };

  const savePreviewForExport = async () => {
    await updateState.mutateAsync({
      workspaceId,
      sheetName: activeSheet?.name,
      headerRowIndex,
      mapping,
      editState: edits,
    });
    await updateExportEditState.mutateAsync({
      workspaceId,
      exportEditState,
    });
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

      await savePreviewForExport();

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

      if (bundle.missingCount > 0 || bundle.warnings.length > 0) {
        toast.warning(
          `Đã lưu ${saved.label}, nhưng có ${bundle.missingCount} cảnh báo catalog.`,
        );
      } else {
        toast.success(`Đã lưu export: ${saved.label}`);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      toast.error(
        error instanceof Error ? error.message : "Không export được.",
      );
    }
  };

  if (query.isLoading || !detail) {
    return (
      <div className="panel p-2 text-sm text-slate-600">Đang tải hồ sơ…</div>
    );
  }

  const workspace = detail.workspace;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <Link
          href="/material-profiles"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Quay lại danh sách
        </Link>
        <Badge tone="info">{workspace.noticeNumber ?? workspace.name}</Badge>
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
          description="Quay lại bước 1 để upload Excel."
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
        <ExportPreviewStep
          preview={preview}
          exportEditState={exportEditState}
          isPreviewing={previewExport.isPending}
          isSaving={updateExportEditState.isPending}
          isExporting={
            exportWorkspace.isPending || exportDownloadBundle.isPending
          }
          onRefreshPreview={refreshPreview}
          onPreviewEdit={updateExportCellEdit}
          onDeleteSelection={deleteExportSelection}
          onRestoreDeleted={restoreDeletedExportValue}
          onSavePreview={() => void saveExportEditState()}
          onExport={() => void handleExportClick()}
        />
      ) : null}
    </div>
  );
}
