"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Play } from "lucide-react";

import { Badge, Button, ConfirmDialog } from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import { ExcelResearchReviewPanel } from "~/app/_components/enrich/excel-research-review-panel";
import {
  type ExcelResearchJobStatus,
  type ExcelResearchRowStatus,
  isExcelResearchJobActive,
  isExcelResearchJobReviewReady,
} from "~/app/_components/research-enrich/excel-research-types";
import { api } from "~/trpc/react";

const JOB_POLL_MS = 2_000;

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

  const jobQuery = api.excelResearch.getJob.useQuery(
    { jobId },
    { refetchOnWindowFocus: false, retry: false },
  );

  const jobStatusQuery = api.excelResearch.getJobStatus.useQuery(
    { jobId },
    {
      refetchInterval: (query) =>
        isExcelResearchJobActive(query.state.data) ? JOB_POLL_MS : false,
      refetchOnWindowFocus: false,
      retry: false,
    },
  );

  const startJob = api.excelResearch.startJob.useMutation();
  const approveRow = api.excelResearch.approveRow.useMutation();
  const rejectRow = api.excelResearch.rejectRow.useMutation();
  const exportExcel = api.excelResearch.exportExcel.useMutation();

  const activeJob = jobStatusQuery.data;
  const isJobRunning = isExcelResearchJobActive(activeJob);
  const reviewReady = isExcelResearchJobReviewReady(activeJob);

  const listRowsQuery = api.excelResearch.listRowResults.useQuery(
    {
      jobId,
      status: statusFilter === "all" ? undefined : statusFilter,
      limit: 200,
    },
    {
      enabled: reviewReady,
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
      approved: counts.approved,
      skipped: counts.skipped,
    };
  }, [rowData, activeJob]);

  useEffect(() => {
    if (rowData?.items.length && selectedRowNumber == null) {
      setSelectedRowNumber(rowData.items[0]!.rowNumber);
    }
  }, [rowData?.items, selectedRowNumber]);

  const runExport = () => {
    exportExcel.mutate(
      { jobId },
      {
        onSuccess: (result) => {
          downloadBase64Xlsx(result.fileName, result.workbookBase64);
          toast.success("Đã xuất file nghiên cứu web.");
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

  const handleApprove = (rowNumber: number) => {
    approveRow.mutate(
      { jobId, rowNumber },
      {
        onSuccess: () => {
          void Promise.all([
            listRowsQuery.refetch(),
            rowDetailQuery.refetch(),
            jobStatusQuery.refetch(),
          ]).then(() => toast.success("Đã duyệt dòng."));
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
          void Promise.all([
            listRowsQuery.refetch(),
            rowDetailQuery.refetch(),
            jobStatusQuery.refetch(),
          ]).then(() => toast.success("Đã từ chối dòng."));
        },
        onError: (err) => toast.error(err.message || "Không từ chối được dòng."),
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

    return (
      <>
        <section className="panel overflow-hidden">
          <div className="border-b border-violet-200 bg-violet-50 px-4 py-3">
            <h3 className="text-sm font-bold text-violet-950">
              Job {shortJobId(jobId)}
            </h3>
            <p className="mt-1 text-xs text-violet-800">{job.sourceFileName}</p>
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

            {status === "failed" || status === "cancelled" ? (
              <p className="text-sm text-rose-800">
                {activeJob?.error ?? activeJob?.message ?? job.error ?? "Job thất bại."}
              </p>
            ) : null}

            {canStart ? (
              <Button
                variant="primary"
                leftIcon={<Play className="h-4 w-4" />}
                isLoading={startJob.isPending}
                onClick={() =>
                  startJob.mutate(
                    { jobId },
                    {
                      onSuccess: () => toast.success("Đã khởi chạy job."),
                      onError: (err) =>
                        toast.error(err.message || "Không khởi chạy được job."),
                    },
                  )
                }
              >
                Tiếp tục chạy job
              </Button>
            ) : null}
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
            <h2 className="mt-0.5 text-base font-bold text-slate-950">
              {job.sourceFileName}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Sheet {job.sheetName} · {job.totalRows.toLocaleString("vi-VN")} dòng
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
        isDetailLoading={rowDetailQuery.isLoading}
        isApproving={approveRow.isPending}
        isRejecting={rejectRow.isPending}
        onApprove={handleApprove}
        onReject={handleReject}
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
