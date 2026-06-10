import { randomUUID } from "node:crypto";

import {
  scrapeShopMaterialsFromUrl,
  type ScrapedShopProduct,
  type ShopScrapeMethod,
  type ShopScrapeProgress,
  type ShopScrapeStopReason,
} from "~/server/services/shop-material-scraper";

export type ShopScrapeJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type ShopScrapeJobSnapshot = {
  id: string;
  status: ShopScrapeJobStatus;
  url: string;
  scrapeMode: "limited" | "all";
  maxPages: number | null;
  maxProducts: number | null;
  method: ShopScrapeMethod;
  currentUrl: string | null;
  pagesVisited: string[];
  failedPages: Array<{ url: string; message: string }>;
  products: ScrapedShopProduct[];
  productCount: number;
  queueLength: number;
  durationMs: number | null;
  stopReason:
    | (ShopScrapeStopReason | "timeout" | "cancelled" | "error" | "expired")
    | null;
  message: string | null;
  lastProgressAt: string | null;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  isExpired: boolean;
};

type ShopScrapeJob = ShopScrapeJobSnapshot & {
  abortController: AbortController | null;
};

const JOB_TTL_MS = 60 * 60_000;
const MAX_JOB_CACHE_SIZE = 50;
const jobs = new Map<string, ShopScrapeJob>();

export function startShopScrapeJob(input: {
  url: string;
  scrapeMode: "limited" | "all";
  maxPages: number | null;
  maxProducts: number | null;
  method: ShopScrapeMethod;
}) {
  cleanupExpiredJobs();

  const now = new Date().toISOString();
  const abortController = new AbortController();
  const job: ShopScrapeJob = {
    id: randomUUID(),
    status: "queued",
    url: input.url,
    scrapeMode: input.scrapeMode,
    maxPages: input.maxPages,
    maxProducts: input.maxProducts,
    method: input.method,
    currentUrl: null,
    pagesVisited: [],
    failedPages: [],
    products: [],
    productCount: 0,
    queueLength: 0,
    durationMs: null,
    stopReason: null,
    message: "Đang xếp hàng chờ scrape.",
    lastProgressAt: null,
    startedAt: now,
    finishedAt: null,
    error: null,
    isExpired: false,
    abortController,
  };
  jobs.set(job.id, job);

  void runShopScrapeJob(job);

  return toSnapshot(job);
}

export function getShopScrapeJob(jobId: string) {
  cleanupExpiredJobs();
  const job = jobs.get(jobId);
  return job ? toSnapshot(job) : null;
}

export function createExpiredShopScrapeJobSnapshot(
  jobId: string,
): ShopScrapeJobSnapshot {
  const now = new Date().toISOString();
  const message = "Job scrape đã hết hạn hoặc không còn trên server.";
  return {
    id: jobId,
    status: "failed",
    url: "",
    scrapeMode: "limited",
    maxPages: null,
    maxProducts: null,
    method: "auto",
    currentUrl: null,
    pagesVisited: [],
    failedPages: [],
    products: [],
    productCount: 0,
    queueLength: 0,
    durationMs: null,
    stopReason: "expired",
    message,
    lastProgressAt: now,
    startedAt: now,
    finishedAt: now,
    error: message,
    isExpired: true,
  };
}

export function cancelShopScrapeJob(jobId: string) {
  const job = jobs.get(jobId);
  if (!job) {
    return null;
  }

  if (job.status === "queued" || job.status === "running") {
    job.status = "cancelled";
    job.finishedAt = new Date().toISOString();
    job.durationMs = elapsedMs(job);
    job.stopReason = "cancelled";
    job.message = "Job scrape đã bị hủy.";
    job.abortController?.abort();
    job.abortController = null;
  }

  return toSnapshot(job);
}

function runShopScrapeJob(job: ShopScrapeJob) {
  job.status = "running";
  return scrapeShopMaterialsFromUrl({
    url: job.url,
    maxPages: job.maxPages,
    maxProducts: job.maxProducts,
    method: job.method,
    signal: job.abortController.signal,
    onProgress: (progress) => updateJobProgress(job, progress),
  })
    .then((result) => {
      if (job.status === "cancelled") {
        return;
      }

      job.status = "completed";
      job.products = result.products;
      job.productCount = result.products.length;
      job.pagesVisited = result.pagesVisited;
      job.failedPages = result.failedPages;
      job.durationMs = result.durationMs;
      job.currentUrl = null;
      job.queueLength = 0;
      job.stopReason = result.stopReason;
      job.message = shopScrapeStopReasonMessage(result.stopReason);
      job.finishedAt = new Date().toISOString();
      job.error = null;
      job.abortController = null;
    })
    .catch((error: unknown) => {
      if (job.status === "cancelled") {
        return;
      }

      job.status = "failed";
      job.error = errorMessage(error);
      job.stopReason = isScrapeTimeoutMessage(job.error) ? "timeout" : "error";
      job.message = job.error;
      job.durationMs = elapsedMs(job);
      job.finishedAt = new Date().toISOString();
      job.abortController = null;
    });
}

function updateJobProgress(job: ShopScrapeJob, progress: ShopScrapeProgress) {
  if (job.status === "cancelled") {
    return;
  }

  job.status = "running";
  job.currentUrl = progress.currentUrl;
  job.pagesVisited = progress.pagesVisited;
  job.failedPages = progress.failedPages;
  job.productCount = progress.productCount;
  job.queueLength = progress.queueLength;
  job.durationMs = progress.elapsedMs;
  job.stopReason = progress.stopReason ?? job.stopReason;
  job.message = progress.message ?? scrapeProgressMessage(progress);
  job.lastProgressAt = new Date().toISOString();
  if (progress.products) {
    job.products = progress.products;
  }
}

function toSnapshot(job: ShopScrapeJob): ShopScrapeJobSnapshot {
  return {
    id: job.id,
    status: job.status,
    url: job.url,
    scrapeMode: job.scrapeMode,
    maxPages: job.maxPages,
    maxProducts: job.maxProducts,
    method: job.method,
    currentUrl: job.currentUrl,
    pagesVisited: [...job.pagesVisited],
    failedPages: [...job.failedPages],
    products: [...job.products],
    productCount: job.productCount,
    queueLength: job.queueLength,
    durationMs: job.durationMs,
    stopReason: job.stopReason,
    message: job.message,
    lastProgressAt: job.lastProgressAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
    isExpired: job.isExpired,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Không thể scrape shop URL.";
}

function isScrapeTimeoutMessage(message: string) {
  return message.toLowerCase().includes("quá thời gian");
}

function scrapeProgressMessage(progress: ShopScrapeProgress) {
  switch (progress.status) {
    case "starting":
      return "Đang khởi động browser scrape.";
    case "reading":
      return progress.currentUrl
        ? `Đang đọc ${progress.currentUrl}`
        : "Đang đọc queue shop.";
    case "extracting":
      return progress.currentUrl
        ? `Đang trích xuất sản phẩm từ ${progress.currentUrl}`
        : "Đang trích xuất sản phẩm.";
    case "complete":
      return progress.stopReason
        ? shopScrapeStopReasonMessage(progress.stopReason)
        : "Job scrape đã hoàn tất.";
  }
}

function shopScrapeStopReasonMessage(stopReason: ShopScrapeStopReason) {
  switch (stopReason) {
    case "queue_empty":
      return "Đã đọc hết pagination/queue trong cùng domain.";
    case "page_limit":
      return "Dừng vì đã đạt giới hạn trang đã chọn.";
    case "product_limit":
      return "Dừng vì đã đạt giới hạn sản phẩm đã chọn.";
  }
}

function elapsedMs(job: ShopScrapeJob) {
  return Date.now() - new Date(job.startedAt).getTime();
}

function cleanupExpiredJobs() {
  const now = Date.now();
  for (const [jobId, job] of jobs) {
    const referenceTime = job.finishedAt ?? job.startedAt;
    if (now - new Date(referenceTime).getTime() > JOB_TTL_MS) {
      jobs.delete(jobId);
    }
  }

  if (jobs.size <= MAX_JOB_CACHE_SIZE) {
    return;
  }

  const inactiveJobs = Array.from(jobs.entries())
    .filter(([, job]) => job.status !== "queued" && job.status !== "running")
    .sort(
      ([, a], [, b]) =>
        new Date(a.finishedAt ?? a.startedAt).getTime() -
        new Date(b.finishedAt ?? b.startedAt).getTime(),
    );

  for (const [jobId] of inactiveJobs) {
    if (jobs.size <= MAX_JOB_CACHE_SIZE) {
      break;
    }
    jobs.delete(jobId);
  }
}
