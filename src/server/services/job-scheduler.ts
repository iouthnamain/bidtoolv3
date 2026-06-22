import "server-only";

import { and, asc, eq, isNotNull, lt, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { db } from "~/server/db";
import { shopImportJobs, shopScrapeJobs, excelResearchJobs, materialEnrichmentJobs } from "~/server/db/schema";
import { hasDatabaseUrl, isServerlessRuntime } from "~/server/runtime";
import { sanitizeScrapedProductList } from "~/lib/materials/shop-promo-badges";
import {
  scrapeShopMaterialsFromUrl,
  type ScrapedShopProduct,
  type ShopScrapeProgress,
} from "~/server/services/shop-material-scraper";
import type { ShopImportJobProgress } from "~/server/services/shop-import-jobs";
import { importScrapedProducts } from "~/server/services/shop-product-importer";
import {
  resolveScrapeMaxConcurrentJobs,
  resolveScrapeMaxConcurrentPages,
  resolveImportMaxConcurrentJobs,
  resolveEnrichmentMaxConcurrentJobs,
  resolveExcelResearchMaxConcurrentJobs,
  resolveScrapeJobTtlDays,
} from "~/server/services/app-settings";
import {
  processJobBatch,
  resetStaleExcelResearchRows,
} from "~/server/services/excel-research/process-batch";
import {
  processEnrichmentJob,
  type MaterialEnrichmentJobProgress,
} from "~/server/services/material-enrichment-runner";
import { createLogger, traceFn } from "~/server/lib/logger";

const log = createLogger("job-scheduler");

type ShopScrapeJobRow = typeof shopScrapeJobs.$inferSelect;
type ShopImportJobRow = typeof shopImportJobs.$inferSelect;
type MaterialEnrichmentJobRow = typeof materialEnrichmentJobs.$inferSelect;
type TimerHandle = ReturnType<typeof setInterval>;

const SCHEDULER_POLL_MS = 1_000;
const PROGRESS_WRITE_MS = 2_000;
const CLEANUP_POLL_MS = 60 * 60_000;
const activeScrapeRuns = new Map<string, AbortController>();
const activeImportRuns = new Map<string, AbortController>();
const activeEnrichmentRuns = new Map<string, AbortController>();
const activeExcelResearchRuns = new Set<string>();

let schedulerStarted = false;
let pollTimer: TimerHandle | null = null;
let cleanupTimer: TimerHandle | null = null;
let pollInFlight = false;

function _startJobScheduler() {
  if (schedulerStarted) {
    return;
  }
  if (!hasDatabaseUrl() || isServerlessRuntime()) {
    return;
  }

  schedulerStarted = true;
  log.info("scheduler_started", {
    pollIntervalMs: SCHEDULER_POLL_MS,
    cleanupIntervalMs: CLEANUP_POLL_MS,
  });
  void initializeScheduler();
  pollTimer = setInterval(() => {
    void pollScheduler();
  }, SCHEDULER_POLL_MS);
  cleanupTimer = setInterval(() => {
    void cleanupExpiredJobs();
  }, CLEANUP_POLL_MS);
  pollTimer.unref?.();
  cleanupTimer.unref?.();
}

function _stopJobSchedulerForTests() {
  if (pollTimer) {
    clearInterval(pollTimer);
  }
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
  }
  for (const controller of activeScrapeRuns.values()) {
    controller.abort();
  }
  for (const controller of activeImportRuns.values()) {
    controller.abort();
  }
  for (const controller of activeEnrichmentRuns.values()) {
    controller.abort();
  }
  activeScrapeRuns.clear();
  activeImportRuns.clear();
  activeEnrichmentRuns.clear();
  activeExcelResearchRuns.clear();
  pollTimer = null;
  cleanupTimer = null;
  pollInFlight = false;
  schedulerStarted = false;
}

function _abortShopScrapeJob(jobId: string) {
  activeScrapeRuns.get(jobId)?.abort();
}

function _isShopScrapeJobActivelyRunning(jobId: string) {
  return activeScrapeRuns.has(jobId);
}

function _abortShopImportJob(jobId: string) {
  activeImportRuns.get(jobId)?.abort();
}

function _abortMaterialEnrichmentJob(jobId: string) {
  activeEnrichmentRuns.get(jobId)?.abort();
}

async function _runJobSchedulerTickForTests() {
  await pollScheduler();
}

async function initializeScheduler() {
  try {
    await resetStaleRunningJobs();
    await resetStaleExcelResearchRows();
    await cleanupExpiredJobs();
    await pollScheduler();
  } catch (error) {
    log.error("scheduler_init_failed", { error });
  }
}

async function pollScheduler() {
  if (pollInFlight) {
    return;
  }

  pollInFlight = true;
  try {
    await Promise.all([
      fillScrapeSlots(),
      fillImportSlots(),
      fillEnrichmentSlots(),
      fillExcelResearchSlots(),
    ]);
  } catch (error) {
    log.error("scheduler_poll_failed", { error });
  } finally {
    pollInFlight = false;
  }
}

async function fillScrapeSlots() {
  const limit = await resolveScrapeMaxConcurrentJobs();
  while (activeScrapeRuns.size < limit) {
    const job = await claimNextScrapeJob();
    if (!job) {
      return;
    }
    void runScrapeJob(job);
  }
}

async function fillImportSlots() {
  const limit = await resolveImportMaxConcurrentJobs();
  while (activeImportRuns.size < limit) {
    const job = await claimNextImportJob();
    if (!job) {
      return;
    }
    void runImportJob(job);
  }
}

async function fillEnrichmentSlots() {
  const limit = await resolveEnrichmentMaxConcurrentJobs();
  while (activeEnrichmentRuns.size < limit) {
    const job = await claimNextEnrichmentJob();
    if (!job) {
      return;
    }
    void runEnrichmentJob(job);
  }
}

async function fillExcelResearchSlots() {
  const limit = await resolveExcelResearchMaxConcurrentJobs();
  while (activeExcelResearchRuns.size < limit) {
    const jobId = await claimNextExcelResearchJob();
    if (!jobId) {
      return;
    }
    void runExcelResearchJob(jobId);
  }
}

async function claimNextExcelResearchJob() {
  const [job] = await db
    .select({ id: excelResearchJobs.id })
    .from(excelResearchJobs)
    .where(eq(excelResearchJobs.status, "running"))
    .orderBy(asc(excelResearchJobs.startedAt))
    .limit(1);

  if (!job || activeExcelResearchRuns.has(job.id)) {
    return null;
  }

  return job.id;
}

async function runExcelResearchJob(jobId: string) {
  activeExcelResearchRuns.add(jobId);
  log.info("job_started", { jobType: "excel_research", jobId });
  try {
    while (true) {
      const [job] = await db
        .select({ status: excelResearchJobs.status })
        .from(excelResearchJobs)
        .where(eq(excelResearchJobs.id, jobId))
        .limit(1);

      if (job?.status !== "running") {
        break;
      }

      const remaining = await processJobBatch(jobId);
      if (remaining === 0) {
        const now = new Date().toISOString();
        const [snapshot] = await db
          .select({
            needsReviewRows: excelResearchJobs.needsReviewRows,
          })
          .from(excelResearchJobs)
          .where(eq(excelResearchJobs.id, jobId))
          .limit(1);

        const nextStatus =
          (snapshot?.needsReviewRows ?? 0) > 0
            ? "awaiting_review"
            : "completed";

        await db
          .update(excelResearchJobs)
          .set({
            status: nextStatus,
            finishedAt: now,
            message:
              nextStatus === "awaiting_review"
                ? "Hoàn tất — còn dòng cần duyệt."
                : "Hoàn tất nghiên cứu.",
            updatedAt: now,
            lastProgressAt: now,
          })
          .where(eq(excelResearchJobs.id, jobId));
        log.info("job_completed", {
          jobType: "excel_research",
          jobId,
          status: nextStatus,
        });
        break;
      }
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Lỗi không xác định.";
    log.warn("job_failed", { jobType: "excel_research", jobId, error });
    await db
      .update(excelResearchJobs)
      .set({
        status: "failed",
        error: message,
        message: "Job nghiên cứu thất bại.",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(excelResearchJobs.id, jobId));
  } finally {
    activeExcelResearchRuns.delete(jobId);
  }
}

async function claimNextScrapeJob() {
  return db.transaction(async (tx) => {
    const [nextJob] = await tx
      .select()
      .from(shopScrapeJobs)
      .where(eq(shopScrapeJobs.status, "queued"))
      .orderBy(asc(shopScrapeJobs.startedAt))
      .limit(1)
      .for("update", { skipLocked: true });

    if (!nextJob) {
      return null;
    }

    const now = new Date().toISOString();
    const [claimed] = await tx
      .update(shopScrapeJobs)
      .set({
        status: "running",
        currentUrls: [],
        message: "Đang chạy scrape shop.",
        lastProgressAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(shopScrapeJobs.id, nextJob.id),
          eq(shopScrapeJobs.status, "queued"),
        ),
      )
      .returning();

    return claimed ?? null;
  });
}

async function claimNextImportJob() {
  return db.transaction(async (tx) => {
    const [nextJob] = await tx
      .select()
      .from(shopImportJobs)
      .where(eq(shopImportJobs.status, "queued"))
      .orderBy(asc(shopImportJobs.startedAt))
      .limit(1)
      .for("update", { skipLocked: true });

    if (!nextJob) {
      return null;
    }

    const now = new Date().toISOString();
    const [claimed] = await tx
      .update(shopImportJobs)
      .set({
        status: "running",
        currentProductName: null,
        currentSourceUrl: null,
        lastProgressAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(shopImportJobs.id, nextJob.id),
          eq(shopImportJobs.status, "queued"),
        ),
      )
      .returning();

    return claimed ?? null;
  });
}

async function claimNextEnrichmentJob() {
  return db.transaction(async (tx) => {
    const [nextJob] = await tx
      .select()
      .from(materialEnrichmentJobs)
      .where(eq(materialEnrichmentJobs.status, "queued"))
      .orderBy(asc(materialEnrichmentJobs.startedAt))
      .limit(1)
      .for("update", { skipLocked: true });

    if (!nextJob) {
      return null;
    }

    const now = new Date().toISOString();
    const [claimed] = await tx
      .update(materialEnrichmentJobs)
      .set({
        status: "running",
        currentMaterialId: null,
        currentMaterialName: null,
        message: "Đang chạy enrichment vật liệu.",
        lastProgressAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(materialEnrichmentJobs.id, nextJob.id),
          eq(materialEnrichmentJobs.status, "queued"),
        ),
      )
      .returning();

    return claimed ?? null;
  });
}

async function runScrapeJob(job: ShopScrapeJobRow) {
  const controller = new AbortController();
  activeScrapeRuns.set(job.id, controller);
  log.info("job_started", { jobType: "scrape", jobId: job.id, url: job.url });
  const progressWriter = createScrapeProgressWriter(job.id);
  const concurrentPages = await resolveScrapeMaxConcurrentPages();

  try {
    const result = await scrapeShopMaterialsFromUrl({
      url: job.url,
      maxPages: job.maxPages,
      maxProducts: job.maxProducts,
      method:
        job.method === "json_ld" || job.method === "dom_cards"
          ? job.method
          : "auto",
      detailEnrichment:
        job.detailEnrichment === "missing_fields" ? "missing_fields" : "none",
      concurrentPages,
      signal: controller.signal,
      onProgress: (progress) => {
        progressWriter.queue(progress);
      },
    });

    await progressWriter.flush();
    if (controller.signal.aborted || (await isJobCancelled("scrape", job.id))) {
      return;
    }

    const finishedAt = new Date().toISOString();
    await db
      .update(shopScrapeJobs)
      .set({
        status: "completed",
        currentUrls: [],
        pagesVisited: result.pagesVisited,
        failedPages: result.failedPages,
        products: result.products,
        productCount: result.products.length,
        queueLength: 0,
        durationMs: result.durationMs,
        stopReason: result.stopReason,
        message: shopScrapeStopReasonMessage(result.stopReason),
        error: null,
        finishedAt,
        lastProgressAt: finishedAt,
        expiresAt: await expiresAt(finishedAt),
        updatedAt: finishedAt,
      })
      .where(
        and(
          eq(shopScrapeJobs.id, job.id),
          eq(shopScrapeJobs.status, "running"),
        ),
      );
    log.info("job_completed", {
      jobType: "scrape",
      jobId: job.id,
      productCount: result.products.length,
      durationMs: result.durationMs,
      stopReason: result.stopReason,
    });
  } catch (error) {
    await progressWriter.flush();
    if (controller.signal.aborted || (await isJobCancelled("scrape", job.id))) {
      return;
    }

    const finishedAt = new Date().toISOString();
    const message = errorMessage(error, "Không thể scrape shop URL.");
    log.warn("job_failed", { jobType: "scrape", jobId: job.id, error });
    await db
      .update(shopScrapeJobs)
      .set({
        status: "failed",
        currentUrls: [],
        stopReason: isScrapeTimeoutMessage(message) ? "timeout" : "error",
        message,
        error: message,
        finishedAt,
        lastProgressAt: finishedAt,
        expiresAt: await expiresAt(finishedAt),
        durationMs: elapsedSql(finishedAt, shopScrapeJobs.startedAt),
        updatedAt: finishedAt,
      })
      .where(
        and(
          eq(shopScrapeJobs.id, job.id),
          eq(shopScrapeJobs.status, "running"),
        ),
      );
  } finally {
    activeScrapeRuns.delete(job.id);
  }
}

async function runImportJob(job: ShopImportJobRow) {
  const controller = new AbortController();
  activeImportRuns.set(job.id, controller);
  log.info("job_started", {
    jobType: "import",
    jobId: job.id,
    scrapeJobId: job.scrapeJobId,
  });
  const progressWriter = createImportProgressWriter(job.id);

  try {
    const products = await loadProductsForImportJob(job);
    const result = await importScrapedProducts(db, products, {
      signal: controller.signal,
      onProgress: (progress) => {
        progressWriter.queue(progress);
      },
    });

    await progressWriter.flush();
    if (controller.signal.aborted || (await isJobCancelled("import", job.id))) {
      return;
    }

    const finishedAt = new Date().toISOString();
    await db
      .update(shopImportJobs)
      .set({
        status: "completed",
        processed: products.length,
        total: products.length,
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        failed: result.failed,
        items: result.items,
        currentProductName: null,
        currentSourceUrl: null,
        error: null,
        finishedAt,
        lastProgressAt: finishedAt,
        expiresAt: await expiresAt(finishedAt),
        durationMs: elapsedSql(finishedAt, shopImportJobs.startedAt),
        updatedAt: finishedAt,
      })
      .where(
        and(
          eq(shopImportJobs.id, job.id),
          eq(shopImportJobs.status, "running"),
        ),
      );
    log.info("job_completed", {
      jobType: "import",
      jobId: job.id,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      failed: result.failed,
    });
  } catch (error) {
    await progressWriter.flush();
    if (controller.signal.aborted || (await isJobCancelled("import", job.id))) {
      return;
    }

    const finishedAt = new Date().toISOString();
    const message = errorMessage(error, "Không thể nhập catalog.");
    log.warn("job_failed", { jobType: "import", jobId: job.id, error });
    await db
      .update(shopImportJobs)
      .set({
        status: "failed",
        currentProductName: null,
        currentSourceUrl: null,
        error: message,
        finishedAt,
        lastProgressAt: finishedAt,
        expiresAt: await expiresAt(finishedAt),
        durationMs: elapsedSql(finishedAt, shopImportJobs.startedAt),
        updatedAt: finishedAt,
      })
      .where(
        and(
          eq(shopImportJobs.id, job.id),
          eq(shopImportJobs.status, "running"),
        ),
      );
  } finally {
    activeImportRuns.delete(job.id);
  }
}

async function runEnrichmentJob(job: MaterialEnrichmentJobRow) {
  const controller = new AbortController();
  activeEnrichmentRuns.set(job.id, controller);
  log.info("job_started", { jobType: "enrichment", jobId: job.id });
  const progressWriter = createEnrichmentProgressWriter(job.id);

  try {
    await processEnrichmentJob(job.id, {
      signal: controller.signal,
      onProgress: (progress) => {
        progressWriter.queue(progress);
      },
    });

    await progressWriter.flush();
    if (
      controller.signal.aborted ||
      (await isJobCancelled("enrichment", job.id))
    ) {
      return;
    }

    const finishedAt = new Date().toISOString();
    await db
      .update(materialEnrichmentJobs)
      .set({
        status: "completed",
        currentMaterialId: null,
        currentMaterialName: null,
        message: "Job enrichment đã hoàn tất.",
        error: null,
        finishedAt,
        lastProgressAt: finishedAt,
        expiresAt: await expiresAt(finishedAt),
        updatedAt: finishedAt,
      })
      .where(
        and(
          eq(materialEnrichmentJobs.id, job.id),
          eq(materialEnrichmentJobs.status, "running"),
        ),
      );
    log.info("job_completed", { jobType: "enrichment", jobId: job.id });
  } catch (error) {
    await progressWriter.flush();
    if (
      controller.signal.aborted ||
      (await isJobCancelled("enrichment", job.id))
    ) {
      return;
    }

    const finishedAt = new Date().toISOString();
    const message = errorMessage(error, "Không thể enrichment vật liệu.");
    log.warn("job_failed", { jobType: "enrichment", jobId: job.id, error });
    await db
      .update(materialEnrichmentJobs)
      .set({
        status: "failed",
        currentMaterialId: null,
        currentMaterialName: null,
        message,
        error: message,
        finishedAt,
        lastProgressAt: finishedAt,
        expiresAt: await expiresAt(finishedAt),
        updatedAt: finishedAt,
      })
      .where(
        and(
          eq(materialEnrichmentJobs.id, job.id),
          eq(materialEnrichmentJobs.status, "running"),
        ),
      );
  } finally {
    activeEnrichmentRuns.delete(job.id);
  }
}

function createScrapeProgressWriter(jobId: string) {
  let pendingProgress: ShopScrapeProgress | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let lastWriteAt = 0;
  let flushChain: Promise<void> = Promise.resolve();

  const flush = () => {
    if (!pendingProgress) {
      return flushChain;
    }

    const progress = pendingProgress;
    pendingProgress = null;
    lastWriteAt = Date.now();
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }

    flushChain = flushChain
      .catch(() => undefined)
      .then(async () => {
        const now = new Date().toISOString();
        await db
          .update(shopScrapeJobs)
          .set({
            currentUrls: progress.currentUrls,
            pagesVisited: progress.pagesVisited,
            failedPages: progress.failedPages,
            products: sanitizeScrapedProductList(progress.products ?? []),
            productCount: sanitizeScrapedProductList(progress.products ?? [])
              .length,
            queueLength: progress.queueLength,
            durationMs: progress.elapsedMs,
            stopReason: progress.stopReason,
            message: progress.message ?? scrapeProgressMessage(progress),
            lastProgressAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(shopScrapeJobs.id, jobId),
              eq(shopScrapeJobs.status, "running"),
            ),
          );
      });

    return flushChain;
  };

  return {
    queue(progress: ShopScrapeProgress) {
      pendingProgress = progress;
      if (Date.now() - lastWriteAt >= PROGRESS_WRITE_MS) {
        void flush();
        return;
      }
      if (!flushTimer) {
        flushTimer = setTimeout(() => {
          void flush();
        }, PROGRESS_WRITE_MS);
        flushTimer.unref?.();
      }
    },
    flush,
  };
}

function createImportProgressWriter(jobId: string) {
  let pendingProgress: ShopImportJobProgress | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let lastWriteAt = 0;
  let flushChain: Promise<void> = Promise.resolve();

  const flush = () => {
    if (!pendingProgress) {
      return flushChain;
    }

    const progress = pendingProgress;
    pendingProgress = null;
    lastWriteAt = Date.now();
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }

    flushChain = flushChain
      .catch(() => undefined)
      .then(async () => {
        const now = new Date().toISOString();
        await db
          .update(shopImportJobs)
          .set({
            processed: progress.processed,
            total: progress.total,
            created: progress.created,
            updated: progress.updated,
            skipped: progress.skipped,
            failed: progress.failed,
            items: progress.items,
            currentProductName: progress.currentProductName,
            currentSourceUrl: progress.currentSourceUrl,
            durationMs: elapsedSql(now, shopImportJobs.startedAt),
            lastProgressAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(shopImportJobs.id, jobId),
              eq(shopImportJobs.status, "running"),
            ),
          );
      });

    return flushChain;
  };

  return {
    queue(progress: ShopImportJobProgress) {
      pendingProgress = progress;
      if (Date.now() - lastWriteAt >= PROGRESS_WRITE_MS) {
        void flush();
        return;
      }
      if (!flushTimer) {
        flushTimer = setTimeout(() => {
          void flush();
        }, PROGRESS_WRITE_MS);
        flushTimer.unref?.();
      }
    },
    flush,
  };
}

function createEnrichmentProgressWriter(jobId: string) {
  let pendingProgress: MaterialEnrichmentJobProgress | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let lastWriteAt = 0;
  let flushChain: Promise<void> = Promise.resolve();

  const flush = () => {
    if (!pendingProgress) {
      return flushChain;
    }

    const progress = pendingProgress;
    pendingProgress = null;
    lastWriteAt = Date.now();
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }

    flushChain = flushChain
      .catch(() => undefined)
      .then(async () => {
        const now = new Date().toISOString();
        await db
          .update(materialEnrichmentJobs)
          .set({
            processed: progress.processed,
            total: progress.total,
            matched: progress.matched,
            needsReview: progress.needsReview,
            pdfsFound: progress.pdfsFound,
            pdfsGenerated: progress.pdfsGenerated,
            failed: progress.failed,
            currentMaterialId: progress.currentMaterialId,
            currentMaterialName: progress.currentMaterialName,
            message: progress.message ?? null,
            lastProgressAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(materialEnrichmentJobs.id, jobId),
              eq(materialEnrichmentJobs.status, "running"),
            ),
          );
      });

    return flushChain;
  };

  return {
    queue(progress: MaterialEnrichmentJobProgress) {
      pendingProgress = progress;
      if (Date.now() - lastWriteAt >= PROGRESS_WRITE_MS) {
        void flush();
        return;
      }
      if (!flushTimer) {
        flushTimer = setTimeout(() => {
          void flush();
        }, PROGRESS_WRITE_MS);
        flushTimer.unref?.();
      }
    },
    flush,
  };
}

async function loadProductsForImportJob(job: ShopImportJobRow) {
  const [scrapeJob] = await db
    .select({
      id: shopScrapeJobs.id,
      products: shopScrapeJobs.products,
    })
    .from(shopScrapeJobs)
    .where(eq(shopScrapeJobs.id, job.scrapeJobId))
    .limit(1);

  const products = Array.isArray(scrapeJob?.products)
    ? (scrapeJob.products as ScrapedShopProduct[])
    : [];
  const sourceUrls = job.productSourceUrls;
  if (!sourceUrls) {
    return products;
  }

  const sourceUrlSet = new Set(sourceUrls);
  return products.filter((product) => sourceUrlSet.has(product.sourceUrl));
}

async function isJobCancelled(
  type: "scrape" | "import" | "enrichment",
  jobId: string,
) {
  if (type === "scrape") {
    const [job] = await db
      .select({ status: shopScrapeJobs.status })
      .from(shopScrapeJobs)
      .where(eq(shopScrapeJobs.id, jobId))
      .limit(1);
    return job?.status === "cancelled";
  }

  if (type === "import") {
    const [job] = await db
      .select({ status: shopImportJobs.status })
      .from(shopImportJobs)
      .where(eq(shopImportJobs.id, jobId))
      .limit(1);
    return job?.status === "cancelled";
  }

  const [job] = await db
    .select({ status: materialEnrichmentJobs.status })
    .from(materialEnrichmentJobs)
    .where(eq(materialEnrichmentJobs.id, jobId))
    .limit(1);
  return job?.status === "cancelled";
}

async function resetStaleRunningJobs() {
  const now = new Date().toISOString();
  await Promise.all([
    db
      .update(shopScrapeJobs)
      .set({
        status: "queued",
        currentUrls: [],
        message:
          "Server vừa khởi động lại; job scrape được đưa lại vào hàng chờ.",
        lastProgressAt: now,
        updatedAt: now,
      })
      .where(eq(shopScrapeJobs.status, "running")),
    db
      .update(shopImportJobs)
      .set({
        status: "queued",
        currentProductName: null,
        currentSourceUrl: null,
        error: null,
        lastProgressAt: now,
        updatedAt: now,
      })
      .where(eq(shopImportJobs.status, "running")),
    db
      .update(materialEnrichmentJobs)
      .set({
        status: "queued",
        currentMaterialId: null,
        currentMaterialName: null,
        error: null,
        message:
          "Server vừa khởi động lại; job enrichment được đưa lại vào hàng chờ.",
        lastProgressAt: now,
        updatedAt: now,
      })
      .where(eq(materialEnrichmentJobs.status, "running")),
  ]);
}

async function cleanupExpiredJobs() {
  const now = new Date().toISOString();
  await db
    .delete(shopImportJobs)
    .where(
      and(
        isNotNull(shopImportJobs.expiresAt),
        lt(shopImportJobs.expiresAt, now),
      ),
    );
  await db
    .delete(shopScrapeJobs)
    .where(
      and(
        isNotNull(shopScrapeJobs.expiresAt),
        lt(shopScrapeJobs.expiresAt, now),
      ),
    );
  await db
    .delete(materialEnrichmentJobs)
    .where(
      and(
        isNotNull(materialEnrichmentJobs.expiresAt),
        lt(materialEnrichmentJobs.expiresAt, now),
      ),
    );
}

async function expiresAt(finishedAtIso: string) {
  const ttlDays = await resolveScrapeJobTtlDays();
  return new Date(
    new Date(finishedAtIso).getTime() + ttlDays * 86_400_000,
  ).toISOString();
}

function elapsedSql(finishedAtIso: string, startedAt: AnyPgColumn) {
  return sql<number>`greatest(0, floor(extract(epoch from (${finishedAtIso}::timestamptz - ${startedAt})) * 1000))::int`;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function isScrapeTimeoutMessage(message: string) {
  return message.toLowerCase().includes("quá thời gian");
}

function scrapeProgressMessage(progress: ShopScrapeProgress) {
  switch (progress.status) {
    case "starting":
      return "Đang khởi động browser scrape.";
    case "reading":
      return progress.currentUrls.length > 0
        ? `Đang đọc ${progress.currentUrls.join(", ")}`
        : "Đang đọc queue shop.";
    case "extracting":
      return progress.currentUrls.length > 0
        ? `Đang trích xuất sản phẩm từ ${progress.currentUrls.join(", ")}`
        : "Đang trích xuất sản phẩm.";
    case "complete":
      return progress.stopReason
        ? shopScrapeStopReasonMessage(progress.stopReason)
        : "Job scrape đã hoàn tất.";
  }
}

function shopScrapeStopReasonMessage(stopReason: string) {
  switch (stopReason) {
    case "queue_empty":
      return "Đã đọc hết pagination/queue trong cùng domain.";
    case "page_limit":
      return "Dừng vì đã đạt giới hạn trang đã chọn.";
    case "product_limit":
      return "Dừng vì đã đạt giới hạn sản phẩm đã chọn.";
    default:
      return "Job scrape đã hoàn tất.";
  }
}

export const startJobScheduler = traceFn(log, "startJobScheduler", _startJobScheduler);
export const stopJobSchedulerForTests = traceFn(log, "stopJobSchedulerForTests", _stopJobSchedulerForTests);
export const abortShopScrapeJob = traceFn(log, "abortShopScrapeJob", _abortShopScrapeJob);
export const isShopScrapeJobActivelyRunning = traceFn(log, "isShopScrapeJobActivelyRunning", _isShopScrapeJobActivelyRunning);
export const abortShopImportJob = traceFn(log, "abortShopImportJob", _abortShopImportJob);
export const abortMaterialEnrichmentJob = traceFn(log, "abortMaterialEnrichmentJob", _abortMaterialEnrichmentJob);
export const runJobSchedulerTickForTests = traceFn(log, "runJobSchedulerTickForTests", _runJobSchedulerTickForTests);
