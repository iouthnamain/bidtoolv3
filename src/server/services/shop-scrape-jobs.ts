import { randomUUID } from "node:crypto";

import {
  scrapeShopMaterialsFromUrl,
  type ScrapedShopProduct,
  type ShopScrapeProgress,
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
  maxPages: number;
  maxProducts: number;
  currentUrl: string | null;
  pagesVisited: string[];
  failedPages: Array<{ url: string; message: string }>;
  products: ScrapedShopProduct[];
  productCount: number;
  queueLength: number;
  durationMs: number | null;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
};

type ShopScrapeJob = ShopScrapeJobSnapshot & {
  abortController: AbortController;
};

const JOB_TTL_MS = 60 * 60_000;
const MAX_JOB_CACHE_SIZE = 50;
const jobs = new Map<string, ShopScrapeJob>();

export function startShopScrapeJob(input: {
  url: string;
  maxPages: number;
  maxProducts: number;
}) {
  cleanupExpiredJobs();

  const now = new Date().toISOString();
  const abortController = new AbortController();
  const job: ShopScrapeJob = {
    id: randomUUID(),
    status: "queued",
    url: input.url,
    maxPages: input.maxPages,
    maxProducts: input.maxProducts,
    currentUrl: null,
    pagesVisited: [],
    failedPages: [],
    products: [],
    productCount: 0,
    queueLength: 0,
    durationMs: null,
    startedAt: now,
    finishedAt: null,
    error: null,
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

export function cancelShopScrapeJob(jobId: string) {
  const job = jobs.get(jobId);
  if (!job) {
    return null;
  }

  if (job.status === "queued" || job.status === "running") {
    job.status = "cancelled";
    job.finishedAt = new Date().toISOString();
    job.durationMs = elapsedMs(job);
    job.abortController.abort();
  }

  return toSnapshot(job);
}

function runShopScrapeJob(job: ShopScrapeJob) {
  job.status = "running";
  return scrapeShopMaterialsFromUrl({
    url: job.url,
    maxPages: job.maxPages,
    maxProducts: job.maxProducts,
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
      job.finishedAt = new Date().toISOString();
      job.error = null;
    })
    .catch((error: unknown) => {
      if (job.status === "cancelled") {
        return;
      }

      job.status = "failed";
      job.error =
        error instanceof Error ? error.message : "Không thể scrape shop URL.";
      job.durationMs = elapsedMs(job);
      job.finishedAt = new Date().toISOString();
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
  if (progress.products) {
    job.products = progress.products;
  }
}

function toSnapshot(job: ShopScrapeJob): ShopScrapeJobSnapshot {
  return {
    id: job.id,
    status: job.status,
    url: job.url,
    maxPages: job.maxPages,
    maxProducts: job.maxProducts,
    currentUrl: job.currentUrl,
    pagesVisited: [...job.pagesVisited],
    failedPages: [...job.failedPages],
    products: [...job.products],
    productCount: job.productCount,
    queueLength: job.queueLength,
    durationMs: job.durationMs,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
  };
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
