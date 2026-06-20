"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Play,
} from "lucide-react";

import {
  Button,
} from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import { ExcelResearchReviewPanel } from "~/app/_components/enrich/excel-research-review-panel";
import {
  type ExcelResearchRowStatus,
  isExcelResearchJobActive,
  isExcelResearchJobReviewReady,
} from "~/app/_components/research-enrich/excel-research-types";
import { api } from "~/trpc/react";

const JOB_POLL_MS = 2_000;
const EMPTY_JOB_ID = "00000000-0000-0000-0000-000000000000";

export function EnrichResearchStep({
  fileName,
  workbookBase64,
  sheetName,
  headerRowIndex,
  mapping,
  unmatchedCount,
  jobId,
  onJobIdChange,
  onContinue,
  onSkip,
  onError,
}: {
  fileName: string;
  workbookBase64: string;
  sheetName: string;
  headerRowIndex: number;
  mapping: Record<string, string | null>;
  unmatchedCount: number;
  jobId: string | null;
  onJobIdChange: (jobId: string | null) => void;
  onContinue: () => void;
  onSkip: () => void;
  onError: (message: string | null) => void;
}) {
  const toast = useToast();
  const [statusFilter, setStatusFilter] = useState<ExcelResearchRowStatus | "all">(
    "all",
  );
  const [selectedRowNumber, setSelectedRowNumber] = useState<number | null>(null);

  const createJob = api.excelResearch.createJob.useMutation();
  const startJob = api.excelResearch.startJob.useMutation();
  const approveRow = api.excelResearch.approveRow.useMutation();
  const rejectRow = api.excelResearch.rejectRow.useMutation();
  const bulkApproveRows = api.excelResearch.bulkApproveRows.useMutation();

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

  const activeJob = jobStatusQuery.data;
  const isJobRunning = isExcelResearchJobActive(activeJob);
  const reviewReady = isExcelResearchJobReviewReady(activeJob);

  const listRowsQuery = api.excelResearch.listRowResults.useQuery(
    {
      jobId: jobId ?? EMPTY_JOB_ID,
      status: statusFilter === "all" ? undefined : statusFilter,
      limit: 200,
    },
    {
      enabled: jobId !== null && reviewReady,
      refetchOnWindowFocus: false,
    },
  );

  const rowDetailQuery = api.excelResearch.getRowResult.useQuery(
    {
      jobId: jobId ?? EMPTY_JOB_ID,
      rowNumber: selectedRowNumber ?? 1,
    },
    {
      enabled: jobId !== null && selectedRowNumber != null && reviewReady,
      refetchOnWindowFocus: false,
    },
  );

  const rowData = listRowsQuery.data;

  // Filter-chip counts come from the server's unfiltered per-status counts, not
  // from rowData.items (filtered by statusFilter and capped at the page limit).
  // Each chip count equals the rows shown when that chip is selected.
  const rowSummary = useMemo(() => {
    const counts = rowData?.statusCounts;
    return {
      total: rowData?.totalRows ?? rowData?.total ?? activeJob?.totalRows ?? 0,
      needsReview: counts?.needs_review ?? activeJob?.needsReviewRows ?? 0,
      errors: counts?.error ?? activeJob?.errorRows ?? 0,
      matched: counts?.matched ?? 0,
      approved: counts?.approved ?? 0,
      skipped: counts?.skipped ?? 0,
    };
  }, [rowData, activeJob]);

  useEffect(() => {
    if (!activeJob) return;
    if (activeJob.status === "failed" || activeJob.status === "cancelled") {
      onError(activeJob.error ?? activeJob.message ?? "Job nghiên cứu thất bại.");
    }
  }, [activeJob, onError]);

  useEffect(() => {
    if (rowData?.items.length && selectedRowNumber == null) {
      setSelectedRowNumber(rowData.items[0]!.rowNumber);
    }
  }, [rowData?.items, selectedRowNumber]);

  const runJob = () => {
    onError(null);
    createJob.mutate(
      {
        fileName,
        workbookBase64,
        sheetName,
        headerRowIndex,
        mapping,
      },
      {
        onSuccess: (result) => {
          onJobIdChange(result.jobId);
          startJob.mutate(
            { jobId: result.jobId },
            {
              onSuccess: () => {
                toast.success("Đã bắt đầu nghiên cứu sản phẩm trên web.");
              },
              onError: (err) =>
                onError(err.message || "Không khởi chạy được job."),
            },
          );
        },
        onError: (err) => onError(err.message || "Không tạo được job."),
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
          ]).then(() => toast.success("Đã duyệt dòng."));
        },
        onError: (err) => toast.error(err.message || "Không duyệt được dòng."),
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
          ]).then(() => toast.success("Đã từ chối dòng."));
        },
        onError: (err) => toast.error(err.message || "Không từ chối được dòng."),
      },
    );
  };

  const handleBulkApprove = (args: {
    rowIds?: string[];
    minConfidence?: number;
  }) => {
    if (!jobId) return;
    bulkApproveRows.mutate(
      { jobId, rowIds: args.rowIds, minConfidence: args.minConfidence },
      {
        onSuccess: (result) => {
          void Promise.all([
            listRowsQuery.refetch(),
            rowDetailQuery.refetch(),
            jobStatusQuery.refetch(),
          ]).then(() =>
            toast.success(
              `Đã duyệt ${result.approved.toLocaleString("vi-VN")} dòng.` +
                (result.failed > 0
                  ? ` (${result.failed.toLocaleString("vi-VN")} lỗi)`
                  : ""),
            ),
          );
        },
        onError: (err) =>
          toast.error(err.message || "Không duyệt hàng loạt được."),
      },
    );
  };

  if (!jobId || !reviewReady) {
    const progressPct =
      activeJob && activeJob.totalRows > 0
        ? Math.round((activeJob.processedRows / activeJob.totalRows) * 100)
        : 0;

    return (
      <section className="panel overflow-hidden">
        <div className="border-b border-violet-200 bg-violet-50 px-4 py-3">
          <h3 className="text-sm font-bold text-violet-950 text-balance">
            Nghiên cứu sản phẩm trên web
          </h3>
          <p className="mt-1 text-xs text-violet-800">
            Tìm thông tin và catalog trên internet (SearXNG) cho các dòng trong
            file. Bước này tùy chọn — có thể bỏ qua nếu đã đối chiếu catalog đủ.
          </p>
        </div>
        <div className="space-y-4 p-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <p>
              File: <span className="font-semibold">{fileName}</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Sheet: {sheetName} ·{" "}
              {unmatchedCount > 0
                ? `${unmatchedCount.toLocaleString("vi-VN")} dòng chưa khớp catalog`
                : "Tất cả dòng đã qua đối chiếu catalog"}
            </p>
          </div>

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
              {activeJob.message ? (
                <p className="mt-2 text-[11px] text-violet-700">
                  {activeJob.message}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              leftIcon={<Play className="h-4 w-4" />}
              disabled={isJobRunning}
              isLoading={createJob.isPending || startJob.isPending}
              onClick={runJob}
            >
              {isJobRunning ? "Đang chạy…" : "Bắt đầu nghiên cứu web"}
            </Button>
            <Button variant="secondary" disabled={isJobRunning} onClick={onSkip}>
              Bỏ qua → xuất file
            </Button>
          </div>
        </div>
      </section>
    );
  }

  if (listRowsQuery.isLoading || !rowData) {
    return (
      <section className="panel p-8 text-center text-sm text-slate-600">
        <Loader2
          className="mx-auto mb-2 h-5 w-5 animate-spin text-violet-700"
          aria-hidden
        />
        Đang tải kết quả nghiên cứu…
      </section>
    );
  }

  return (
    <ExcelResearchReviewPanel
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
      onBulkApprove={handleBulkApprove}
      isBulkApproving={bulkApproveRows.isPending}
      onPrimaryAction={onContinue}
      onSecondaryAction={onSkip}
    />
  );
}
