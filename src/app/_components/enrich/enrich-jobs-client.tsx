"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";

import { Badge, Button, EmptyState } from "~/app/_components/ui";
import { ExcelResearchJobDetail } from "~/app/_components/enrich/excel-research-job-detail";
import {
  type ExcelResearchJobStatus,
  isExcelResearchJobActive,
} from "~/app/_components/research-enrich/excel-research-types";
import { api, type RouterOutputs } from "~/trpc/react";

const JOB_LIST_POLL_MS = 3_000;

type ExcelResearchJobListItem =
  RouterOutputs["excelResearch"]["listJobs"][number];

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

function shortJobId(jobId: string) {
  return jobId.slice(0, 8);
}

function formatDateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("vi-VN") : "-";
}

function progressPercent(processed: number, total: number) {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((processed / total) * 100));
}

export function EnrichJobsClient({ jobId }: { jobId?: string }) {
  const router = useRouter();
  const isJobPage = jobId != null;

  const jobListQuery = api.excelResearch.listJobs.useQuery(
    { limit: 50 },
    {
      refetchInterval: (query) => {
        const jobs = query.state.data ?? [];
        return jobs.some((job) => isExcelResearchJobActive(job)) ? JOB_LIST_POLL_MS : false;
      },
      refetchOnWindowFocus: false,
      staleTime: 0,
    },
  );

  const jobRows = jobListQuery.data ?? [];

  const focusJob = (nextJobId: string) => {
    router.push(`/enrich/jobs/${nextJobId}`);
  };

  if (isJobPage) {
    return (
      <div className="space-y-4">
        <section className="panel p-4 sm:p-5">
          <Link
            href="/enrich/jobs"
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900"
          >
            ← Danh sách job nghiên cứu
          </Link>
        </section>
        <ExcelResearchJobDetail jobId={jobId} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="panel p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="section-title">Nghiên cứu web</p>
            <h2 className="mt-1 text-base font-bold text-slate-950">
              Job nghiên cứu Excel
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Xem và tiếp tục các job nghiên cứu sản phẩm đã tạo từ bước 3 của
              đối chiếu Excel.
            </p>
          </div>
          <Link href="/enrich">
            <Button variant="secondary" size="sm">
              Mở đối chiếu Excel
            </Button>
          </Link>
        </div>
      </section>

      <section className="panel p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="section-title">Danh sách job</p>
            <h2 className="mt-1 text-base font-bold text-slate-950">
              Lịch sử nghiên cứu
            </h2>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            isLoading={jobListQuery.isFetching}
            leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
            onClick={() => void jobListQuery.refetch()}
          >
            Làm mới
          </Button>
        </div>

        {jobListQuery.isLoading ? (
          <div className="mt-6 flex items-center justify-center gap-2 text-sm text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Đang tải danh sách…
          </div>
        ) : jobRows.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Chưa có job nào"
              description="Tạo job từ bước Nghiên cứu web trong luồng đối chiếu Excel."
            />
            <div className="mt-4 flex justify-center">
              <Link href="/enrich">
                <Button variant="primary" size="sm">
                  Đi tới đối chiếu Excel
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {jobRows.map((job) => (
              <JobListRow key={job.id} job={job} onOpen={() => focusJob(job.id)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function JobListRow({
  job,
  onOpen,
}: {
  job: ExcelResearchJobListItem;
  onOpen: () => void;
}) {
  const active = isExcelResearchJobActive(job);
  const pct = progressPercent(job.processedRows, job.totalRows);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-3 hover:bg-slate-50">
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={onOpen}
      >
        <p className="truncate text-sm font-semibold text-slate-900">
          {job.sourceFileName}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          Job {shortJobId(job.id)} · {job.sheetName} ·{" "}
          {formatDateTime(job.updatedAt)}
        </p>
        {active ? (
          <div className="mt-2 max-w-xs">
            <div className="flex justify-between text-[11px] font-semibold text-violet-800">
              <span>Đang chạy</span>
              <span className="tabular-nums">
                {job.processedRows}/{job.totalRows}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-violet-100">
              <div
                className="h-full rounded-full bg-violet-600"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        ) : (
          <p className="mt-1 text-[11px] text-slate-500">
            {job.processedRows.toLocaleString("vi-VN")}/
            {job.totalRows.toLocaleString("vi-VN")} dòng
            {job.needsReviewRows > 0
              ? ` · ${job.needsReviewRows.toLocaleString("vi-VN")} cần duyệt`
              : ""}
          </p>
        )}
      </button>
      <Badge tone={JOB_STATUS_TONE[job.status]}>
        {active ? (
          <Loader2 className="mr-1 inline h-3 w-3 animate-spin" aria-hidden />
        ) : null}
        {JOB_STATUS_LABEL[job.status]}
      </Badge>
    </div>
  );
}
