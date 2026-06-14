"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Play,
  ThumbsDown,
  ThumbsUp,
  Upload,
} from "lucide-react";

import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
} from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import {
  type ExcelResearchRowStatus,
  isExcelResearchJobActive,
  isExcelResearchJobReviewReady,
} from "~/app/_components/research-enrich/excel-research-types";
import {
  ResearchEnrichStepHeader,
  type ResearchEnrichStep,
} from "~/app/_components/research-enrich/research-enrich-step-header";
import {
  FIELD_LABELS,
  type FillableField,
} from "~/lib/materials/excel-enrich-fields";
import { api, type RouterOutputs } from "~/trpc/react";

const JOB_POLL_MS = 2_000;
const EMPTY_JOB_ID = "00000000-0000-0000-0000-000000000000";

type ExcelResearchPreview = RouterOutputs["excelResearch"]["previewUpload"];
type ExcelResearchPreviewSheet = ExcelResearchPreview["sheets"][number];
type ExcelResearchJobStatusResponse =
  RouterOutputs["excelResearch"]["getJobStatus"];
type ExcelResearchListRowsResult =
  RouterOutputs["excelResearch"]["listRowResults"];
type ExcelResearchRowSummary = ExcelResearchListRowsResult["items"][number];
type ExcelResearchRowEvidence =
  RouterOutputs["excelResearch"]["getRowResult"]["evidence"][number];

const ROW_STATUS_META: Record<
  ExcelResearchRowStatus,
  { label: string; tone: "success" | "warning" | "neutral" | "critical" }
> = {
  pending: { label: "Chờ xử lý", tone: "neutral" },
  processing: { label: "Đang xử lý", tone: "neutral" },
  matched: { label: "Đã khớp", tone: "success" },
  needs_review: { label: "Cần duyệt", tone: "warning" },
  approved: { label: "Đã duyệt", tone: "success" },
  skipped: { label: "Đã bỏ qua", tone: "critical" },
  error: { label: "Lỗi", tone: "critical" },
};

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = reader.result;
      if (typeof value === "string") {
        resolve(value);
        return;
      }
      reject(new Error("Không đọc được tệp Excel."));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Không đọc được tệp Excel."));
    reader.readAsDataURL(file);
  });
}

function downloadBase64Xlsx(fileName: string, base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function fieldLabel(field: string) {
  return FIELD_LABELS[field as FillableField] ?? field;
}

export function ResearchEnrichClient() {
  const toast = useToast();

  const [step, setStep] = useState<ResearchEnrichStep>(1);
  const [maxReached, setMaxReached] = useState<ResearchEnrichStep>(1);

  const [file, setFile] = useState<File | null>(null);
  const [base64, setBase64] = useState<string | null>(null);
  const [preview, setPreview] = useState<ExcelResearchPreview | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ExcelResearchRowStatus | "all">(
    "all",
  );
  const [selectedRowNumber, setSelectedRowNumber] = useState<number | null>(null);
  const [confirmExportOpen, setConfirmExportOpen] = useState(false);

  const previewRequestRef = useRef(0);

  const activeSheet: ExcelResearchPreviewSheet | undefined =
    preview?.sheets.find((s) => s.name === sheetName) ?? preview?.sheets[0];

  const previewUpload = api.excelResearch.previewUpload.useMutation();
  const createJob = api.excelResearch.createJob.useMutation();
  const startJob = api.excelResearch.startJob.useMutation();
  const approveRow = api.excelResearch.approveRow.useMutation();
  const rejectRow = api.excelResearch.rejectRow.useMutation();
  const exportExcel = api.excelResearch.exportExcel.useMutation();

  const jobStatusQuery = api.excelResearch.getJobStatus.useQuery(
    { jobId: jobId ?? EMPTY_JOB_ID },
    {
      enabled: jobId !== null,
      refetchInterval: (query) =>
        isExcelResearchJobActive(query.state.data) ? JOB_POLL_MS : false,
      refetchOnWindowFocus: false,
      retry: false,
    },
  );

  const reviewReady = isExcelResearchJobReviewReady(jobStatusQuery.data);

  const listRowsQuery = api.excelResearch.listRowResults.useQuery(
    {
      jobId: jobId ?? EMPTY_JOB_ID,
      status: statusFilter === "all" ? undefined : statusFilter,
      limit: 200,
    },
    {
      enabled: jobId !== null && step >= 2 && reviewReady,
      refetchOnWindowFocus: false,
    },
  );

  const rowDetailQuery = api.excelResearch.getRowResult.useQuery(
    {
      jobId: jobId ?? EMPTY_JOB_ID,
      rowNumber: selectedRowNumber ?? 1,
    },
    {
      enabled: jobId !== null && selectedRowNumber != null && step >= 2,
      refetchOnWindowFocus: false,
    },
  );

  const activeJob = jobStatusQuery.data;
  const isJobRunning = isExcelResearchJobActive(activeJob);
  const rowData = listRowsQuery.data;

  const rowSummary = useMemo(() => {
    const counts: Record<ExcelResearchRowStatus, number> = {
      pending: 0,
      processing: 0,
      matched: 0,
      needs_review: 0,
      approved: 0,
      skipped: 0,
      error: 0,
    };
    for (const row of rowData?.items ?? []) {
      counts[row.status] += 1;
    }
    return {
      total: rowData?.total ?? activeJob?.totalRows ?? 0,
      ...counts,
      needsReview: activeJob?.needsReviewRows ?? counts.needs_review,
      errors: activeJob?.errorRows ?? counts.error,
      matched: activeJob?.matchedRows ?? counts.matched,
    };
  }, [rowData, activeJob]);

  const reach = (target: ResearchEnrichStep) => {
    setStep(target);
    setMaxReached((prev) => (target > prev ? target : prev));
  };

  useEffect(() => {
    if (!activeJob || step !== 1) return;
    if (isExcelResearchJobReviewReady(activeJob)) {
      reach(2);
    }
    if (activeJob.status === "failed" || activeJob.status === "cancelled") {
      setError(activeJob.error ?? activeJob.message ?? "Job nghiên cứu thất bại.");
    }
  }, [activeJob, step]);

  useEffect(() => {
    if (rowData?.items.length && selectedRowNumber == null) {
      setSelectedRowNumber(rowData.items[0]!.rowNumber);
    }
  }, [rowData?.items, selectedRowNumber]);

  const handleFile = async (next: File | null) => {
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    setFile(next);
    setBase64(null);
    setPreview(null);
    setJobId(null);
    setSelectedRowNumber(null);
    setError(null);
    setSheetName("");
    setStep(1);
    setMaxReached(1);
    if (!next) return;

    try {
      const workbookBase64 = await fileToBase64(next);
      if (requestId !== previewRequestRef.current) return;
      setBase64(workbookBase64);
      previewUpload.mutate(
        { fileName: next.name, workbookBase64 },
        {
          onSuccess: (result) => {
            if (requestId !== previewRequestRef.current) return;
            setPreview(result);
            setSheetName(result.selectedSheetName);
          },
          onError: (err: { message: string }) =>
            setError(err.message || "Không tạo được preview Excel."),
        },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không đọc được tệp Excel.");
    }
  };

  const runJob = () => {
    if (!file || !base64 || !activeSheet) return;

    setError(null);
    createJob.mutate(
      {
        fileName: file.name,
        workbookBase64: base64,
        sheetName: activeSheet.name,
        headerRowIndex: activeSheet.activeHeaderRowIndex,
        mapping: activeSheet.suggestedMapping,
      },
      {
        onSuccess: (result: unknown) => {
          const created = result as { jobId: string };
          setJobId(created.jobId);
          startJob.mutate(
            { jobId: created.jobId },
            {
              onSuccess: () => {
                toast.success("Đã bắt đầu job nghiên cứu sản phẩm.");
              },
              onError: (err: { message: string }) =>
                setError(err.message || "Không khởi chạy được job."),
            },
          );
        },
        onError: (err: { message: string }) => setError(err.message || "Không tạo được job."),
      },
    );
  };

  const handleApprove = (rowNumber: number) => {
    if (!jobId) return;
    approveRow.mutate(
      { jobId, rowNumber },
      {
        onSuccess: () => {
          void Promise.all([
            listRowsQuery.refetch(),
            rowDetailQuery.refetch(),
          ]).then(() => {
            toast.success("Đã duyệt dòng.");
          });
        },
        onError: (err: { message: string }) => toast.error(err.message || "Không duyệt được dòng."),
      },
    );
  };

  const handleReject = (rowNumber: number) => {
    if (!jobId) return;
    rejectRow.mutate(
      { jobId, rowNumber },
      {
        onSuccess: () => {
          void Promise.all([
            listRowsQuery.refetch(),
            rowDetailQuery.refetch(),
          ]).then(() => {
            toast.success("Đã từ chối dòng.");
          });
        },
        onError: (err: { message: string }) => toast.error(err.message || "Không từ chối được dòng."),
      },
    );
  };

  const runExport = () => {
    if (!jobId) return;
    exportExcel.mutate(
      { jobId },
      {
        onSuccess: (result: unknown) => {
          const exported = result as { fileName: string; workbookBase64: string };
          downloadBase64Xlsx(exported.fileName, exported.workbookBase64);
          toast.success("Đã xuất file Excel.");
          reach(3);
        },
        onError: (err: { message: string }) => toast.error(err.message || "Không xuất được file."),
      },
    );
  };

  const handleExportClick = () => {
    const pendingReview = rowSummary.needsReview;
    if (pendingReview > 0) {
      setConfirmExportOpen(true);
      return;
    }
    runExport();
  };

  return (
    <div className="space-y-4">
      <ResearchEnrichStepHeader
        current={step}
        maxReached={maxReached}
        onJump={setStep}
      />

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      {step === 1 ? (
        <UploadStep
          file={file}
          preview={preview}
          activeSheet={activeSheet}
          isPreviewLoading={previewUpload.isPending}
          isStartingJob={createJob.isPending || startJob.isPending}
          isJobRunning={isJobRunning}
          activeJob={activeJob}
          onFile={handleFile}
          onSheetChange={setSheetName}
          onStartJob={runJob}
        />
      ) : null}

      {step === 2 && rowData ? (
        <ReviewStep
          rows={rowData.items}
          summary={rowSummary}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          selectedRowNumber={selectedRowNumber}
          setSelectedRowNumber={setSelectedRowNumber}
          selectedRow={
            rowData.items.find((r) => r.rowNumber === selectedRowNumber) ?? null
          }
          evidence={rowDetailQuery.data?.evidence ?? []}
          isDetailLoading={rowDetailQuery.isLoading}
          isApproving={approveRow.isPending}
          isRejecting={rejectRow.isPending}
          onApprove={handleApprove}
          onReject={handleReject}
          onContinue={() => reach(3)}
        />
      ) : step === 2 && listRowsQuery.isLoading ? (
        <section className="panel p-8 text-center text-sm text-slate-600">
          <Loader2
            className="mx-auto mb-2 h-5 w-5 animate-spin text-violet-700"
            aria-hidden
          />
          Đang tải kết quả nghiên cứu…
        </section>
      ) : null}

      {step === 3 ? (
        <ExportStep
          summary={rowSummary}
          fileName={file?.name ?? "research.xlsx"}
          isExporting={exportExcel.isPending}
          onExport={handleExportClick}
          onBack={() => setStep(2)}
        />
      ) : null}

      <ConfirmDialog
        open={confirmExportOpen}
        title={`${rowSummary.needsReview} dòng cần duyệt`}
        description="Các dòng chưa duyệt sẽ được xuất theo trạng thái hiện tại. Tiếp tục xuất file?"
        confirmLabel="Xuất file"
        variant="primary"
        onConfirm={() => {
          setConfirmExportOpen(false);
          runExport();
        }}
        onCancel={() => setConfirmExportOpen(false)}
      />
    </div>
  );
}

function UploadStep({
  file,
  preview,
  activeSheet,
  isPreviewLoading,
  isStartingJob,
  isJobRunning,
  activeJob,
  onFile,
  onSheetChange,
  onStartJob,
}: {
  file: File | null;
  preview: ExcelResearchPreview | null;
  activeSheet: ExcelResearchPreviewSheet | undefined;
  isPreviewLoading: boolean;
  isStartingJob: boolean;
  isJobRunning: boolean;
  activeJob: ExcelResearchJobStatusResponse | undefined;
  onFile: (file: File | null) => void;
  onSheetChange: (name: string) => void;
  onStartJob: () => void;
}) {
  const hasNameColumn = Boolean(activeSheet?.suggestedMapping.materialName);
  const progressPct =
    activeJob && activeJob.totalRows > 0
      ? Math.round((activeJob.processedRows / activeJob.totalRows) * 100)
      : 0;

  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-violet-200 bg-violet-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-violet-700 text-white">
            <FileSpreadsheet className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <h3 className="text-sm font-bold text-violet-950">
              Tải lên & chạy nghiên cứu
            </h3>
            <p className="text-xs text-violet-800">
              Upload `.xlsx` sản phẩm; hệ thống dò cột, nghiên cứu và đề xuất điền
              bằng AI.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)] lg:items-start">
        <label
          className={`relative flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-4 text-center transition-colors focus-within:ring-2 focus-within:ring-violet-500 sm:min-h-44 ${
            file
              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
              : "border-violet-300 bg-gradient-to-br from-violet-50 to-white text-violet-900 hover:bg-violet-100"
          }`}
        >
          <input
            type="file"
            accept=".xlsx"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            disabled={isJobRunning}
            onChange={(event) => onFile(event.target.files?.[0] ?? null)}
          />
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white shadow-sm">
            {file ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-700" aria-hidden />
            ) : (
              <Upload className="h-5 w-5 text-violet-700" aria-hidden />
            )}
          </span>
          <span className="text-sm font-bold">Chọn file Excel</span>
          <span className="max-w-full truncate text-xs font-medium text-slate-600">
            {file ? file.name : ".xlsx"}
          </span>
        </label>

        <div className="grid gap-3">
          {preview ? (
            <label className="grid gap-1">
              <span className="text-xs font-bold tracking-[0.12em] text-slate-500 uppercase">
                Sheet
              </span>
              <select
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={activeSheet?.name ?? ""}
                disabled={isJobRunning}
                onChange={(event) => onSheetChange(event.target.value)}
              >
                {preview.sheets.map((sheet) => (
                  <option key={sheet.name} value={sheet.name}>
                    {sheet.name} ({sheet.rowCount.toLocaleString("vi-VN")} dòng)
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-slate-500">
              {isPreviewLoading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Đang đọc file…
                </span>
              ) : (
                "Chọn file để xem sheet và cột nhận diện."
              )}
            </div>
          )}

          {activeSheet ? (
            <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              <p className="font-bold text-slate-800">Cột nhận diện</p>
              <div className="flex flex-wrap gap-1.5">
                {activeSheet.headers.slice(0, 24).map((col) => (
                  <span
                    key={col}
                    className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-slate-600"
                  >
                    {col}
                  </span>
                ))}
              </div>
              {!hasNameColumn ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800">
                  Chưa nhận diện được cột tên sản phẩm — kiểm tra lại file.
                </p>
              ) : null}
            </div>
          ) : null}

          {isJobRunning && activeJob ? (
            <div className="rounded-xl border border-violet-200 bg-violet-50 p-3">
              <div className="flex items-center justify-between text-xs font-semibold text-violet-900">
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  Đang nghiên cứu…
                </span>
                <span className="tabular-nums">
                  {activeJob.processedRows.toLocaleString("vi-VN")}/
                  {activeJob.totalRows.toLocaleString("vi-VN")}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-violet-200">
                <div
                  className="h-full rounded-full bg-violet-600 transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-violet-800">
                <span>
                  Cần duyệt:{" "}
                  {activeJob.needsReviewRows.toLocaleString("vi-VN")}
                </span>
                <span>
                  Lỗi: {activeJob.errorRows.toLocaleString("vi-VN")}
                </span>
              </div>
              {activeJob.message ? (
                <p className="mt-2 text-[11px] text-violet-700">
                  {activeJob.message}
                </p>
              ) : null}
            </div>
          ) : null}

          <Button
            variant="primary"
            leftIcon={<Play className="h-4 w-4" />}
            disabled={
              !file ||
              !hasNameColumn ||
              isPreviewLoading ||
              isJobRunning ||
              isStartingJob
            }
            isLoading={isStartingJob}
            onClick={onStartJob}
          >
            {isJobRunning ? "Đang chạy job…" : "Bắt đầu nghiên cứu"}
          </Button>
        </div>
      </div>
    </section>
  );
}

function ReviewStep({
  rows,
  summary,
  statusFilter,
  setStatusFilter,
  selectedRowNumber,
  setSelectedRowNumber,
  selectedRow,
  evidence,
  isDetailLoading,
  isApproving,
  isRejecting,
  onApprove,
  onReject,
  onContinue,
}: {
  rows: ExcelResearchRowSummary[];
  summary: {
    total: number;
    needsReview: number;
    approved: number;
    matched: number;
    skipped: number;
    errors: number;
  };
  statusFilter: ExcelResearchRowStatus | "all";
  setStatusFilter: (value: ExcelResearchRowStatus | "all") => void;
  selectedRowNumber: number | null;
  setSelectedRowNumber: (value: number | null) => void;
  selectedRow: ExcelResearchRowSummary | null;
  evidence: ExcelResearchRowEvidence[];
  isDetailLoading: boolean;
  isApproving: boolean;
  isRejecting: boolean;
  onApprove: (rowNumber: number) => void;
  onReject: (rowNumber: number) => void;
  onContinue: () => void;
}) {
  if (rows.length === 0) {
    return (
      <section className="panel p-5">
        <EmptyState
          title="Không có dòng kết quả"
          description="Job hoàn tất nhưng chưa có dòng nào để xét duyệt."
        />
      </section>
    );
  }

  const filters: Array<{
    id: ExcelResearchRowStatus | "all";
    label: string;
    count: number;
  }> = [
    { id: "all", label: "Tất cả", count: summary.total },
    { id: "needs_review", label: "Cần duyệt", count: summary.needsReview },
    { id: "matched", label: "Đã khớp", count: summary.matched },
    { id: "approved", label: "Đã duyệt", count: summary.approved },
    { id: "skipped", label: "Bỏ qua", count: summary.skipped },
    { id: "error", label: "Lỗi", count: summary.errors },
  ];

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">
            Xét duyệt kết quả nghiên cứu
          </h3>
          <p className="mt-1 flex flex-wrap gap-3 text-xs text-slate-500">
            <span>{summary.total.toLocaleString("vi-VN")} dòng</span>
            <span>
              {summary.needsReview.toLocaleString("vi-VN")} cần duyệt
            </span>
            <span>
              {summary.approved.toLocaleString("vi-VN")} đã duyệt
            </span>
            <span>{summary.errors.toLocaleString("vi-VN")} lỗi</span>
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          leftIcon={<Download className="h-3.5 w-3.5" />}
          onClick={onContinue}
        >
          Tiếp tục xuất file
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2">
        <div className="flex flex-wrap gap-1.5">
          {filters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => setStatusFilter(filter.id)}
              className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
                statusFilter === filter.id
                  ? "bg-slate-800 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {filter.label} ({filter.count.toLocaleString("vi-VN")})
            </button>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]">
        <div className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto border-b border-slate-200 lg:max-h-[40rem] lg:border-b-0 lg:border-r">
          {rows.map((row) => {
            const meta = ROW_STATUS_META[row.status];
            const isSelected = row.rowNumber === selectedRowNumber;
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => setSelectedRowNumber(row.rowNumber)}
                className={`flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors ${
                  isSelected ? "bg-violet-50" : "hover:bg-slate-50"
                }`}
              >
                <Badge tone={meta.tone}>{meta.label}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {row.productName.trim()
                      ? row.productName
                      : `Dòng ${row.rowNumber}`}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Dòng {row.rowNumber}
                    {row.fillPlan.length > 0
                      ? ` · ${row.fillPlan.length} ô đề xuất`
                      : ""}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        <div className="min-w-0 p-4">
          {selectedRow ? (
            <RowDetailPanel
              row={selectedRow}
              evidence={evidence}
              isDetailLoading={isDetailLoading}
              isApproving={isApproving}
              isRejecting={isRejecting}
              onApprove={() => onApprove(selectedRow.rowNumber)}
              onReject={() => onReject(selectedRow.rowNumber)}
            />
          ) : (
            <EmptyState
              title="Chọn một dòng"
              description="Chọn dòng ở danh sách bên trái để xem bằng chứng và kế hoạch điền."
            />
          )}
        </div>
      </div>
    </section>
  );
}

function RowDetailPanel({
  row,
  evidence,
  isDetailLoading,
  isApproving,
  isRejecting,
  onApprove,
  onReject,
}: {
  row: ExcelResearchRowSummary;
  evidence: ExcelResearchRowEvidence[];
  isDetailLoading: boolean;
  isApproving: boolean;
  isRejecting: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const meta = ROW_STATUS_META[row.status];
  const canDecide =
    row.status === "needs_review" ||
    row.status === "matched" ||
    row.status === "pending";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs font-bold tracking-[0.12em] text-slate-500 uppercase">
              Dòng Excel {row.rowNumber}
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-900">
              {row.productName || "(không có tên)"}
            </p>
          </div>
          <Badge tone={meta.tone}>{meta.label}</Badge>
        </div>
        {row.reviewReason ? (
          <p className="mt-2 text-xs text-amber-800">{row.reviewReason}</p>
        ) : null}
        {row.confidenceScore != null ? (
          <p className="mt-1 text-xs text-slate-500">
            Độ tin cậy: {(row.confidenceScore * 100).toFixed(0)}%
          </p>
        ) : null}
      </div>

      {isDetailLoading ? (
        <p className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Đang tải bằng chứng…
        </p>
      ) : evidence.length > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-bold tracking-[0.12em] text-slate-500 uppercase">
            Bằng chứng nghiên cứu
          </p>
          <ul className="mt-2 space-y-2">
            {evidence.map((item) => (
              <li
                key={item.id}
                className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs"
              >
                <p className="font-semibold text-slate-700">
                  {item.title ?? item.provider ?? item.evidenceType}
                </p>
                {item.snippet ? (
                  <p className="mt-1 text-slate-600">{item.snippet}</p>
                ) : null}
                {item.url ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-violet-700 hover:underline"
                  >
                    Mở nguồn
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {row.fillPlan.length > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-bold tracking-[0.12em] text-slate-500 uppercase">
            Kế hoạch điền
          </p>
          <div className="mt-2 grid gap-1.5">
            {row.fillPlan.map((cell) => {
              const isFillable =
                cell.action === "filled" || cell.action === "overwritten";
              return (
                <div
                  key={cell.field}
                  className={`flex items-center gap-2 rounded-md px-2 py-1 text-xs ${
                    isFillable ? "bg-slate-50" : "opacity-60"
                  }`}
                >
                  <span className="w-24 shrink-0 font-semibold text-slate-600">
                    {fieldLabel(cell.field)}
                  </span>
                  <span className="truncate text-slate-500">
                    {cell.before || "(trống)"}
                  </span>
                  {isFillable ? (
                    <>
                      <span className="text-slate-400">→</span>
                      <span className="truncate font-medium text-emerald-700">
                        {cell.after}
                      </span>
                    </>
                  ) : (
                    <span className="ml-auto text-[11px] text-slate-400">
                      {cell.action === "kept" ? "giữ nguyên" : "bỏ qua"}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
          Chưa có kế hoạch điền cho dòng này.
        </p>
      )}

      {canDecide ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="sm"
            leftIcon={<ThumbsUp className="h-3.5 w-3.5" />}
            isLoading={isApproving}
            disabled={isRejecting}
            onClick={onApprove}
          >
            Duyệt
          </Button>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<ThumbsDown className="h-3.5 w-3.5" />}
            isLoading={isRejecting}
            disabled={isApproving}
            onClick={onReject}
          >
            Từ chối
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ExportStep({
  summary,
  fileName,
  isExporting,
  onExport,
  onBack,
}: {
  summary: {
    total: number;
    approved: number;
    matched: number;
    needsReview: number;
    errors: number;
  };
  fileName: string;
  isExporting: boolean;
  onExport: () => void;
  onBack: () => void;
}) {
  const stats: Array<{ label: string; value: number }> = [
    { label: "Tổng dòng", value: summary.total },
    { label: "Đã duyệt", value: summary.approved },
    { label: "Đã khớp", value: summary.matched },
    { label: "Cần duyệt", value: summary.needsReview },
    { label: "Lỗi", value: summary.errors },
  ];

  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
        <h3 className="text-sm font-bold text-slate-900">Xuất file Excel</h3>
        <p className="mt-1 text-xs text-slate-500">
          Tải file đã nghiên cứu và điền theo các quyết định duyệt.
        </p>
      </div>

      <div className="space-y-4 p-4">
        <p className="text-sm text-slate-600">
          File gốc:{" "}
          <span className="font-semibold text-slate-900">{fileName}</span>
        </p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-slate-200 bg-white p-3"
            >
              <p className="text-xs font-medium text-slate-500">{stat.label}</p>
              <p className="mt-1 text-xl font-bold text-slate-900 tabular-nums">
                {stat.value.toLocaleString("vi-VN")}
              </p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            leftIcon={<Download className="h-4 w-4" />}
            isLoading={isExporting}
            onClick={onExport}
          >
            Xuất file đã nghiên cứu (.xlsx)
          </Button>
          <Button variant="ghost" onClick={onBack}>
            Quay lại xét duyệt
          </Button>
        </div>
      </div>
    </section>
  );
}
