"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Play } from "lucide-react";

import { Button } from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import {
  ExcelResearchReviewPanel,
  type ResearchApproveDecision,
} from "~/app/_components/enrich/excel-research-review-panel";
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
  unresolvedRowNumbers,
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
  unresolvedRowNumbers: number[];
  jobId: string | null;
  onJobIdChange: (jobId: string | null) => void;
  onContinue: () => void;
  onSkip: () => void;
  onError: (message: string | null) => void;
}) {
  const toast = useToast();
  const [statusFilter, setStatusFilter] = useState<
    ExcelResearchRowStatus | "all"
  >("all");
  const [selectedRowNumber, setSelectedRowNumber] = useState<number | null>(
    null,
  );
  const [scope, setScope] = useState<"unresolved" | "all">(
    unresolvedRowNumbers.length > 0 ? "unresolved" : "all",
  );

  const createJob = api.excelResearch.createJob.useMutation();
  const startJob = api.excelResearch.startJob.useMutation();
  const approveRow = api.excelResearch.approveRow.useMutation();
  const rejectRow = api.excelResearch.rejectRow.useMutation();
  const bulkApproveRows = api.excelResearch.bulkApproveRows.useMutation();

  const jobStatusQuery = api.excelResearch.getJobStatus.useQuery(
    { jobId: jobId ?? EMPTY_JOB_ID },
    {
      enabled: jobId !== null,
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        if (!status) return JOB_POLL_MS;
        // Poll while the job is active OR still in the transient "draft" state
        // (just created, scheduler hasn't picked it up yet). Stop once it
        // reaches a review-ready/terminal state. Without polling on "draft" the
        // indicator can stick if the status is read before startJob lands.
        const stillWorking =
          status === "draft" || isExcelResearchJobActive({ status });
        return stillWorking ? JOB_POLL_MS : false;
      },
      refetchOnWindowFocus: false,
      retry: false,
    },
  );

  const activeJob = jobStatusQuery.data;
  const isJobRunning = isExcelResearchJobActive(activeJob);
  const reviewReady = isExcelResearchJobReviewReady(activeJob);

  // True from the moment the user clicks until the job is actually processing:
  // the create/start mutations are in flight, OR the job exists but is still in
  // the transient "draft" state waiting for the scheduler to pick it up. Drives
  // the spinner/disabled state so the UI never looks idle after a click.
  const isJobStarting =
    createJob.isPending ||
    startJob.isPending ||
    (jobId !== null && !reviewReady && activeJob?.status === "draft");
  const isWorking = isJobRunning || isJobStarting;

  const listRowsQuery = api.excelResearch.listRowResults.useQuery(
    {
      jobId: jobId ?? EMPTY_JOB_ID,
      status: statusFilter === "all" ? undefined : statusFilter,
      limit: 200,
    },
    {
      enabled: jobId !== null,
      refetchInterval: () => (isWorking ? JOB_POLL_MS : false),
      refetchOnWindowFocus: false,
    },
  );

  const rowDetailQuery = api.excelResearch.getRowResult.useQuery(
    {
      jobId: jobId ?? EMPTY_JOB_ID,
      rowNumber: selectedRowNumber ?? 1,
    },
    {
      enabled: jobId !== null && selectedRowNumber != null,
      refetchInterval: () => (isWorking ? JOB_POLL_MS : false),
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
      onError(
        activeJob.error ?? activeJob.message ?? "Job nghiên cứu thất bại.",
      );
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
        rowNumbers: scope === "unresolved" ? unresolvedRowNumbers : undefined,
      },
      {
        onSuccess: (result) => {
          onJobIdChange(result.jobId);
          startJob.mutate(
            { jobId: result.jobId },
            {
              onSuccess: () => {
                toast.success("Đã bắt đầu nghiên cứu sản phẩm trên web.");
                // Re-arm the status poll: the status query may have already
                // fetched the job while it was still "draft" (before startJob
                // flipped it to "running"), which disables refetchInterval. A
                // refetch picks up the now-running status and restarts polling,
                // so the progress indicator actually appears.
                void jobStatusQuery.refetch();
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

  const handleApprove = (
    rowNumber: number,
    decision: ResearchApproveDecision,
  ) => {
    if (!jobId) return;
    approveRow.mutate(
      {
        jobId,
        rowNumber,
        materialId: decision.materialId,
        acceptedFields: decision.acceptedFields,
        overwriteFields: decision.overwriteFields,
        editedValues: decision.editedValues,
      },
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
        onError: (err) =>
          toast.error(err.message || "Không từ chối được dòng."),
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

  if (!jobId || (!reviewReady && !rowData?.items.length)) {
    const progressPct =
      activeJob && activeJob.totalRows > 0
        ? Math.round((activeJob.processedRows / activeJob.totalRows) * 100)
        : 0;

    return (
      <section className="panel overflow-hidden">
        <div className="border-b border-violet-200 bg-violet-50 px-4 py-3">
          <h3 className="text-sm font-bold text-balance text-violet-950">
            Nghiên cứu sản phẩm trên web
          </h3>
          <p className="mt-1 text-xs text-violet-800">
            Tìm thông tin và catalog trên internet (SearXNG) cho các dòng trong
            file. Bước này tùy chọn — có thể bỏ qua nếu đã đối chiếu catalog đủ.
          </p>
        </div>
        <div className="space-y-4 p-4">
          <div className="rounded border border-slate-400 bg-slate-50 p-3 text-sm text-slate-700">
            <p>
              File: <span className="font-semibold">{fileName}</span>
            </p>
            <p className="mt-1 text-xs text-slate-700">
              Sheet: {sheetName} ·{" "}
              {unmatchedCount > 0
                ? `${unmatchedCount.toLocaleString("vi-VN")} dòng chưa khớp catalog`
                : "Tất cả dòng đã qua đối chiếu catalog"}
            </p>
          </div>

          <fieldset className="rounded border border-slate-400 bg-white p-3 text-sm text-slate-700">
            <legend className="px-1 text-xs font-bold tracking-[0.12em] text-slate-700 uppercase">
              Phạm vi nghiên cứu
            </legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="flex cursor-pointer items-start gap-2 rounded border border-slate-400 px-3 py-2 hover:bg-slate-50">
                <input
                  type="radio"
                  name="excel-research-scope"
                  value="unresolved"
                  checked={scope === "unresolved"}
                  disabled={unresolvedRowNumbers.length === 0 || isWorking}
                  onChange={() => setScope("unresolved")}
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-semibold">
                    Chỉ dòng chưa xử lý
                  </span>
                  <span className="text-xs text-slate-700">
                    {unresolvedRowNumbers.length.toLocaleString("vi-VN")} dòng
                    cần web
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded border border-slate-400 px-3 py-2 hover:bg-slate-50">
                <input
                  type="radio"
                  name="excel-research-scope"
                  value="all"
                  checked={scope === "all"}
                  disabled={isWorking}
                  onChange={() => setScope("all")}
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-semibold">
                    Tất cả dòng có tên
                  </span>
                  <span className="text-xs text-slate-700">
                    Dùng khi muốn xác minh web toàn bộ file.
                  </span>
                </span>
              </label>
            </div>
          </fieldset>

          {isWorking ? (
            <div className="rounded border border-violet-200 bg-violet-50 p-3">
              <div className="flex items-center justify-between text-xs font-semibold text-violet-900">
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  {isJobRunning ? "Đang nghiên cứu…" : "Đang khởi tạo job…"}
                </span>
                {isJobRunning && activeJob ? (
                  <span className="tabular-nums">
                    {activeJob.processedRows.toLocaleString("vi-VN")}/
                    {activeJob.totalRows.toLocaleString("vi-VN")}
                  </span>
                ) : null}
              </div>
              <div
                className="mt-2 h-2 overflow-hidden rounded-full bg-violet-200"
                role="progressbar"
                aria-label="Tiến độ nghiên cứu web"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={isJobRunning ? progressPct : undefined}
              >
                <div
                  className={`h-full rounded-full bg-violet-600 transition-all ${
                    isJobRunning ? "" : "animate-pulse"
                  }`}
                  style={{ width: isJobRunning ? `${progressPct}%` : "100%" }}
                />
              </div>
              {isJobRunning && activeJob?.message ? (
                <p className="mt-2 text-xs text-violet-700">
                  {activeJob.message}
                </p>
              ) : !isJobRunning ? (
                <p className="mt-2 text-xs text-violet-700">
                  Đang chuẩn bị — quá trình nghiên cứu sẽ bắt đầu trong giây
                  lát.
                </p>
              ) : null}
              {jobId ? (
                <Link
                  href={`/enrich/jobs/${jobId}`}
                  className="mt-2 inline-block text-xs font-semibold text-violet-800 underline-offset-2 hover:underline"
                >
                  Mở trang job nghiên cứu
                </Link>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              leftIcon={<Play className="h-4 w-4" />}
              disabled={isWorking}
              isLoading={isJobStarting}
              onClick={runJob}
            >
              {isWorking ? "Đang chạy…" : "Bắt đầu nghiên cứu web"}
            </Button>
            <Button variant="secondary" disabled={isWorking} onClick={onSkip}>
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
      compare={rowDetailQuery.data?.compare ?? null}
      isDetailLoading={rowDetailQuery.isLoading}
      isApproving={approveRow.isPending}
      isRejecting={rejectRow.isPending}
      onApprove={handleApprove}
      onReject={handleReject}
      onBulkApprove={handleBulkApprove}
      isBulkApproving={bulkApproveRows.isPending}
      listTotal={rowData.total}
      onPrimaryAction={onContinue}
      onSecondaryAction={onSkip}
    />
  );
}
