"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";

import { Badge, Button, EmptyState } from "~/app/_components/ui";
import { api, type RouterOutputs } from "~/trpc/react";

const JOB_LIST_POLL_MS = 3_000;
const JOB_LIST_LIMIT = 50;

/** Shared tone mapping reused across every job type's status badge. */
type BadgeTone = Parameters<typeof Badge>[0]["tone"];

const STATUS_TONE: Record<string, BadgeTone> = {
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

const STATUS_LABEL: Record<string, string> = {
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

const ACTIVE_STATUSES = new Set([
  "queued",
  "running",
  "paused",
  "awaiting_review",
  "exporting",
]);

type JobKind = "excel" | "scrape" | "import" | "enrichment";

const KIND_LABEL: Record<JobKind, string> = {
  excel: "Đối chiếu Excel",
  scrape: "Quét cửa hàng",
  import: "Nhập catalog",
  enrichment: "Enrich vật tư",
};

const KIND_TONE: Record<JobKind, BadgeTone> = {
  excel: "info",
  scrape: "warning",
  import: "neutral",
  enrichment: "success",
};

type JobFilter = "all" | JobKind;

const FILTER_LABEL: Record<JobFilter, string> = {
  all: "Tất cả",
  excel: KIND_LABEL.excel,
  scrape: KIND_LABEL.scrape,
  import: KIND_LABEL.import,
  enrichment: KIND_LABEL.enrichment,
};

/** Normalized row rendered by the unified list, independent of job type. */
type UnifiedJob = {
  id: string;
  kind: JobKind;
  status: string;
  title: string;
  subtitle: string;
  processed: number;
  total: number;
  updatedAt: string | null;
  /** Detail route, or null when the job type has no dedicated page. */
  href: string | null;
  /** Optional outcome breakdown rendered as chips under the subtitle. */
  counts?: {
    matched?: number;
    needsReview?: number;
    error?: number;
  };
};

function shortId(id: string) {
  return id.slice(0, 8);
}

function formatDateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("vi-VN") : "-";
}

function progressPercent(processed: number, total: number) {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((processed / total) * 100));
}

function isActive(status: string) {
  return ACTIVE_STATUSES.has(status);
}

function pollWhileActive(jobs: { status: string }[]) {
  return jobs.some((job) => isActive(job.status)) ? JOB_LIST_POLL_MS : false;
}

type ExcelJob = RouterOutputs["excelResearch"]["listJobs"][number];
type ScrapeJob = RouterOutputs["material"]["listShopScrapeJobs"][number];
type ImportJob = RouterOutputs["material"]["listShopImportJobs"][number];
type EnrichmentJob =
  RouterOutputs["materialEnrichment"]["listMaterialEnrichmentJobs"][number];

function fromExcel(job: ExcelJob): UnifiedJob {
  return {
    id: job.id,
    kind: "excel",
    status: job.status,
    title: job.name || job.sourceFileName,
    subtitle: `${job.sheetName} · Job ${shortId(job.id)}`,
    processed: job.processedRows,
    total: job.totalRows,
    updatedAt: job.updatedAt,
    href: `/enrich/jobs/${job.id}`,
    counts: {
      matched: job.matchedRows,
      needsReview: job.needsReviewRows,
      error: job.errorRows,
    },
  };
}

function fromScrape(job: ScrapeJob): UnifiedJob {
  return {
    id: job.id,
    kind: "scrape",
    status: job.status,
    title: job.url,
    subtitle: `${job.productCount.toLocaleString("vi-VN")} sản phẩm · Job ${shortId(job.id)}`,
    // Scrape jobs have no fixed total; surface discovered products as progress.
    processed: job.productCount,
    total: job.productCount,
    updatedAt: job.lastProgressAt ?? job.finishedAt ?? job.startedAt,
    href: `/materials/scrape/jobs/${job.id}`,
  };
}

function fromImport(job: ImportJob): UnifiedJob {
  return {
    id: job.id,
    kind: "import",
    status: job.status,
    title: job.currentProductName ?? `Nhập catalog ${shortId(job.id)}`,
    subtitle: `${job.created.toLocaleString("vi-VN")} mới · ${job.updated.toLocaleString("vi-VN")} cập nhật · Job ${shortId(job.id)}`,
    processed: job.processed,
    total: job.total,
    updatedAt: job.lastProgressAt ?? job.finishedAt ?? job.startedAt,
    // Import jobs are managed inline on their parent scrape job.
    href: `/materials/scrape/jobs/${job.scrapeJobId}`,
  };
}

function fromEnrichment(job: EnrichmentJob): UnifiedJob {
  return {
    id: job.id,
    kind: "enrichment",
    status: job.status,
    title: job.currentMaterialName ?? `Enrich vật tư ${shortId(job.id)}`,
    subtitle: `${job.matched.toLocaleString("vi-VN")} khớp · ${job.needsReview.toLocaleString("vi-VN")} cần duyệt · Job ${shortId(job.id)}`,
    processed: job.processed,
    total: job.total,
    updatedAt: job.lastProgressAt ?? job.finishedAt ?? job.startedAt,
    href: `/materials/enrich/jobs/${job.id}`,
    counts: {
      matched: job.matched,
      needsReview: job.needsReview,
      error: job.failed,
    },
  };
}

export function JobsListClient() {
  const router = useRouter();
  const [activeFilter, setActiveFilter] = useState<JobFilter>("all");

  const excelQuery = api.excelResearch.listJobs.useQuery(
    { limit: JOB_LIST_LIMIT },
    {
      refetchInterval: (query) => pollWhileActive(query.state.data ?? []),
      refetchOnWindowFocus: false,
    },
  );
  const scrapeQuery = api.material.listShopScrapeJobs.useQuery(
    { limit: JOB_LIST_LIMIT },
    {
      refetchInterval: (query) => pollWhileActive(query.state.data ?? []),
      refetchOnWindowFocus: false,
    },
  );
  const importQuery = api.material.listShopImportJobs.useQuery(
    { limit: JOB_LIST_LIMIT },
    {
      refetchInterval: (query) => pollWhileActive(query.state.data ?? []),
      refetchOnWindowFocus: false,
    },
  );
  const enrichmentQuery =
    api.materialEnrichment.listMaterialEnrichmentJobs.useQuery(
      { limit: JOB_LIST_LIMIT },
      {
        refetchInterval: (query) => pollWhileActive(query.state.data ?? []),
        refetchOnWindowFocus: false,
      },
    );

  const queries = [excelQuery, scrapeQuery, importQuery, enrichmentQuery];
  const isLoading = queries.some((query) => query.isLoading);
  const isFetching = queries.some((query) => query.isFetching);

  const jobs = useMemo<UnifiedJob[]>(() => {
    const merged: UnifiedJob[] = [
      ...(excelQuery.data ?? []).map(fromExcel),
      ...(scrapeQuery.data ?? []).map(fromScrape),
      ...(importQuery.data ?? []).map(fromImport),
      ...(enrichmentQuery.data ?? []).map(fromEnrichment),
    ];
    // Newest activity first; jobs without a timestamp sink to the bottom.
    return merged.sort((a, b) => {
      const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0;
      const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0;
      return bTime - aTime;
    });
  }, [excelQuery.data, scrapeQuery.data, importQuery.data, enrichmentQuery.data]);

  const counts = useMemo(() => {
    const base: Record<JobFilter, number> = {
      all: jobs.length,
      excel: 0,
      scrape: 0,
      import: 0,
      enrichment: 0,
    };
    for (const job of jobs) {
      base[job.kind] += 1;
    }
    return base;
  }, [jobs]);

  const filteredJobs =
    activeFilter === "all"
      ? jobs
      : jobs.filter((job) => job.kind === activeFilter);

  const refreshAll = () => {
    void Promise.all(queries.map((query) => query.refetch()));
  };

  return (
    <div className="">
      <section className="panel-raised p-2">
        <div className="flex flex-wrap items-start justify-between gap-1 border-b border-slate-400 pb-3">
          <div className="flex items-baseline gap-2">
            <h2 className="text-sm font-bold">Danh sách job</h2>
            <span className="stat-value text-2xl font-extrabold text-slate-900">
              {jobs.length}
            </span>
            <span className="ml-1 text-xs text-slate-700">job</span>
          </div>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            isLoading={isFetching}
            leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
            onClick={refreshAll}
          >
            Làm mới
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {(Object.keys(FILTER_LABEL) as JobFilter[]).map((filterKey) => (
            <button
              key={filterKey}
              type="button"
              onClick={() => setActiveFilter(filterKey)}
              className={`inline-flex min-h-10 items-center gap-2 rounded border px-3 py-1.5 text-xs font-semibold transition-colors duration-0 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none ${
                activeFilter === filterKey
                  ? "border-transparent text-white"
                  : "border-slate-400 bg-white text-slate-700 hover:bg-slate-50"
              }`}
              style={
                activeFilter === filterKey
                  ? { background: "linear-gradient(135deg, #0e7490, #0369a1)" }
                  : undefined
              }
            >
              <span>{FILTER_LABEL[filterKey]}</span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-xs ${
                  activeFilter === filterKey
                    ? "bg-white/20 text-white"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {counts[filterKey]}
              </span>
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="mt-6 flex items-center justify-center gap-2 text-sm text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Đang tải danh sách job…
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Chưa có job nào"
              description="Job sẽ xuất hiện ở đây khi bạn chạy scrape shop, nhập catalog, đối chiếu Excel hoặc enrich vật tư."
            />
          </div>
        ) : (
          <div className="mt-4 divide-y divide-slate-100 rounded border border-slate-400">
            {filteredJobs.map((job) => (
              <JobRow
                key={`${job.kind}-${job.id}`}
                job={job}
                onOpen={
                  job.href ? () => router.push(job.href!) : undefined
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function JobRow({
  job,
  onOpen,
}: {
  job: UnifiedJob;
  onOpen?: () => void;
}) {
  const active = isActive(job.status);
  const pct = progressPercent(job.processed, job.total);
  const statusTone = STATUS_TONE[job.status] ?? "neutral";
  const statusLabel = STATUS_LABEL[job.status] ?? job.status;

  const body = (
    <>
      <div className="flex items-center gap-2">
        <Badge tone={KIND_TONE[job.kind]}>{KIND_LABEL[job.kind]}</Badge>
        <p className="truncate text-sm font-semibold text-slate-900">
          {job.title}
        </p>
      </div>
      <p className="mt-0.5 truncate text-xs text-slate-700">
        {job.subtitle} · {formatDateTime(job.updatedAt)}
      </p>
      {job.counts &&
      (job.counts.matched ||
        job.counts.needsReview ||
        job.counts.error) ? (
        <div className="mt-1 flex flex-wrap gap-1.5 text-xs font-semibold">
          {job.counts.matched ? (
            <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-emerald-700 tabular-nums">
              {job.counts.matched.toLocaleString("vi-VN")} khớp
            </span>
          ) : null}
          {job.counts.needsReview ? (
            <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-amber-700 tabular-nums">
              {job.counts.needsReview.toLocaleString("vi-VN")} cần duyệt
            </span>
          ) : null}
          {job.counts.error ? (
            <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-rose-700 tabular-nums">
              {job.counts.error.toLocaleString("vi-VN")} lỗi
            </span>
          ) : null}
        </div>
      ) : null}
      {active && job.total > 0 ? (
        <div className="mt-2 max-w-xs">
          <div className="flex justify-between text-xs font-semibold text-blue-800">
            <span>Đang chạy</span>
            <span className="tabular-nums">
              {job.processed.toLocaleString("vi-VN")}/
              {job.total.toLocaleString("vi-VN")}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-blue-100">
            <div
              className="h-full rounded-full bg-blue-600"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      ) : job.total > 0 ? (
        <p className="mt-1 text-xs text-slate-700 tabular-nums">
          {job.processed.toLocaleString("vi-VN")}/
          {job.total.toLocaleString("vi-VN")}
        </p>
      ) : null}
    </>
  );

  return (
    <div className="flex flex-wrap items-center justify-between gap-1 p-3 hover:bg-slate-50">
      {onOpen ? (
        <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen}>
          {body}
        </button>
      ) : (
        <div className="min-w-0 flex-1">{body}</div>
      )}
      <Badge tone={statusTone}>
        {active ? (
          <Loader2 className="mr-1 inline h-3 w-3 animate-spin" aria-hidden />
        ) : null}
        {statusLabel}
      </Badge>
    </div>
  );
}
