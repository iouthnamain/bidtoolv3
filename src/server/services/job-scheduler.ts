import "server-only";

import { and, asc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { db } from "~/server/db";
import {
  shopImportJobs,
  shopScrapeJobs,
  excelResearchJobs,
  materialEnrichmentJobs,
  materialProfileSearchJobs,
  materialProfileSearchRuns,
} from "~/server/db/schema";
import { hasDatabaseUrl, isServerlessRuntime } from "~/server/runtime";
import { sanitizeScrapedProductList } from "~/lib/materials/shop-promo-badges";
import {
  loadScrapeJobProducts,
  replaceScrapeJobProducts,
} from "~/server/services/shop-scrape-job-products";
import {
  scrapeShopMaterialsFromUrl,
  type ShopScrapeProgress,
} from "~/server/services/shop-material-scraper";
import type { ShopImportJobProgress } from "~/server/services/shop-import-jobs";
import {
  importScrapedProducts,
  readImportJobProgress,
  reconcileImportJobProgress,
} from "~/server/services/shop-product-importer";
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
import {
  completeMaterialProfileSearchJob,
  failMaterialProfileSearchJob,
  processMaterialProfileSearchJob,
  type MaterialProfileSearchJobProgress,
} from "~/server/services/material-profile-search-jobs";
import { createLogger, traceFn } from "~/server/lib/logger";
import {
  markSchedulerPollFailed,
  markSchedulerPollSucceeded,
  setSchedulerState,
} from "~/server/services/scheduler-state";

const log = createLogger("job-scheduler");

type ShopScrapeJobRow = typeof shopScrapeJobs.$inferSelect;
type ShopImportJobRow = typeof shopImportJobs.$inferSelect;
type MaterialEnrichmentJobRow = typeof materialEnrichmentJobs.$inferSelect;
type MaterialProfileSearchJobRow =
  typeof materialProfileSearchJobs.$inferSelect;
type TimerHandle = ReturnType<typeof setInterval>;

export function cancelledImportRecoveryPatch(
  status: string,
  progress: ShopImportJobProgress | null,
  now: string,
) {
  if (status !== "cancelled" || !progress) {
    return null;
  }
  return { ...progress, updatedAt: now };
}

const SCHEDULER_POLL_MS = 1_000;
const PROGRESS_WRITE_MS = 2_000;
const CLEANUP_POLL_MS = 60 * 60_000;
const activeScrapeRuns = new Map<string, AbortController>();
const activeImportRuns = new Map<string, AbortController>();
const activeEnrichmentRuns = new Map<string, AbortController>();
const activeMaterialProfileSearchRuns = new Map<string, AbortController>();
const activeExcelResearchRuns = new Set<string>();

// R6 assumes one scheduler owner for this database. Durable leases and
// multi-owner coordination need a separate design before another worker starts
// claiming the same queue.
const STARTUP_RETRY_INITIAL_MS = 1_000;
const STARTUP_RETRY_MAX_MS = 30_000;
let schedulerEnabled = false;
let pollTimer: TimerHandle | null = null;
let cleanupTimer: TimerHandle | null = null;
let pollInFlight = false;
let startupAttempt: Promise<void> | null = null;
let startupRetryTimer: ReturnType<typeof setTimeout> | null = null;
let startupRetryCount = 0;

function _startJobScheduler() {
  if (!hasDatabaseUrl() || isServerlessRuntime()) {
    setSchedulerState("disabled");
    return;
  }
  if (schedulerEnabled || startupAttempt || startupRetryTimer) {
    return;
  }

  schedulerEnabled = true;
  startupRetryCount = 0;
  void beginSchedulerInitialization();
}

function _stopJobSchedulerForTests() {
  schedulerEnabled = false;
  if (pollTimer) {
    clearInterval(pollTimer);
  }
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
  }
  if (startupRetryTimer) {
    clearTimeout(startupRetryTimer);
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
  for (const controller of activeMaterialProfileSearchRuns.values()) {
    controller.abort();
  }
  activeScrapeRuns.clear();
  activeImportRuns.clear();
  activeEnrichmentRuns.clear();
  activeMaterialProfileSearchRuns.clear();
  activeExcelResearchRuns.clear();
  pollTimer = null;
  cleanupTimer = null;
  pollInFlight = false;
  startupAttempt = null;
  startupRetryTimer = null;
  startupRetryCount = 0;
  setSchedulerState("stopped");
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

function _abortMaterialProfileSearchJob(jobId: string) {
  activeMaterialProfileSearchRuns.get(jobId)?.abort();
}

async function _runJobSchedulerTickForTests() {
  await pollScheduler({ allowBeforeReady: true });
}

async function beginSchedulerInitialization() {
  if (startupAttempt) return startupAttempt;

  setSchedulerState("recovering", { lastError: null });
  startupAttempt = initializeScheduler()
    .then(() => {
      if (!schedulerEnabled) return;
      startupRetryCount = 0;
      setSchedulerState("ready");
      log.info("scheduler_started", {
        pollIntervalMs: SCHEDULER_POLL_MS,
        cleanupIntervalMs: CLEANUP_POLL_MS,
      });
      pollTimer = setInterval(() => {
        void pollScheduler();
      }, SCHEDULER_POLL_MS);
      cleanupTimer = setInterval(() => {
        void cleanupExpiredJobs().catch((error) => {
          log.warn("scheduler_cleanup_failed", { error });
        });
      }, CLEANUP_POLL_MS);
      pollTimer.unref?.();
      cleanupTimer.unref?.();
    })
    .catch((error) => {
      if (!schedulerEnabled) return;
      markSchedulerPollFailed(error);
      setSchedulerState("retrying", {
        lastError:
          error instanceof Error ? error.message : "scheduler init failed",
      });
      const delay = Math.min(
        STARTUP_RETRY_MAX_MS,
        STARTUP_RETRY_INITIAL_MS * 2 ** startupRetryCount,
      );
      startupRetryCount += 1;
      log.warn("scheduler_init_retry", { delayMs: delay, error });
      startupRetryTimer = setTimeout(() => {
        startupRetryTimer = null;
        void beginSchedulerInitialization();
      }, delay);
      startupRetryTimer.unref?.();
    })
    .finally(() => {
      startupAttempt = null;
    });
  return startupAttempt;
}

async function initializeScheduler() {
  if (!schedulerEnabled) return;
  try {
    await resetStaleRunningJobs();
    await resetStaleExcelResearchRows({ startup: true });
    // Cleanup is optional. A database outage while deleting expired history
    // must not keep claims paused after required recovery has succeeded.
    void cleanupExpiredJobs().catch((error) => {
      log.warn("scheduler_cleanup_failed", { error });
    });
    const polled = await pollScheduler({ allowBeforeReady: true });
    if (!polled) {
      throw new Error("Scheduler poll did not complete during startup.");
    }
  } catch (error) {
    log.error("scheduler_init_failed", { error });
    throw error;
  }
}

async function pollScheduler(options: { allowBeforeReady?: boolean } = {}) {
  if (!options.allowBeforeReady && !schedulerEnabled) {
    return false;
  }
  if (pollInFlight) {
    return true;
  }

  pollInFlight = true;
  try {
    await Promise.all([
      fillScrapeSlots(),
      fillImportSlots(),
      fillEnrichmentSlots(),
      fillMaterialProfileSearchSlots(),
      import("~/server/services/material-profile-scrape-jobs").then((service) =>
        service.advanceMaterialProfileScrapeJobs(),
      ),
      import("~/server/services/material-profile-material-batches").then(
        (service) => service.resumeMaterialProfileSaveBatches(),
      ),
      fillExcelResearchSlots(),
    ]);
    markSchedulerPollSucceeded();
    return true;
  } catch (error) {
    log.error("scheduler_poll_failed", { error });
    markSchedulerPollFailed(error);
    return false;
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

async function fillMaterialProfileSearchSlots() {
  const limit = 1;
  while (activeMaterialProfileSearchRuns.size < limit) {
    const job = await claimNextMaterialProfileSearchJob();
    if (!job) {
      return;
    }
    void runMaterialProfileSearchJob(job);
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

async function claimNextMaterialProfileSearchJob() {
  return db.transaction(async (tx) => {
    const [nextJob] = await tx
      .select()
      .from(materialProfileSearchJobs)
      .where(eq(materialProfileSearchJobs.status, "queued"))
      .orderBy(asc(materialProfileSearchJobs.startedAt))
      .limit(1)
      .for("update", { skipLocked: true });

    if (!nextJob) {
      return null;
    }

    const now = new Date().toISOString();
    const [claimed] = await tx
      .update(materialProfileSearchJobs)
      .set({
        status: "running",
        currentItemId: null,
        currentRowIndex: null,
        currentProductName: null,
        message: "Đang chạy tìm kiếm hồ sơ vật tư.",
        lastProgressAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(materialProfileSearchJobs.id, nextJob.id),
          eq(materialProfileSearchJobs.status, "queued"),
        ),
      )
      .returning();

    return claimed ?? null;
  });
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

        const [completed] = await db
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
          .where(
            and(
              eq(excelResearchJobs.id, jobId),
              eq(excelResearchJobs.status, "running"),
            ),
          )
          .returning({ id: excelResearchJobs.id });
        if (!completed) {
          log.info("job_completion_skipped", {
            jobType: "excel_research",
            jobId,
            reason: "state_changed",
          });
          break;
        }
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
      .where(
        and(
          eq(excelResearchJobs.id, jobId),
          eq(excelResearchJobs.status, "running"),
        ),
      );
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
      await persistLatestScrapeProgressProducts(
        job.id,
        progressWriter.latest(),
      );
      return;
    }

    const finishedAt = new Date().toISOString();
    const products = await replaceScrapeJobProducts(job.id, result.products);
    const target = job.maxProducts ?? products.length;
    const reachedTarget = products.length >= target;
    await db
      .update(shopScrapeJobs)
      .set({
        status: "completed",
        currentUrls: [],
        pagesVisited: result.pagesVisited,
        failedPages: result.failedPages,
        products: [],
        productCount: products.length,
        queueLength: 0,
        durationMs: result.durationMs,
        stopReason: result.stopReason,
        message: reachedTarget
          ? `Đã thu thập đủ ${products.length.toLocaleString("vi-VN")} sản phẩm.`
          : `Thu thập ${products.length.toLocaleString("vi-VN")}/${target.toLocaleString("vi-VN")} sản phẩm. ${shopScrapeStopReasonMessage(result.stopReason)}`,
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
      productCount: products.length,
      durationMs: result.durationMs,
      stopReason: result.stopReason,
    });
  } catch (error) {
    await progressWriter.flush();
    if (controller.signal.aborted || (await isJobCancelled("scrape", job.id))) {
      await persistLatestScrapeProgressProducts(
        job.id,
        progressWriter.latest(),
      );
      return;
    }

    const finishedAt = new Date().toISOString();
    const technicalMessage = errorMessage(error, "Không thể scrape shop URL.");
    const collected =
      (await persistLatestScrapeProgressProducts(
        job.id,
        progressWriter.latest(),
      )) ??
      progressWriter.latest()?.productCount ??
      0;
    const target = job.maxProducts ?? collected;
    const message = `Đã dừng sau ${collected.toLocaleString("vi-VN")}/${target.toLocaleString("vi-VN")} sản phẩm. Kiểm tra URL shop rồi thử lại.`;
    log.warn("job_failed", { jobType: "scrape", jobId: job.id, error });
    await db
      .update(shopScrapeJobs)
      .set({
        status: "failed",
        currentUrls: [],
        stopReason: isScrapeTimeoutMessage(technicalMessage)
          ? "timeout"
          : "error",
        message,
        error: technicalMessage,
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
    await importScrapedProducts(db, products, {
      signal: controller.signal,
      importJobId: job.id,
      scrapeJobId: job.scrapeJobId,
      mode: job.productSourceUrls === null ? "create_all" : "match_existing",
      onProgress: (progress) => {
        progressWriter.queue(progress);
      },
    });

    await progressWriter.flush();
    if (controller.signal.aborted || (await isJobCancelled("import", job.id))) {
      await reconcileImportJobProgress(db, job.id);
      return;
    }

    const durable = await finishImportJob(job.id, { status: "completed" });
    if (!durable) return;
    log.info("job_completed", {
      jobType: "import",
      jobId: job.id,
      created: durable.created,
      updated: durable.updated,
      skipped: durable.skipped,
      failed: durable.failed,
    });
  } catch (error) {
    await progressWriter.flush();
    if (controller.signal.aborted || (await isJobCancelled("import", job.id))) {
      await reconcileImportJobProgress(db, job.id);
      return;
    }

    const message = errorMessage(error, "Không thể nhập catalog.");
    log.warn("job_failed", { jobType: "import", jobId: job.id, error });
    await finishImportJob(job.id, { status: "failed", error: message });
  } finally {
    activeImportRuns.delete(job.id);
  }
}

async function finishImportJob(
  jobId: string,
  outcome: { status: "completed" } | { status: "failed"; error: string },
) {
  const finishedAt = new Date().toISOString();
  const expiry = await expiresAt(finishedAt);
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select({ status: shopImportJobs.status })
      .from(shopImportJobs)
      .where(eq(shopImportJobs.id, jobId))
      .for("update")
      .limit(1);
    if (job?.status !== "running") return null;
    // Keep reconciliation and terminal status under the product commit lock.
    const progress = await readImportJobProgress(tx, jobId);
    if (
      outcome.status === "completed" &&
      (!progress || progress.processed !== progress.total)
    ) {
      throw new Error(
        "Job nhập catalog còn sản phẩm chưa xử lý; không thể hoàn tất.",
      );
    }
    await tx
      .update(shopImportJobs)
      .set({
        ...progress,
        status: outcome.status,
        currentProductName: null,
        currentSourceUrl: null,
        error: outcome.status === "failed" ? outcome.error : null,
        finishedAt,
        lastProgressAt: finishedAt,
        expiresAt: expiry,
        durationMs: elapsedSql(finishedAt, shopImportJobs.startedAt),
        updatedAt: finishedAt,
      })
      .where(eq(shopImportJobs.id, jobId));
    return progress;
  });
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

async function runMaterialProfileSearchJob(job: MaterialProfileSearchJobRow) {
  const controller = new AbortController();
  activeMaterialProfileSearchRuns.set(job.id, controller);
  log.info("job_started", {
    jobType: "material_profile_search",
    jobId: job.id,
  });
  const progressWriter = createMaterialProfileSearchProgressWriter(job.id);

  try {
    await processMaterialProfileSearchJob(job.id, {
      signal: controller.signal,
      onProgress: (progress) => {
        progressWriter.queue(progress);
      },
    });

    await progressWriter.flush();
    if (
      controller.signal.aborted ||
      (await isJobCancelled("material_profile_search", job.id))
    ) {
      return;
    }

    await completeMaterialProfileSearchJob(job.id);
    log.info("job_completed", {
      jobType: "material_profile_search",
      jobId: job.id,
    });
  } catch (error) {
    await progressWriter.flush();
    if (
      controller.signal.aborted ||
      (await isJobCancelled("material_profile_search", job.id))
    ) {
      return;
    }

    log.warn("job_failed", {
      jobType: "material_profile_search",
      jobId: job.id,
      error,
    });
    await failMaterialProfileSearchJob(job.id, error);
  } finally {
    activeMaterialProfileSearchRuns.delete(job.id);
  }
}

function createScrapeProgressWriter(jobId: string) {
  let pendingProgress: ShopScrapeProgress | null = null;
  let latestProgress: ShopScrapeProgress | null = null;
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
            productCount: progress.productCount,
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
      latestProgress = progress;
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
    latest() {
      return latestProgress;
    },
  };
}

async function persistLatestScrapeProgressProducts(
  jobId: string,
  progress: ShopScrapeProgress | null,
) {
  if (!progress?.products?.length) {
    return null;
  }

  const products = await replaceScrapeJobProducts(
    jobId,
    sanitizeScrapedProductList(progress.products),
  );
  const now = new Date().toISOString();
  await db
    .update(shopScrapeJobs)
    .set({
      products: [],
      productCount: products.length,
      updatedAt: now,
    })
    .where(eq(shopScrapeJobs.id, jobId));
  return products.length;
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
        await reconcileImportJobProgress(db, jobId);
        const now = new Date().toISOString();
        await db
          .update(shopImportJobs)
          .set({
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

function createMaterialProfileSearchProgressWriter(jobId: string) {
  let pendingProgress: MaterialProfileSearchJobProgress | null = null;
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
          .update(materialProfileSearchJobs)
          .set({
            processed: progress.processed,
            total: progress.total,
            found: progress.found,
            partial: progress.partial,
            failed: progress.failed,
            skipped: progress.skipped,
            currentItemId: progress.currentItemId,
            currentRowIndex: progress.currentRowIndex,
            currentProductName: progress.currentProductName,
            message: progress.message ?? null,
            lastProgressAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(materialProfileSearchJobs.id, jobId),
              eq(materialProfileSearchJobs.status, "running"),
            ),
          );
      });

    return flushChain;
  };

  return {
    queue(progress: MaterialProfileSearchJobProgress) {
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

  const products = scrapeJob
    ? await loadScrapeJobProducts(scrapeJob.id, scrapeJob.products)
    : [];
  const sourceUrls = job.productSourceUrls;
  if (!sourceUrls) {
    return products;
  }

  const sourceUrlSet = new Set(sourceUrls);
  return products.filter((product) => sourceUrlSet.has(product.sourceUrl));
}

async function isJobCancelled(
  type: "scrape" | "import" | "enrichment" | "material_profile_search",
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

  if (type === "material_profile_search") {
    const [job] = await db
      .select({ status: materialProfileSearchJobs.status })
      .from(materialProfileSearchJobs)
      .where(eq(materialProfileSearchJobs.id, jobId))
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
  const results = await Promise.allSettled([
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
    db
      .update(materialProfileSearchJobs)
      .set({
        status: "queued",
        currentItemId: null,
        currentRowIndex: null,
        currentProductName: null,
        error: null,
        message:
          "Server vừa khởi động lại; job tìm kiếm hồ sơ vật tư được đưa lại vào hàng chờ.",
        lastProgressAt: now,
        updatedAt: now,
      })
      .where(eq(materialProfileSearchJobs.status, "running")),
    db
      .update(materialProfileSearchRuns)
      .set({
        status: "queued",
        errorMessage: null,
        updatedAt: now,
      })
      .where(eq(materialProfileSearchRuns.status, "running")),
  ]);
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => {
        const reason: unknown = failure.reason;
        return reason;
      }),
      "Scheduler startup recovery did not settle successfully.",
    );
  }
  await recoverInterruptedImportJobs(now);
}

async function recoverInterruptedImportJobs(now: string) {
  const jobs = await db
    .select({ id: shopImportJobs.id, status: shopImportJobs.status })
    .from(shopImportJobs)
    .where(inArray(shopImportJobs.status, ["running", "cancelled"]));
  for (const job of jobs) {
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ status: shopImportJobs.status })
        .from(shopImportJobs)
        .where(eq(shopImportJobs.id, job.id))
        .for("update")
        .limit(1);
      if (!current || !["running", "cancelled"].includes(current.status)) {
        return;
      }
      const progress = await readImportJobProgress(tx, job.id);
      // A cancellation can commit after a product ledger row but before the
      // process observes the terminal parent state. Reconcile those durable
      // counters while preserving cancellation; never requeue the job.
      if (current.status === "cancelled") {
        const patch = cancelledImportRecoveryPatch(
          current.status,
          progress,
          now,
        );
        if (patch) {
          await tx
            .update(shopImportJobs)
            .set(patch)
            .where(
              and(
                eq(shopImportJobs.id, job.id),
                eq(shopImportJobs.status, "cancelled"),
              ),
            );
        }
        return;
      }
      if (!progress) {
        await tx
          .update(shopImportJobs)
          .set({
            status: "failed",
            currentProductName: null,
            currentSourceUrl: null,
            error:
              "Job nhập bị gián đoạn trước khi có sổ kiểm kê; không tự động chạy lại để tránh tạo trùng. Hãy tạo một job nhập mới.",
            finishedAt: now,
            lastProgressAt: now,
            updatedAt: now,
          })
          .where(eq(shopImportJobs.id, job.id));
        return;
      }
      await tx
        .update(shopImportJobs)
        .set({
          ...progress,
          status: "queued",
          error: null,
          finishedAt: null,
          lastProgressAt: now,
          updatedAt: now,
        })
        .where(eq(shopImportJobs.id, job.id));
    });
  }
}

async function cleanupExpiredJobs() {
  await resetStaleExcelResearchRows();
  const now = new Date().toISOString();
  await import("~/server/services/material-profile-material-batches").then(
    (service) => service.cleanupExpiredMaterialProfileBatches(now),
  );
  await import("~/server/services/material-profile-scrape-jobs").then(
    (service) => service.cleanupExpiredMaterialProfileScrapeJobs(now),
  );
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
  await db
    .delete(materialProfileSearchJobs)
    .where(
      and(
        isNotNull(materialProfileSearchJobs.expiresAt),
        lt(materialProfileSearchJobs.expiresAt, now),
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
      return "Dừng ở ngưỡng an toàn của hệ thống.";
    case "product_limit":
      return "Đã thu thập đủ số sản phẩm yêu cầu.";
    default:
      return "Job scrape đã hoàn tất.";
  }
}

export const startJobScheduler = traceFn(
  log,
  "startJobScheduler",
  _startJobScheduler,
);
export const stopJobSchedulerForTests = traceFn(
  log,
  "stopJobSchedulerForTests",
  _stopJobSchedulerForTests,
);
export const abortShopScrapeJob = traceFn(
  log,
  "abortShopScrapeJob",
  _abortShopScrapeJob,
);
export const isShopScrapeJobActivelyRunning = traceFn(
  log,
  "isShopScrapeJobActivelyRunning",
  _isShopScrapeJobActivelyRunning,
);
export const abortShopImportJob = traceFn(
  log,
  "abortShopImportJob",
  _abortShopImportJob,
);
export const abortMaterialEnrichmentJob = traceFn(
  log,
  "abortMaterialEnrichmentJob",
  _abortMaterialEnrichmentJob,
);
export const abortMaterialProfileSearchJob = traceFn(
  log,
  "abortMaterialProfileSearchJob",
  _abortMaterialProfileSearchJob,
);
export const runShopScrapeJobForTests = traceFn(
  log,
  "runShopScrapeJobForTests",
  runScrapeJob,
);
export const fillShopScrapeSlotsForTests = traceFn(
  log,
  "fillShopScrapeSlotsForTests",
  fillScrapeSlots,
);
export const runJobSchedulerTickForTests = traceFn(
  log,
  "runJobSchedulerTickForTests",
  _runJobSchedulerTickForTests,
);
export const recoverInterruptedImportJobsForTests = traceFn(
  log,
  "recoverInterruptedImportJobsForTests",
  recoverInterruptedImportJobs,
);

export const runShopImportJobForTests = traceFn(
  log,
  "runShopImportJobForTests",
  runImportJob,
);
