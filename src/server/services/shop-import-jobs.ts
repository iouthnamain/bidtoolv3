import { randomUUID } from "node:crypto";

import type { ScrapedShopProduct } from "~/server/services/shop-material-scraper";

export type ShopImportJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type ShopImportJobItem = {
  name: string;
  sourceUrl: string;
  action: "created" | "updated" | "skipped" | "failed";
  materialId?: number;
  message?: string;
};

export type ShopImportJobResult = {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  items: ShopImportJobItem[];
};

export type ShopImportJobProgress = ShopImportJobResult & {
  processed: number;
  total: number;
  currentProductName: string | null;
  currentSourceUrl: string | null;
};

export type ShopImportJobSnapshot = ShopImportJobProgress & {
  id: string;
  scrapeJobId: string;
  status: ShopImportJobStatus;
  durationMs: number | null;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
};

type ShopImportRunner = (input: {
  products: ScrapedShopProduct[];
  signal: AbortSignal;
  onProgress: (progress: ShopImportJobProgress) => void;
}) => Promise<ShopImportJobResult>;

type ShopImportJob = ShopImportJobSnapshot & {
  abortController: AbortController;
};

const JOB_TTL_MS = 60 * 60_000;
const MAX_JOB_CACHE_SIZE = 50;
const jobs = new Map<string, ShopImportJob>();

export function startShopImportJob(
  input: {
    scrapeJobId: string;
    products: ScrapedShopProduct[];
  },
  runner: ShopImportRunner,
) {
  cleanupExpiredJobs();

  const now = new Date().toISOString();
  const abortController = new AbortController();
  const job: ShopImportJob = {
    id: randomUUID(),
    scrapeJobId: input.scrapeJobId,
    status: "queued",
    processed: 0,
    total: input.products.length,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    items: [],
    currentProductName: null,
    currentSourceUrl: null,
    durationMs: null,
    startedAt: now,
    finishedAt: null,
    error: null,
    abortController,
  };
  jobs.set(job.id, job);

  void runShopImportJob(job, input.products, runner);

  return toSnapshot(job);
}

export function getShopImportJob(jobId: string) {
  cleanupExpiredJobs();
  const job = jobs.get(jobId);
  return job ? toSnapshot(job) : null;
}

export function cancelShopImportJob(jobId: string) {
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

function runShopImportJob(
  job: ShopImportJob,
  products: ScrapedShopProduct[],
  runner: ShopImportRunner,
) {
  job.status = "running";
  return runner({
    products,
    signal: job.abortController.signal,
    onProgress: (progress) => updateJobProgress(job, progress),
  })
    .then((result) => {
      if (job.status === "cancelled") {
        return;
      }

      job.status = "completed";
      job.processed = products.length;
      job.total = products.length;
      job.created = result.created;
      job.updated = result.updated;
      job.skipped = result.skipped;
      job.failed = result.failed;
      job.items = result.items;
      job.currentProductName = null;
      job.currentSourceUrl = null;
      job.durationMs = elapsedMs(job);
      job.finishedAt = new Date().toISOString();
      job.error = null;
    })
    .catch((error: unknown) => {
      if (job.status === "cancelled") {
        return;
      }

      job.status = "failed";
      job.error =
        error instanceof Error ? error.message : "Không thể nhập catalog.";
      job.durationMs = elapsedMs(job);
      job.finishedAt = new Date().toISOString();
    });
}

function updateJobProgress(
  job: ShopImportJob,
  progress: ShopImportJobProgress,
) {
  if (job.status === "cancelled") {
    return;
  }

  job.status = "running";
  job.processed = progress.processed;
  job.total = progress.total;
  job.created = progress.created;
  job.updated = progress.updated;
  job.skipped = progress.skipped;
  job.failed = progress.failed;
  job.items = progress.items;
  job.currentProductName = progress.currentProductName;
  job.currentSourceUrl = progress.currentSourceUrl;
  job.durationMs = elapsedMs(job);
}

function toSnapshot(job: ShopImportJob): ShopImportJobSnapshot {
  return {
    id: job.id,
    scrapeJobId: job.scrapeJobId,
    status: job.status,
    processed: job.processed,
    total: job.total,
    created: job.created,
    updated: job.updated,
    skipped: job.skipped,
    failed: job.failed,
    items: [...job.items],
    currentProductName: job.currentProductName,
    currentSourceUrl: job.currentSourceUrl,
    durationMs: job.durationMs,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
  };
}

function elapsedMs(job: ShopImportJob) {
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
