"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  Bot,
  Check,
  CheckSquare,
  Download,
  ExternalLink,
  Eye,
  ImageOff,
  Loader2,
  RotateCcw,
  Sparkles,
  StopCircle,
  Trash2,
  X,
} from "lucide-react";

import { Badge, Button, ConfirmDialog, EmptyState } from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import {
  ENRICHABLE_FIELDS,
  ENRICHMENT_THRESHOLDS,
  type EnrichableField,
  type MaterialEnrichmentInput,
  type MaterialEnrichmentItemStatus,
} from "~/lib/materials/material-enrichment-types";
import { api, type RouterOutputs } from "~/trpc/react";

type EnrichmentJob = RouterOutputs["materialEnrichment"]["getMaterialEnrichmentJob"];
type EnrichmentJobListItem =
  RouterOutputs["materialEnrichment"]["listMaterialEnrichmentJobs"][number];
type EnrichmentItem =
  RouterOutputs["materialEnrichment"]["listMaterialEnrichmentItems"][number];

const EMPTY_UUID = "00000000-0000-4000-8000-000000000000";
const JOB_POLL_MS = 1_500;
const JOB_LIST_POLL_MS = 3_000;

const fieldLabel: Record<EnrichableField, string> = {
  category: "Nhóm",
  specText: "Thông số",
  manufacturer: "NCC",
  originCountry: "Xuất xứ",
  unit: "Đơn vị",
  price: "Đơn giá",
  sourceUrl: "URL nguồn",
};

const itemStatusLabel: Record<MaterialEnrichmentItemStatus, string> = {
  pending: "Chờ xử lý",
  processing: "Đang xử lý",
  review: "Cần duyệt",
  auto: "Tự động",
  committed: "Đã commit",
  rejected: "Đã từ chối",
  failed: "Lỗi",
  skipped: "Bỏ qua",
};

const itemStatusTone: Record<
  MaterialEnrichmentItemStatus,
  Parameters<typeof Badge>[0]["tone"]
> = {
  pending: "neutral",
  processing: "info",
  review: "warning",
  auto: "success",
  committed: "success",
  rejected: "neutral",
  failed: "critical",
  skipped: "neutral",
};

const jobStatusLabel: Record<EnrichmentJob["status"], string> = {
  queued: "Đang xếp hàng",
  running: "Đang chạy",
  completed: "Hoàn tất",
  failed: "Lỗi",
  cancelled: "Đã hủy",
};

const jobStatusTone: Record<
  EnrichmentJob["status"],
  Parameters<typeof Badge>[0]["tone"]
> = {
  queued: "neutral",
  running: "info",
  completed: "success",
  failed: "critical",
  cancelled: "warning",
};

function isJobActive(job: { status: EnrichmentJob["status"] } | null | undefined) {
  return job?.status === "queued" || job?.status === "running";
}

function shortJobId(jobId: string) {
  return jobId.slice(0, 8);
}

function formatDateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("vi-VN") : "-";
}

function progressPercent(value: number, total: number) {
  if (total <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((value / total) * 100));
}

function parseMaterialIds(value: string | null) {
  if (!value?.trim()) {
    return [];
  }
  return [
    ...new Set(
      value
        .split(",")
        .map((part) => Number.parseInt(part.trim(), 10))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  ];
}

function materialNameFromItem(item: EnrichmentItem) {
  const snapshot = item.originalSnapshot as Partial<MaterialEnrichmentInput>;
  const trimmedName = snapshot.name?.trim();
  if (!trimmedName) {
    return `Vật tư #${item.materialId}`;
  }
  return trimmedName;
}

function itemNeedsReview(item: EnrichmentItem) {
  return item.status === "review" || item.result.status === "review";
}

function confidenceColorClass(confidence: number): string {
  if (confidence >= ENRICHMENT_THRESHOLDS.high) {
    return "bg-green-50 text-green-700 border-green-200";
  }
  if (confidence >= ENRICHMENT_THRESHOLDS.medium) {
    return "bg-amber-50 text-amber-700 border-amber-200";
  }
  return "bg-slate-50 text-slate-600 border-slate-200";
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = (confidence * 100).toFixed(0);
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium ${confidenceColorClass(confidence)}`}
    >
      {pct}%
    </span>
  );
}

function isNotFoundTRPCError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const data =
    "data" in error && error.data && typeof error.data === "object"
      ? error.data
      : null;
  const code =
    data && "code" in data && typeof data.code === "string" ? data.code : null;
  const message =
    "message" in error && typeof error.message === "string"
      ? error.message
      : "";
  return code === "NOT_FOUND" || message.includes("Không tìm thấy job");
}

type WebCandidate = {
  id: number;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  confidenceScore: number;
  isSelected: boolean;
  catalogPdfUrls: string[];
  matchReasons: string[];
  imageUrl?: string | null;
};

export function MaterialEnrichClient({ jobId: routeJobId }: { jobId?: string } = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isJobPage = routeJobId != null;
  const { data: activeProviders } = api.ai.getActiveProviders.useQuery();
  const materialIdsFromUrl = useMemo(
    () => parseMaterialIds(searchParams.get("ids")),
    [searchParams],
  );

  const [options, setOptions] = useState({
    skipWellFilled: true,
    generatePdfIfMissing: true,
    autoCommitHighConfidence: false,
  });
  const [reviewItemId, setReviewItemId] = useState<number | null>(null);
  const [hideCommitted, setHideCommitted] = useState(false);
  const [cancelJobOpen, setCancelJobOpen] = useState(false);
  const [deleteJobTarget, setDeleteJobTarget] = useState<EnrichmentJobListItem | null>(
    null,
  );
  const [isDownloadingReport, setIsDownloadingReport] = useState(false);

  const utils = api.useUtils();
  const toast = useToast();

  const focusedJobId = routeJobId ?? null;

  const jobListQuery = api.materialEnrichment.listMaterialEnrichmentJobs.useQuery(
    undefined,
    {
      refetchInterval: (query) => {
        const jobs = query.state.data ?? [];
        return jobs.some(isJobActive) ? JOB_LIST_POLL_MS : false;
      },
      refetchOnWindowFocus: false,
      staleTime: 0,
    },
  );

  const jobQuery = api.materialEnrichment.getMaterialEnrichmentJob.useQuery(
    { jobId: focusedJobId ?? EMPTY_UUID },
    {
      enabled: focusedJobId !== null,
      refetchInterval: (query) => {
        const job = query.state.data;
        return isJobActive(job) ? JOB_POLL_MS : false;
      },
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 0,
    },
  );

  const itemsQuery = api.materialEnrichment.listMaterialEnrichmentItems.useQuery(
    { jobId: focusedJobId ?? EMPTY_UUID },
    {
      enabled: focusedJobId !== null,
      refetchInterval: (_query) => {
        const job = jobQuery.data;
        return isJobActive(job) ? JOB_POLL_MS : false;
      },
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 0,
    },
  );

  const reviewItemQuery = api.materialEnrichment.getMaterialEnrichmentItem.useQuery(
    { itemId: reviewItemId ?? 0 },
    { enabled: reviewItemId !== null, staleTime: 0 },
  );

  const activeJob = jobQuery.data ?? null;
  const isActive = isJobActive(activeJob);
  const jobRows = jobListQuery.data ?? [];
  const items = itemsQuery.data ?? [];

  const startJob = api.materialEnrichment.startMaterialEnrichmentJob.useMutation({
    onSuccess: (job) => {
      void utils.materialEnrichment.listMaterialEnrichmentJobs.invalidate();
      toast.success("Đã bắt đầu job làm giàu vật tư.");
      router.push(`/materials/enrich/jobs/${job.id}`);
    },
    onError: (error) => {
      toast.error(error.message || "Không thể bắt đầu job làm giàu.");
    },
  });

  const cancelJob = api.materialEnrichment.cancelMaterialEnrichmentJob.useMutation({
    onSuccess: (job) => {
      utils.materialEnrichment.getMaterialEnrichmentJob.setData(
        { jobId: job.id },
        job,
      );
      void utils.materialEnrichment.listMaterialEnrichmentJobs.invalidate();
      setCancelJobOpen(false);
      toast.warning("Đã hủy job làm giàu.");
    },
    onError: (error) => {
      toast.error(error.message || "Không thể hủy job.");
    },
  });

  const deleteJob = api.materialEnrichment.deleteMaterialEnrichmentJob.useMutation({
    onSuccess: () => {
      void utils.materialEnrichment.listMaterialEnrichmentJobs.invalidate();
      setDeleteJobTarget(null);
      toast.success("Đã xóa job khỏi danh sách.");
    },
    onError: (error) => {
      toast.error(error.message || "Không thể xóa job.");
    },
  });

  const commitItem = api.materialEnrichment.commitMaterialEnrichmentItem.useMutation({
    onSuccess: () => {
      void invalidateJobData();
      setReviewItemId(null);
      toast.success("Đã commit thay đổi vào catalog.");
    },
    onError: (error) => {
      toast.error(error.message || "Không thể commit mục này.");
    },
  });

  const rejectItem = api.materialEnrichment.rejectMaterialEnrichmentItem.useMutation({
    onSuccess: () => {
      void invalidateJobData();
      setReviewItemId(null);
      toast.success("Đã từ chối đề xuất enrichment.");
    },
    onError: (error) => {
      toast.error(error.message || "Không thể từ chối mục này.");
    },
  });

  const bulkCommit = api.materialEnrichment.bulkCommitMaterialEnrichment.useMutation({
    onSuccess: (result) => {
      void invalidateJobData();
      toast.success(
        `Đã commit ${result.committed.toLocaleString("vi-VN")} mục${
          result.failed > 0
            ? ` (${result.failed.toLocaleString("vi-VN")} lỗi)`
            : ""
        }.`,
      );
    },
    onError: (error) => {
      toast.error(error.message || "Không thể commit hàng loạt.");
    },
  });

  const selectCandidate = api.materialEnrichment.selectWebCandidate.useMutation({
    onSuccess: () => {
      void invalidateJobData();
      if (reviewItemId !== null) {
        void reviewItemQuery.refetch();
      }
      toast.success("Đã chọn ứng viên web.");
    },
    onError: (error) => {
      toast.error(error.message || "Không thể chọn ứng viên.");
    },
  });

  const invalidateJobData = async () => {
    if (!focusedJobId) {
      return;
    }
    await Promise.all([
      utils.materialEnrichment.getMaterialEnrichmentJob.invalidate({
        jobId: focusedJobId,
      }),
      utils.materialEnrichment.listMaterialEnrichmentItems.invalidate({
        jobId: focusedJobId,
      }),
      utils.materialEnrichment.listMaterialEnrichmentJobs.invalidate(),
    ]);
  };

  const focusJob = (jobId: string) => {
    router.push(`/materials/enrich/jobs/${jobId}`);
  };

  const submitStart = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (materialIdsFromUrl.length === 0 || startJob.isPending) {
      return;
    }
    startJob.mutate({
      materialIds: materialIdsFromUrl,
      options: {
        autoCommitHighConfidence: options.autoCommitHighConfidence,
      },
    });
  };

  const downloadReport = async () => {
    if (!focusedJobId || isDownloadingReport) {
      return;
    }
    setIsDownloadingReport(true);
    try {
      const json =
        await utils.materialEnrichment.exportMaterialEnrichmentReport.fetch({
          jobId: focusedJobId,
        });
      const blob = new Blob([json], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `enrichment-report-${shortJobId(focusedJobId)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success("Đã tải báo cáo enrichment.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Không thể tải báo cáo.";
      toast.error(message);
    } finally {
      setIsDownloadingReport(false);
    }
  };

  const highConfidenceCount = items.filter(
    (item) =>
      item.result.overallConfidence >= ENRICHMENT_THRESHOLDS.high &&
      ["auto", "review"].includes(item.status),
  ).length;

  const processedPercent = activeJob
    ? progressPercent(activeJob.processed, activeJob.total)
    : 0;

  const committedCount = items.filter(
    (item) => item.status === "committed",
  ).length;
  const visibleItems =
    hideCommitted ? items.filter((item) => item.status !== "committed") : items;

  return (
    <div className="space-y-4">
      {isJobPage ? (
        <section className="panel p-4 sm:p-5">
          <Link
            href="/materials/enrich"
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900"
          >
            ← Danh sách job làm giàu
          </Link>
        </section>
      ) : null}

      {!isJobPage ? (
        <section className="panel p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="section-title">Làm giàu vật tư</p>
              <h2 className="mt-1 text-base font-bold text-slate-950 text-balance">
                Tìm kiếm web và bổ sung catalog
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Chọn vật tư từ danh mục, chạy job enrichment để tìm thông số,
                NCC, xuất xứ và catalog PDF từ nguồn đáng tin cậy.
              </p>
            </div>
            <Badge tone="info">
              <Sparkles className="h-3 w-3" aria-hidden />
              Web enrichment
            </Badge>
            {activeProviders?.enrichment ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                <Bot className="h-3 w-3" aria-hidden />
                {activeProviders.enrichment === "openrouter"
                  ? "OpenRouter"
                  : activeProviders.enrichment === "gemini"
                    ? "Gemini"
                    : "Custom"}
              </span>
            ) : null}
          </div>

          <form className="mt-4 space-y-4" onSubmit={submitStart}>
            <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
              <p className="text-sm font-semibold text-slate-900">
                {materialIdsFromUrl.length > 0
                  ? `${materialIdsFromUrl.length.toLocaleString("vi-VN")} vật tư đã chọn`
                  : "Chưa chọn vật tư"}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                {materialIdsFromUrl.length > 0
                  ? `ID: ${materialIdsFromUrl.slice(0, 12).join(", ")}${
                      materialIdsFromUrl.length > 12 ? "…" : ""
                    }`
                  : "Quay lại danh mục, chọn vật tư và dùng nút “Làm giàu”."}
              </p>
              {materialIdsFromUrl.length === 0 ? (
                <Link
                  href="/materials"
                  className="mt-2 inline-flex text-xs font-semibold text-sky-700 hover:text-sky-900"
                >
                  Mở danh mục vật tư →
                </Link>
              ) : null}
            </div>

            <fieldset className="space-y-2">
              <legend className="text-xs font-bold tracking-[0.12em] text-slate-500 uppercase">
                Tùy chọn
              </legend>
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={options.skipWellFilled}
                  onChange={(event) =>
                    setOptions((current) => ({
                      ...current,
                      skipWellFilled: event.target.checked,
                    }))
                  }
                />
                <span>
                  <span className="font-medium">Bỏ qua vật tư đã đủ thông tin</span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    Không xử lý các dòng đã có NCC, thông số và catalog PDF.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={options.generatePdfIfMissing}
                  onChange={(event) =>
                    setOptions((current) => ({
                      ...current,
                      generatePdfIfMissing: event.target.checked,
                    }))
                  }
                />
                <span>
                  <span className="font-medium">Tạo catalog PDF nếu không tìm thấy</span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    Tạo PDF gắn nhãn “generated” từ thông tin đã xác minh.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={options.autoCommitHighConfidence}
                  onChange={(event) =>
                    setOptions((current) => ({
                      ...current,
                      autoCommitHighConfidence: event.target.checked,
                    }))
                  }
                />
                <span>
                  <span className="font-medium">
                    Tự commit khi độ tin cậy ≥{" "}
                    {(ENRICHMENT_THRESHOLDS.high * 100).toFixed(0)}%
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    Ghi an toàn vào catalog mà không cần duyệt thủ công.
                  </span>
                </span>
              </label>
            </fieldset>

            <Button
              type="submit"
              disabled={materialIdsFromUrl.length === 0 || startJob.isPending}
              isLoading={startJob.isPending}
              leftIcon={<Sparkles className="h-3.5 w-3.5" />}
            >
              Bắt đầu làm giàu
            </Button>
          </form>
        </section>
      ) : null}

      {!isJobPage ? (
        <section className="panel p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="section-title">Danh sách job</p>
              <h2 className="mt-1 text-base font-bold text-slate-950 text-balance">
                Lịch sử enrichment
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

          {jobRows.length > 0 ? (
            <div className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {jobRows.map((job) => {
                const active = isJobActive(job);
                return (
                  <div
                    key={job.id}
                    className="flex flex-wrap items-center justify-between gap-3 p-3 hover:bg-slate-50"
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => focusJob(job.id)}
                    >
                      <p className="text-sm font-semibold text-slate-900">
                        Job {shortJobId(job.id)}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {job.materialIds.length.toLocaleString("vi-VN")} vật tư ·{" "}
                        {formatDateTime(job.startedAt)}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Badge tone={jobStatusTone[job.status]}>
                          {active ? (
                            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                          ) : null}
                          {jobStatusLabel[job.status]}
                        </Badge>
                        <Badge tone="neutral" count={job.processed}>
                          Đã xử lý
                        </Badge>
                        <Badge tone="warning" count={job.needsReview}>
                          Cần duyệt
                        </Badge>
                      </div>
                    </button>
                    <div className="flex items-center gap-2">
                      {active ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          leftIcon={<StopCircle className="h-3.5 w-3.5" />}
                          disabled={cancelJob.isPending}
                          onClick={() => {
                            focusJob(job.id);
                            setCancelJobOpen(true);
                          }}
                        >
                          Dừng
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                          disabled={deleteJob.isPending}
                          onClick={() => setDeleteJobTarget(job)}
                        >
                          Xóa
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mt-4">
              <EmptyState
                title="Chưa có job làm giàu"
                description="Chọn vật tư từ danh mục và bắt đầu job đầu tiên."
              />
            </div>
          )}
        </section>
      ) : null}

      {isJobPage && activeJob ? (
        <>
          <section className="panel p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="section-title">Tiến độ job</p>
                <h2 className="mt-1 text-base font-bold text-slate-950 text-balance">
                  Job {shortJobId(activeJob.id)}
                </h2>
                {activeJob.currentMaterialName ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Đang xử lý: {activeJob.currentMaterialName}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={jobStatusTone[activeJob.status]}>
                  {isActive ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  ) : null}
                  {jobStatusLabel[activeJob.status]}
                </Badge>
                {isActive ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    leftIcon={<StopCircle className="h-3.5 w-3.5" />}
                    disabled={cancelJob.isPending}
                    onClick={() => setCancelJobOpen(true)}
                  >
                    Hủy job
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  leftIcon={<Download className="h-3.5 w-3.5" />}
                  isLoading={isDownloadingReport}
                  onClick={() => void downloadReport()}
                >
                  Tải báo cáo
                </Button>
                {highConfidenceCount > 0 && !isActive ? (
                  <Button
                    type="button"
                    size="sm"
                    leftIcon={<CheckSquare className="h-3.5 w-3.5" />}
                    disabled={bulkCommit.isPending}
                    isLoading={bulkCommit.isPending}
                    onClick={() =>
                      bulkCommit.mutate({
                        jobId: activeJob.id,
                        minConfidence: ENRICHMENT_THRESHOLDS.high,
                      })
                    }
                  >
                    Commit ≥ {(ENRICHMENT_THRESHOLDS.high * 100).toFixed(0)}%
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
                <span>
                  {activeJob.processed.toLocaleString("vi-VN")} /{" "}
                  {activeJob.total.toLocaleString("vi-VN")} vật tư
                </span>
                <span className="tabular-nums">{processedPercent}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full transition-all ${
                    isActive ? "bg-sky-500" : "bg-emerald-500"
                  }`}
                  style={{ width: `${processedPercent}%` }}
                />
              </div>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <StatCard label="Cần duyệt" value={activeJob.needsReview} />
              <StatCard label="PDF tìm thấy" value={activeJob.pdfsFound} />
              <StatCard label="PDF tạo mới" value={activeJob.pdfsGenerated} />
              <StatCard label="Lỗi" value={activeJob.failed} tone="critical" />
              <StatCard label="Khớp" value={activeJob.matched} tone="success" />
            </dl>

            {activeJob.message || activeJob.error ? (
              <p className="mt-3 text-xs text-slate-600">
                {activeJob.message ?? activeJob.error}
              </p>
            ) : null}
          </section>

          <section className="panel overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-bold text-slate-900 text-balance">
                Chi tiết từng vật tư
              </h3>
              {committedCount > 0 ? (
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600">
                  <input
                    type="checkbox"
                    checked={hideCommitted}
                    onChange={(event) => setHideCommitted(event.target.checked)}
                  />
                  <span>
                    Ẩn mục đã commit ({committedCount.toLocaleString("vi-VN")})
                  </span>
                </label>
              ) : null}
            </div>

            {itemsQuery.isLoading ? (
              <div className="p-4 text-sm text-slate-600">
                <Loader2 className="mr-2 inline-block h-4 w-4 animate-spin" aria-hidden />
                Đang tải danh sách…
              </div>
            ) : items.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="Chưa có mục nào"
                  description="Job đang khởi tạo hoặc chưa có vật tư."
                />
              </div>
            ) : visibleItems.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="Đã commit tất cả"
                  description="Tất cả mục đã được commit. Bỏ chọn “Ẩn mục đã commit” để xem lại."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-bold text-slate-500 uppercase">
                    <tr>
                      <th className="px-3 py-2">Vật tư</th>
                      <th className="px-3 py-2">Trạng thái</th>
                      <th className="px-3 py-2">Độ tin cậy</th>
                      <th className="px-3 py-2">Cần duyệt</th>
                      <th className="px-3 py-2 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {visibleItems.map((item) => {
                      const status = item.status as MaterialEnrichmentItemStatus;
                      const canCommit = ["auto", "review"].includes(item.status);
                      const canReview = !["pending", "processing"].includes(
                        item.status,
                      );
                      return (
                        <tr key={item.id} className="hover:bg-slate-50/80">
                          <td className="px-3 py-2">
                            <Link
                              href={`/materials/${item.materialId}`}
                              className="font-medium text-sky-700 hover:underline"
                            >
                              {materialNameFromItem(item)}
                            </Link>
                            <p className="text-xs text-slate-500">
                              #{item.materialId}
                            </p>
                            {item.result.error ? (
                              <p className="mt-1 text-xs text-amber-700">
                                {item.result.error}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            <Badge tone={itemStatusTone[status] ?? "neutral"}>
                              {itemStatusLabel[status] ?? item.status}
                            </Badge>
                          </td>
                          <td className="px-3 py-2">
                            <ConfidenceBadge
                              confidence={item.result.overallConfidence}
                            />
                          </td>
                          <td className="px-3 py-2">
                            {itemNeedsReview(item) ? (
                              <Badge tone="warning">Có</Badge>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-end gap-1.5">
                              {canReview ? (
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  leftIcon={<Eye className="h-3.5 w-3.5" />}
                                  onClick={() => setReviewItemId(item.id)}
                                >
                                  Duyệt
                                </Button>
                              ) : null}
                              {canCommit ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  leftIcon={<Check className="h-3.5 w-3.5" />}
                                  disabled={commitItem.isPending}
                                  onClick={() =>
                                    commitItem.mutate({ itemId: item.id })
                                  }
                                >
                                  Commit
                                </Button>
                              ) : null}
                              {canReview && item.status !== "rejected" ? (
                                <Button
                                  type="button"
                                  variant="danger"
                                  size="sm"
                                  leftIcon={<X className="h-3.5 w-3.5" />}
                                  disabled={rejectItem.isPending}
                                  onClick={() =>
                                    rejectItem.mutate({ itemId: item.id })
                                  }
                                >
                                  Từ chối
                                </Button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : isJobPage && jobQuery.isLoading ? (
        <div className="panel p-5 text-sm text-slate-600">
          <Loader2 className="mr-2 inline-block h-4 w-4 animate-spin" aria-hidden />
          Đang tải job…
        </div>
      ) : isJobPage && jobQuery.isError ? (
        <div className="panel p-5">
          <EmptyState
            title="Không tìm thấy job"
            description={
              isNotFoundTRPCError(jobQuery.error)
                ? "Job có thể đã hết hạn hoặc bị xóa."
                : (jobQuery.error.message ?? "Không thể tải job.")
            }
          />
        </div>
      ) : null}

      <EnrichmentReviewDialog
        open={reviewItemId !== null}
        item={reviewItemQuery.data ?? null}
        isLoading={reviewItemQuery.isLoading}
        jobId={focusedJobId}
        isSelecting={selectCandidate.isPending}
        isCommitting={commitItem.isPending}
        isRejecting={rejectItem.isPending}
        onSelectCandidate={(candidateId) => {
          if (reviewItemId === null) return;
          selectCandidate.mutate({ itemId: reviewItemId, candidateId });
        }}
        onCommit={() => {
          if (reviewItemId === null) return;
          commitItem.mutate({ itemId: reviewItemId });
        }}
        onReject={() => {
          if (reviewItemId === null) return;
          rejectItem.mutate({ itemId: reviewItemId });
        }}
        onClose={() => setReviewItemId(null)}
      />

      <ConfirmDialog
        open={cancelJobOpen}
        title="Hủy job làm giàu?"
        description="Job sẽ dừng xử lý các vật tư còn lại."
        confirmLabel="Hủy job"
        variant="danger"
        isLoading={cancelJob.isPending}
        onConfirm={() => {
          if (focusedJobId) {
            cancelJob.mutate({ jobId: focusedJobId });
          }
        }}
        onCancel={() => setCancelJobOpen(false)}
      />

      <ConfirmDialog
        open={deleteJobTarget !== null}
        title="Xóa job khỏi danh sách?"
        description="Job đã hoàn tất hoặc hủy mới có thể xóa."
        confirmLabel="Xóa"
        variant="danger"
        isLoading={deleteJob.isPending}
        onConfirm={() => {
          if (deleteJobTarget) {
            deleteJob.mutate({ jobId: deleteJobTarget.id });
          }
        }}
        onCancel={() => setDeleteJobTarget(null)}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: Parameters<typeof Badge>[0]["tone"];
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2">
      <dt className="text-[11px] font-bold tracking-[0.12em] text-slate-500 uppercase">
        {label}
      </dt>
      <dd className="mt-1">
        <Badge tone={tone} count={value} />
      </dd>
    </div>
  );
}

function EnrichmentReviewDialog({
  open,
  item,
  isLoading,
  jobId,
  isSelecting,
  isCommitting,
  isRejecting,
  onSelectCandidate,
  onCommit,
  onReject,
  onClose,
}: {
  open: boolean;
  item: RouterOutputs["materialEnrichment"]["getMaterialEnrichmentItem"] | null;
  isLoading: boolean;
  jobId: string | null;
  isSelecting: boolean;
  isCommitting: boolean;
  isRejecting: boolean;
  onSelectCandidate: (candidateId: number) => void;
  onCommit: () => void;
  onReject: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const utils = api.useUtils();
  const [candidates, setCandidates] = useState<WebCandidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open || !item || !jobId) {
      setCandidates([]);
      return;
    }

    let cancelled = false;
    setLoadingCandidates(true);

    void (async () => {
      try {
        const json =
          await utils.materialEnrichment.exportMaterialEnrichmentReport.fetch({
            jobId,
          });
        const parsed = JSON.parse(json) as {
          candidatesByItem?: Array<{
            itemId: number;
            candidates: WebCandidate[];
          }>;
        };
        if (cancelled) return;
        const match = parsed.candidatesByItem?.find(
          (entry) => entry.itemId === item.id,
        );
        setCandidates(match?.candidates ?? []);
      } catch {
        if (!cancelled) {
          setCandidates([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingCandidates(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, item, jobId, utils.materialEnrichment.exportMaterialEnrichmentReport]);

  if (!open) {
    return null;
  }

  const snapshot = (item?.originalSnapshot ?? {}) as Partial<MaterialEnrichmentInput>;
  const result = item?.result;
  const trimmedName = snapshot.name?.trim();
  const materialName = trimmedName ?? "Vật tư";

  return (
    <dialog
      ref={dialogRef}
      className="fixed top-1/2 left-1/2 z-50 m-0 flex max-h-[min(92dvh,900px)] w-[min(960px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-slate-950/50"
      onCancel={(event) => {
        event.preventDefault();
        if (!isCommitting && !isRejecting) {
          onClose();
        }
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current && !isCommitting && !isRejecting) {
          onClose();
        }
      }}
    >
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold tracking-[0.12em] text-slate-500 uppercase">
              Duyệt enrichment
            </p>
            <h3 className="mt-1 text-lg font-bold text-slate-950">{materialName}</h3>
            {result ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <ConfidenceBadge confidence={result.overallConfidence} />
                <Badge tone={itemStatusTone[result.status] ?? "neutral"}>
                  {itemStatusLabel[result.status] ?? result.status}
                </Badge>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
            onClick={onClose}
            aria-label="Đóng"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Đang tải chi tiết…
          </div>
        ) : !item || !result ? (
          <EmptyState title="Không có dữ liệu" description="Mục này chưa sẵn sàng để duyệt." />
        ) : (
          <div className="space-y-5">
            <div>
              <h4 className="text-sm font-bold text-slate-900">Trước / sau</h4>
              <div className="mt-2 flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                  {item.materialImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.materialImageUrl}
                      alt=""
                      className="h-full w-full object-contain"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-slate-300">
                      <ImageOff className="h-6 w-6" aria-hidden />
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-500">
                    Ảnh vật tư hiện tại
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    So sánh trực quan với ảnh ứng viên web bên dưới.
                  </p>
                </div>
              </div>
              <div className="mt-2 overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-bold text-slate-500 uppercase">
                    <tr>
                      <th className="px-3 py-2">Trường</th>
                      <th className="px-3 py-2">Trước</th>
                      <th className="px-3 py-2">Đề xuất</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ENRICHABLE_FIELDS.map((field) => {
                      const before = readSnapshotField(snapshot, field);
                      const proposed = result.fields[field];
                      const after = formatFieldValue(field, proposed?.value ?? null);
                      const changed = before !== after && after !== "";
                      return (
                        <tr key={field} className={changed ? "bg-sky-50/50" : undefined}>
                          <td className="px-3 py-2 font-medium text-slate-700">
                            {fieldLabel[field]}
                          </td>
                          <td className="px-3 py-2 text-slate-600">
                            {before || <span className="text-slate-400">—</span>}
                          </td>
                          <td className="px-3 py-2">
                            {after ? (
                              <span className="font-medium text-slate-900">{after}</span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                            {proposed ? (
                              <span className="ml-2">
                                <ConfidenceBadge confidence={proposed.confidence} />
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                    {(() => {
                      const proposedPdfCount = result.catalogPdfUrls.length;
                      return (
                        <tr
                          className={
                            proposedPdfCount > 0 ? "bg-sky-50/50" : undefined
                          }
                        >
                          <td className="px-3 py-2 font-medium text-slate-700">
                            Catalog PDF
                          </td>
                          <td className="px-3 py-2 text-slate-600">
                            <span className="text-slate-400">—</span>
                          </td>
                          <td className="px-3 py-2">
                            {proposedPdfCount > 0 ? (
                              <span className="font-medium text-slate-900">
                                {proposedPdfCount.toLocaleString("vi-VN")} catalog
                                PDF
                              </span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })()}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-bold text-slate-900">Bằng chứng</h4>
              <div className="mt-2 space-y-2">
                {collectEvidence(result).length === 0 ? (
                  <p className="text-xs text-slate-500">Chưa có bằng chứng trích xuất.</p>
                ) : (
                  collectEvidence(result).map((evidence, index) => (
                    <div
                      key={`${evidence.field}-${index}`}
                      className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 text-xs"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="neutral">{fieldLabel[evidence.field as EnrichableField] ?? evidence.field}</Badge>
                        <span className="font-medium text-slate-800">{evidence.value}</span>
                      </div>
                      {evidence.sourceUrl ? (
                        <a
                          href={evidence.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1.5 inline-flex items-center gap-1 text-sky-700 hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" aria-hidden />
                          {tryHostname(evidence.sourceUrl)}
                        </a>
                      ) : null}
                      {evidence.snippet ? (
                        <p className="mt-1.5 text-slate-600 line-clamp-3">{evidence.snippet}</p>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div>
              <h4 className="text-sm font-bold text-slate-900">Ứng viên web</h4>
              {loadingCandidates ? (
                <div className="mt-2 flex items-center gap-2 text-sm text-slate-600">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Đang tải ứng viên…
                </div>
              ) : candidates.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500">Không có ứng viên web.</p>
              ) : (
                <div className="mt-2 space-y-2">
                  {candidates.map((candidate) => (
                    <label
                      key={candidate.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                        candidate.isSelected
                          ? "border-sky-300 bg-sky-50"
                          : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <input
                        type="radio"
                        name="web-candidate"
                        className="mt-1"
                        checked={candidate.isSelected}
                        disabled={isSelecting}
                        onChange={() => onSelectCandidate(candidate.id)}
                      />
                      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                        {candidate.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={candidate.imageUrl}
                            alt=""
                            className="h-full w-full object-contain"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-slate-300">
                            <ImageOff className="h-5 w-5" aria-hidden />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-900">
                          {candidate.title}
                        </p>
                        <a
                          href={candidate.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-0.5 inline-flex items-center gap-1 text-xs text-sky-700 hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" aria-hidden />
                          {candidate.domain}
                        </a>
                        {candidate.snippet ? (
                          <p className="mt-1 text-xs text-slate-600 line-clamp-2">
                            {candidate.snippet}
                          </p>
                        ) : null}
                        {candidate.matchReasons.length > 0 ? (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {candidate.matchReasons.map((reason) => (
                              <span
                                key={reason}
                                className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600"
                              >
                                {reason}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <Badge tone="info" count={candidate.confidenceScore}>
                        Điểm
                      </Badge>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {result.catalogPdfUrls.length > 0 ? (
              <div>
                <h4 className="text-sm font-bold text-slate-900">Catalog PDF</h4>
                <ul className="mt-2 space-y-1 text-xs">
                  {result.catalogPdfUrls.map((url) => (
                    <li key={url}>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sky-700 hover:underline break-all"
                      >
                        {url}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
        <Button type="button" variant="secondary" onClick={onClose}>
          Đóng
        </Button>
        <Button
          type="button"
          variant="danger"
          disabled={isRejecting || !item}
          isLoading={isRejecting}
          onClick={onReject}
        >
          Từ chối
        </Button>
        <Button
          type="button"
          disabled={isCommitting || !item}
          isLoading={isCommitting}
          leftIcon={<Check className="h-3.5 w-3.5" />}
          onClick={onCommit}
        >
          Commit vào catalog
        </Button>
      </div>
    </dialog>
  );
}

function readSnapshotField(
  snapshot: Partial<MaterialEnrichmentInput>,
  field: EnrichableField,
) {
  if (field === "price") {
    return formatFieldValue(field, readRawSnapshotPrice(snapshot));
  }
  const value = snapshot[field];
  return typeof value === "string" ? value.trim() : "";
}

function readRawSnapshotPrice(snapshot: Partial<MaterialEnrichmentInput>) {
  const price = snapshot.defaultUnitPrice;
  return typeof price === "number" && Number.isFinite(price)
    ? String(price)
    : null;
}

/**
 * Format a proposed/extracted field value for display. Price values arrive as
 * raw numeric strings (e.g. "1250000") and are shown with VN grouping.
 */
function formatFieldValue(field: EnrichableField, value: string | null) {
  if (value == null || value === "") {
    return "";
  }
  if (field === "price") {
    const numeric = Number(value.replace(/[^\d.-]/g, ""));
    return Number.isFinite(numeric) && numeric > 0
      ? numeric.toLocaleString("vi-VN")
      : value.trim();
  }
  return value.trim();
}

function collectEvidence(
  result: RouterOutputs["materialEnrichment"]["getMaterialEnrichmentItem"]["result"],
) {
  const entries: Array<{
    field: string;
    value: string;
    sourceUrl: string;
    snippet: string;
  }> = [];

  for (const field of ENRICHABLE_FIELDS) {
    const fieldResult = result.fields[field];
    if (!fieldResult?.evidence) continue;
    for (const evidence of fieldResult.evidence) {
      entries.push({
        field,
        value: evidence.value,
        sourceUrl: evidence.sourceUrl,
        snippet: evidence.snippet,
      });
    }
  }

  return entries;
}

function tryHostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
