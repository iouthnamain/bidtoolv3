import type { RouterOutputs } from "~/trpc/react";

export type ScrapeJob = RouterOutputs["material"]["getShopScrapeJob"];
export type ScrapeJobListItem =
  RouterOutputs["material"]["listShopScrapeJobs"][number];
export type ScrapedProduct = ScrapeJob["products"][number];
export type ScrapeMode = ScrapeJob["scrapeMode"];
export type ScrapeMethod = ScrapeJob["method"];
export type DetailEnrichmentMode = ScrapeJob["detailEnrichment"];
export type ImportJob = RouterOutputs["material"]["getShopImportJob"];
export type ImportJobProgress =
  RouterOutputs["material"]["getShopImportJobProgress"];
export type ImportShopItem = ImportJob["items"][number];

export const SHOP_SCRAPE_FOCUSED_JOB_STORAGE_KEY =
  "bidtool:shop-scrape-focused-job:v2";
export const EMPTY_UUID = "00000000-0000-4000-8000-000000000000";
export const SCRAPE_POLL_MS = 1_500;
export const IMPORT_POLL_MS = 1_000;
export const JOB_LIST_POLL_MS = 3_000;
export const ACTIVE_CLOCK_MS = 1_000;
export const SHOP_JOB_CACHE_MS = 60 * 60_000;
export const DEFAULT_MAX_PAGES = 25;
export const DEFAULT_MAX_PRODUCTS = 500;
export const MAX_PAGE_LIMIT = 100;
export const MAX_PRODUCT_LIMIT = 2_000;
export const IMPORTABLE_SCRAPE_STATUSES = [
  "completed",
  "failed",
  "cancelled",
] as const;
export const DEFAULT_PRODUCT_PAGE_SIZE = 25;
export const SCRAPE_JOBS_LIST_CAP = 100;

export function hostFromUrl(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

export function productKey(product: ScrapedProduct) {
  return product.sourceUrl;
}

export function shortJobId(jobId: string) {
  return jobId.slice(0, 8);
}

export function isJobActive(job: { status: ScrapeJob["status"] } | null | undefined) {
  return job?.status === "queued" || job?.status === "running";
}

export function isImportJobActive(
  job: { status: ImportJob["status"] } | null | undefined,
) {
  return job?.status === "queued" || job?.status === "running";
}

export function canImportJob(job: ScrapeJob | null | undefined) {
  return (
    !!job &&
    !job.isExpired &&
    IMPORTABLE_SCRAPE_STATUSES.includes(
      job.status as (typeof IMPORTABLE_SCRAPE_STATUSES)[number],
    ) &&
    job.products.length > 0
  );
}

export function formatMoney(value: number | null | undefined, currency = "VND") {
  if (value == null) {
    return "-";
  }
  return `${value.toLocaleString("vi-VN")} ${currency}`;
}

export function formatDuration(ms: number | null | undefined) {
  if (ms == null) {
    return "-";
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toLocaleString("vi-VN", {
      maximumFractionDigits: 1,
    })}s`;
  }
  return `${Math.floor(seconds / 60).toLocaleString("vi-VN")}m ${Math.round(
    seconds % 60,
  ).toLocaleString("vi-VN")}s`;
}

export function progressPercent(value: number, total: number | null | undefined) {
  if (total == null) {
    return null;
  }
  if (total <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((value / total) * 100));
}

export function progressWidth(percent: number | null, active: boolean) {
  if (percent != null) {
    return `${percent}%`;
  }
  return active ? "55%" : "100%";
}

export function readStoredJobId(storageKey: string) {
  try {
    return window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

export function writeStoredJobId(storageKey: string, jobId: string | null) {
  try {
    if (jobId) {
      window.localStorage.setItem(storageKey, jobId);
    } else {
      window.localStorage.removeItem(storageKey);
    }
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

export function isNotFoundTRPCError(error: unknown) {
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
