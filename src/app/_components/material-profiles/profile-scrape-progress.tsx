"use client";

import Link from "next/link";
import { RotateCcw, Square } from "lucide-react";

import { Button } from "~/app/_components/ui";
import {
  materialProfileScrapeFailureMessage,
  shouldHideMaterialProfileTechnicalDetail,
} from "~/lib/materials/profile-user-message";
import {
  isMaterialProfileScrapeProducerActive,
  materialProfileScrapeElapsedMs,
} from "~/lib/materials/profile-scrape-progress";

type ProgressJob = {
  status: string;
  processed: number;
  total: number;
  captured: number;
  needsReview: number;
  skipped: number;
  failed: number;
  currentRowIndex: number | null;
  currentProductName: string | null;
  message: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  lastProgressAt?: string | null;
  updatedAt?: string | null;
  childShopJob?: {
    status: string;
    pagesVisited: string[];
    productCount: number;
    durationMs: number | null;
    message: string | null;
  } | null;
};

type ProgressRun = {
  status: string;
  shopScrapeJobId: string | null;
  errorMessage: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  updatedAt?: string | null;
};

function shopStatusLabel(status: string) {
  if (status === "queued") return "đang chờ";
  if (status === "running") return "đang chạy";
  if (status === "completed") return "hoàn tất";
  if (status === "failed") return "thất bại";
  if (status === "cancelled") return "đã hủy";
  return status;
}

export function ProfileScrapeProgress({
  job,
  run,
  onCancel,
  onRetry,
  cancelling,
  retrying,
}: {
  job: ProgressJob;
  run?: ProgressRun | null;
  onCancel?: () => void;
  onRetry?: () => void;
  cancelling?: boolean;
  retrying?: boolean;
}) {
  const producerActive = isMaterialProfileScrapeProducerActive(job.status);
  const pct = job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0;
  const elapsedMs = materialProfileScrapeElapsedMs({
    job,
    run,
    childDurationMs: job.childShopJob?.durationMs,
  });
  const rawError =
    run?.errorMessage ??
    (job.failed > 0 ? (job.childShopJob?.message ?? job.message) : null);
  const statusMessage = rawError
    ? materialProfileScrapeFailureMessage(rawError)
    : (job.childShopJob?.message ?? job.message);
  const hasHiddenTechnicalDetail =
    rawError != null && shouldHideMaterialProfileTechnicalDetail(rawError);
  return (
    <section className="border-line bg-surface-2 grid gap-2 rounded-[var(--radius-panel)] border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="section-title">Tiến độ scrape</p>
          <p className="text-ink-1 text-sm font-semibold" aria-live="polite">
            {job.processed.toLocaleString("vi-VN")}/
            {job.total.toLocaleString("vi-VN")} dòng · {pct}%
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {run?.shopScrapeJobId ? (
            <Link
              href={`/materials/scrape/jobs/${run.shopScrapeJobId}`}
              className="text-brand focus-visible:ring-ring inline-flex min-h-10 items-center rounded px-2 text-xs font-semibold hover:underline focus-visible:ring-2 focus-visible:outline-none"
            >
              Mở job scrape gốc
            </Link>
          ) : null}
          {producerActive && onCancel ? (
            <Button
              variant="warning"
              size="sm"
              onClick={onCancel}
              isLoading={cancelling}
            >
              <Square aria-hidden /> Hủy
            </Button>
          ) : null}
          {(job.failed > 0 || run?.status === "failed") && onRetry ? (
            <Button
              variant="scrape"
              size="sm"
              onClick={onRetry}
              isLoading={retrying}
            >
              <RotateCcw aria-hidden /> Thử lại
            </Button>
          ) : null}
        </div>
      </div>
      <div className="bg-surface-3 h-2 overflow-hidden rounded-full">
        <div
          className="h-full bg-[var(--action-scrape)] transition-[width] motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={job.total}
          aria-valuenow={job.processed}
        />
      </div>
      <dl className="grid grid-cols-2 gap-1 text-xs sm:grid-cols-5">
        <div>
          <dt className="text-ink-3">Đã lấy</dt>
          <dd className="font-semibold tabular-nums">{job.captured}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Chờ chọn</dt>
          <dd className="font-semibold tabular-nums">{job.needsReview}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Bỏ qua</dt>
          <dd className="font-semibold tabular-nums">{job.skipped}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Lỗi</dt>
          <dd className="font-semibold tabular-nums">{job.failed}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Dòng hiện tại</dt>
          <dd className="font-semibold">
            {job.currentRowIndex == null ? "—" : `Dòng ${job.currentRowIndex}`}
            {job.currentProductName ? ` · ${job.currentProductName}` : ""}
          </dd>
        </div>
      </dl>
      <p className="text-ink-2 text-xs tabular-nums">
        {job.childShopJob
          ? `${job.childShopJob.pagesVisited.length} trang · ${job.childShopJob.productCount} sản phẩm · ${Math.round(elapsedMs / 1_000)} giây · job gốc ${shopStatusLabel(job.childShopJob.status)}`
          : `${Math.round(elapsedMs / 1_000)} giây`}
      </p>
      {statusMessage ? (
        <p
          className={rawError ? "text-critical text-xs" : "text-ink-2 text-xs"}
          role={rawError ? "alert" : undefined}
        >
          {statusMessage}
        </p>
      ) : null}
      {hasHiddenTechnicalDetail ? (
        <details className="border-line text-ink-3 rounded border px-2 py-1 text-xs">
          <summary className="focus-visible:ring-ring min-h-8 cursor-pointer py-1 font-semibold focus-visible:ring-2 focus-visible:outline-none">
            Chi tiết kỹ thuật
          </summary>
          <p className="mt-1 break-words whitespace-pre-wrap">{rawError}</p>
        </details>
      ) : null}
    </section>
  );
}
