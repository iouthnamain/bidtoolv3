"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { Loader2, Pause, Play, RotateCcw, XCircle } from "lucide-react";

import { Badge, Button, ConfirmDialog } from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import {
  ExcelResearchReviewPanel,
  type ResearchApproveDecision,
} from "~/app/_components/enrich/excel-research-review-panel";
import {
  type ExcelResearchJobStatus,
  type ExcelResearchRowStatus,
  isExcelResearchJobActive,
  isExcelResearchJobBusy,
  isExcelResearchJobReviewReady,
} from "~/app/_components/research-enrich/excel-research-types";
import { api, type RouterOutputs } from "~/trpc/react";

const JOB_POLL_MS = 2_000;

type ExcelResearchRowSummary =
  RouterOutputs["excelResearch"]["listRowResults"]["items"][number];

const JOB_STATUS_LABEL: Record<ExcelResearchJobStatus, string> = {
  draft: "Nháp",
  queued: "Đang xếp hàng",
  running: "Đang chạy",
  paused: "Tạm dừng",
  awaiting_review: "Chờ duyệt",
  exporting: "Đang xuất",
  completed: "Hoàn tất",
  failed: "Lỗi",
  cancelled: "Đã hủy",
};

const JOB_STATUS_TONE: Record<
  ExcelResearchJobStatus,
  Parameters<typeof Badge>[0]["tone"]
> = {
  draft: "neutral",
  queued: "neutral",
  running: "info",
  paused: "warning",
  awaiting_review: "warning",
  exporting: "info",
  completed: "success",
  failed: "critical",
  cancelled: "warning",
};

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

function shortJobId(jobId: string) {
  return jobId.slice(0, 8);
}

function formatDateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("vi-VN") : "-";
}

export function ExcelResearchJobDetail({ jobId }: { jobId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [statusFilter, setStatusFilter] = useState<ExcelResearchRowStatus | "all">(
    "all",
  );
  const [selectedRowNumber, setSelectedRowNumber] = useState<number | null>(null);
  const [confirmExportOpen, setConfirmExportOpen] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  const jobQuery = api.excelResearch.getJob.useQuery(
    { jobId },
    { refetchOnWindowFocus: false, retry: false },
  );

  const jobStatusQuery = api.excelResearch.getJobStatus.useQuery(
    { jobId },
    {
      refetchInterval: (query) =>
        isExcelResearchJobBusy(query.state.data) ? JOB_POLL_MS : false,
      refetchOnWindowFocus: false,
      retry: false,
    },
  );

  const startJob = api.excelResearch.startJob.useMutation();
  const restartJob = api.excelResearch.restartJob.useMutation();
  const pauseJob = api.excelResearch.pauseJob.useMutation();
  const cancelJob = api.excelResearch.cancelJob.useMutation();
  const approveRow = api.excelResearch.approveRow.useMutation();
  const rejectRow = api.excelResearch.rejectRow.useMutation();
  const bulkApproveRows = api.excelResearch.bulkApproveRows.useMutation();
  const exportExcel = api.excelResearch.exportExcel.useMutation();

  const activeJob = jobStatusQuery.data;
  const isJobRunning = isExcelResearchJobActive(activeJob);
  const isJobBusy = isExcelResearchJobBusy(activeJob);
  const reviewReady = isExcelResearchJobReviewReady(activeJob);

  // Refetch job + status so a freshly-started/paused/cancelled job updates the
  // badge and (re)arms the polling interval without waiting for a manual reload.
  const refreshJob = () => {
    void jobStatusQuery.refetch();
    void jobQuery.refetch();
  };

  const listRowsQuery = api.excelResearch.listRowResults.useQuery(
    {
      jobId,
      status: statusFilter === "all" ? undefined : statusFilter,
      limit: 200,
    },
    {
      enabled: reviewReady,
      placeholderData: keepPreviousData,
      refetchOnWindowFocus: false,
    },
  );

  const rowDetailQuery = api.excelResearch.getRowResult.useQuery(
    {
      jobId,
      rowNumber: selectedRowNumber ?? 1,
    },
    {
      enabled: selectedRowNumber != null && reviewReady,
      refetchOnWindowFocus: false,
    },
  );

  const rowData = listRowsQuery.data;

  // Filter-chip counts must come from the server's unfiltered per-status counts,
  // not from rowData.items (which is filtered by statusFilter and capped at the
  // page limit). Each chip count equals the rows shown when that chip is
  // selected, so "matched" is the matched status only (approved is its own chip).
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
    if (rowData?.items.length && selectedRowNumber == null) {
      setSelectedRowNumber(rowData.items[0]!.rowNumber);
    }
  }, [rowData?.items, selectedRowNumber]);

  // When the active selection is no longer present in the current (filtered or
  // refetched) list — e.g. after a decision moved the row out of the filter, or
  // the filter changed — drop it so the auto-select effect re-picks the first.
  useEffect(() => {
    if (
      selectedRowNumber != null &&
      rowData?.items &&
      !rowData.items.some((r) => r.rowNumber === selectedRowNumber)
    ) {
      setSelectedRowNumber(null);
    }
  }, [rowData?.items, selectedRowNumber]);

  // Advance selection to the next row after a decision, using the items
  // RESOLVED by the post-decision refetch (not a stale closure). If the decided
  // row is gone, advance to the row that shifted into its slot (same index);
  // fall back to the first row, or null when the list is empty so the
  // auto-select effect re-picks.
  const advanceSelectionAfterDecision = (
    decidedRowNumber: number,
    items: ExcelResearchRowSummary[],
  ) => {
    if (items.length === 0) {
      setSelectedRowNumber(null);
      return;
    }
    const idx = items.findIndex((r) => r.rowNumber === decidedRowNumber);
    // Row still present: move to the next one. Row removed: the row at the same
    // index now holds what shifted up; use it, else the last/first row.
    const next =
      idx >= 0 ? (items[idx + 1] ?? items[idx]) : (items[0] ?? null);
    setSelectedRowNumber(next ? next.rowNumber : null);
  };

  const runExport = () => {
    exportExcel.mutate(
      { jobId },
      {
        onSuccess: (result) => {
          downloadBase64Xlsx(result.fileName, result.workbookBase64);
          toast.success("Đã xuất file nghiên cứu web.");
          // The server may flip the job to "exporting"/"completed"; refetch so
          // the badge updates and busy-polling (re)arms if needed.
          refreshJob();
        },
        onError: (err) =>
          toast.error(err.message || "Không xuất được file nghiên cứu."),
      },
    );
  };

  const handleExportClick = () => {
    const needsReview = activeJob?.needsReviewRows ?? 0;
    if (needsReview > 0) {
      setConfirmExportOpen(true);
      return;
    }
    runExport();
  };

  const handleStart = () => {
    startJob.mutate(
      { jobId },
      {
        onSuccess: () => {
          toast.success("Đã khởi chạy job.");
          // Without this the status query has no fresh "running" data, so the
          // refetchInterval predicate never turns polling on and the UI looks
          // frozen until a manual reload. Refetch to seed the active state.
          refreshJob();
        },
        onError: (err) =>
          toast.error(err.message || "Không khởi chạy được job."),
      },
    );
  };

  const handleRetry = () => {
    restartJob.mutate(
      { jobId },
      {
        onSuccess: () => {
          toast.success("Đã chạy lại job.");
          refreshJob();
        },
        onError: (err) => toast.error(err.message || "Không chạy lại được job."),
      },
    );
  };

  const handlePause = () => {
    pauseJob.mutate(
      { jobId },
      {
        onSuccess: () => {
          toast.success("Đã tạm dừng job.");
          refreshJob();
        },
        onError: (err) => toast.error(err.message || "Không tạm dừng được job."),
      },
    );
  };

  const handleCancel = () => {
    cancelJob.mutate(
      { jobId },
      {
        onSuccess: () => {
          toast.success("Đã hủy job.");
          refreshJob();
        },
        onError: (err) => toast.error(err.message || "Không hủy được job."),
      },
    );
  };

  const handleApprove = (
    rowNumber: number,
    decision: ResearchApproveDecision,
  ) => {
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
          void (async () => {
            const [{ data }] = await Promise.all([
              listRowsQuery.refetch(),
              jobStatusQuery.refetch(),
            ]);
            advanceSelectionAfterDecision(rowNumber, data?.items ?? []);
            toast.success("Đã duyệt dòng.");
          })();
        },
        onError: (err) => toast.error(err.message || "Không duyệt được dòng."),
      },
    );
  };

  const handleReject = (rowNumber: number) => {
    rejectRow.mutate(
      { jobId, rowNumber },
      {
        onSuccess: () => {
          void (async () => {
            const [{ data }] = await Promise.all([
              listRowsQuery.refetch(),
              jobStatusQuery.refetch(),
            ]);
            advanceSelectionAfterDecision(rowNumber, data?.items ?? []);
            toast.success("Đã từ chối dòng.");
          })();
        },
        onError: (err) => toast.error(err.message || "Không từ chối được dòng."),
      },
    );
  };

  const handleBulkApprove = (args: {
    rowIds?: string[];
    minConfidence?: number;
  }) => {
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

  if (jobQuery.isLoading) {
    return (
      <section className="panel p-8 text-center text-sm text-slate-600">
        <Loader2
          className="mx-auto mb-2 h-5 w-5 animate-spin text-violet-700"
          aria-hidden
        />
        Đang tải job…
      </section>
    );
  }

  if (jobQuery.isError || !jobQuery.data) {
    return (
      <section className="panel p-5 text-sm text-rose-800">
        Không tìm thấy job nghiên cứu.
      </section>
    );
  }

  const job = jobQuery.data;
  const status = activeJob?.status ?? job.status;

  if (!reviewReady) {
    const progressPct =
      activeJob && activeJob.totalRows > 0
        ? Math.round((activeJob.processedRows / activeJob.totalRows) * 100)
        : 0;
    const canStart = ["draft", "paused", "queued"].includes(status);
    const canRetry = status === "failed" || status === "cancelled";
    const startLabel = canRetry
      ? "Chạy lại job"
      : status === "paused"
        ? "Tiếp tục chạy job"
        : "Bắt đầu chạy job";

    return (
      <>
        <section className="panel overflow-hidden">
          <div className="border-b border-violet-200 bg-violet-50 px-4 py-3">
            <h3 className="text-sm font-bold text-violet-950 text-balance">
              Job {shortJobId(jobId)}
            </h3>
            <p className="mt-1 text-xs text-violet-800 truncate">{job.sourceFileName}</p>
          </div>
          <div className="space-y-4 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={JOB_STATUS_TONE[status]}>
                {JOB_STATUS_LABEL[status]}
              </Badge>
              <span className="text-xs text-slate-500">
                Sheet {job.sheetName} · cập nhật {formatDateTime(job.updatedAt)}
              </span>
            </div>

            {isJobBusy && activeJob ? (
              <div className="rounded-xl border border-violet-200 bg-violet-50 p-3">
                <div className="flex items-center justify-between text-xs font-semibold text-violet-900">
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    {status === "exporting" ? "Đang xuất file…" : "Đang nghiên cứu…"}
                  </span>
                  <span className="tabular-nums">
                    {activeJob.processedRows.toLocaleString("vi-VN")}/
                    {activeJob.totalRows.toLocaleString("vi-VN")}
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-violet-200">
                  <div
                    role="progressbar"
                    aria-valuenow={progressPct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuetext={`${activeJob.processedRows}/${activeJob.totalRows}`}
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

            {canRetry ? (
              <p className="text-sm text-rose-800">
                {activeJob?.error ?? activeJob?.message ?? job.error ?? "Job thất bại."}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {canStart || canRetry ? (
                <Button
                  variant="primary"
                  leftIcon={
                    canRetry ? (
                      <RotateCcw className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )
                  }
                  isLoading={canRetry ? restartJob.isPending : startJob.isPending}
                  onClick={canRetry ? handleRetry : handleStart}
                >
                  {startLabel}
                </Button>
              ) : null}
              {isJobRunning ? (
                <>
                  <Button
                    variant="secondary"
                    leftIcon={<Pause className="h-4 w-4" />}
                    isLoading={pauseJob.isPending}
                    onClick={handlePause}
                  >
                    Tạm dừng
                  </Button>
                  <Button
                    variant="ghost"
                    leftIcon={<XCircle className="h-4 w-4" />}
                    isLoading={cancelJob.isPending}
                    onClick={() => setConfirmCancelOpen(true)}
                  >
                    Hủy job
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        </section>

        <ConfirmDialog
          open={confirmExportOpen}
          title={`${activeJob?.needsReviewRows ?? 0} dòng cần duyệt`}
          description="Các dòng chưa duyệt sẽ được xuất theo trạng thái hiện tại. Tiếp tục?"
          confirmLabel="Xuất file"
          variant="primary"
          onConfirm={() => {
            setConfirmExportOpen(false);
            runExport();
          }}
          onCancel={() => setConfirmExportOpen(false)}
        />

        <ConfirmDialog
          open={confirmCancelOpen}
          title="Hủy job nghiên cứu?"
          description="Job đang chạy sẽ dừng lại và không thể tiếp tục từ vị trí hiện tại."
          confirmLabel="Hủy job"
          variant="danger"
          onConfirm={() => {
            setConfirmCancelOpen(false);
            handleCancel();
          }}
          onCancel={() => setConfirmCancelOpen(false)}
        />
      </>
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
    <>
      <section className="panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-slate-500">
              Job {shortJobId(jobId)}
            </p>
            <h2 className="mt-0.5 text-base font-bold text-slate-950 text-balance">
              {job.sourceFileName}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Sheet {job.sheetName} · <span className="tabular-nums">{job.totalRows.toLocaleString("vi-VN")}</span> dòng
            </p>
          </div>
          <Badge tone={JOB_STATUS_TONE[status]}>
            {JOB_STATUS_LABEL[status]}
          </Badge>
        </div>
      </section>

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
        onPrimaryAction={handleExportClick}
        onSecondaryAction={() => router.push("/enrich/jobs")}
        primaryActionLabel="Xuất file (.xlsx)"
        secondaryActionLabel="Quay lại danh sách"
        emptyContinueLabel="Xuất file (.xlsx)"
      />

      <ConfirmDialog
        open={confirmExportOpen}
        title={`${activeJob?.needsReviewRows ?? 0} dòng cần duyệt`}
        description="Các dòng chưa duyệt sẽ được xuất theo trạng thái hiện tại. Tiếp tục?"
        confirmLabel="Xuất file"
        variant="primary"
        onConfirm={() => {
          setConfirmExportOpen(false);
          runExport();
        }}
        onCancel={() => setConfirmExportOpen(false)}
      />
    </>
  );
}
