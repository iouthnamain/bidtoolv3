import "server-only";

import { randomUUID } from "node:crypto";

import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";

import { normalizeCatalogPdfUrl } from "~/lib/materials/catalog-pdf";
import {
  highestProfileScrapeSource,
  isProfilePdfSource,
  activateProfileCandidateCapture,
  profileCandidateSearchGeneration,
  removeProfileCandidateCapture,
  resolveProfileScrapedProduct,
  storeProfileCandidateCapture,
} from "~/lib/materials/profile-scrape-capture";
import type { ProfileScrapedProduct } from "~/lib/materials/profile-scrape-types";
import {
  serializeRowDecision,
  type RowDecision,
} from "~/lib/materials/review-decision";
import { searchCandidateKey } from "~/lib/materials/search-candidate-match";
import { db } from "~/server/db";
import {
  excelWorkspaceItems,
  excelWorkspaces,
  materialProfileScrapeJobs,
  materialProfileScrapeRuns,
} from "~/server/db/schema";
import { ShopJobServiceError } from "~/server/services/shop-job-errors";
import { assertSafeScrapeUrl } from "~/server/services/shop-material-scraper/url-safety";
import {
  cancelShopScrapeJob,
  getActiveShopScrapeJobByUrl,
  getShopScrapeJob,
  getShopScrapeJobProgress,
  startShopScrapeJob,
} from "~/server/services/shop-scrape-jobs";
import {
  materialProfileDecisionForItem,
  materialProfileDecisionsForItems,
} from "~/server/services/material-profile-review-decisions";

const ACTIVE_JOB_STATUSES = ["queued", "running", "awaiting_review"];
const ACTIVE_RUN_STATUSES = ["queued", "running", "awaiting_product_selection"];
const TERMINAL_RUN_STATUSES = ["completed", "skipped", "failed", "cancelled"];
const MAX_BATCH_ITEMS = 500;
const MAX_CONCURRENT_RUNS = 8;
const MAX_PRODUCTS = 8;
const HISTORY_DAYS = 30;
let advanceInFlight: Promise<void> | null = null;

type ScrapeJobRow = typeof materialProfileScrapeJobs.$inferSelect;
type ScrapeRunRow = typeof materialProfileScrapeRuns.$inferSelect;

export class MaterialProfileScrapeJobError extends Error {
  constructor(
    readonly code: "BAD_REQUEST" | "NOT_FOUND" | "CONFLICT",
    message: string,
  ) {
    super(message);
  }
}

function expiresAt(now: string) {
  return new Date(
    new Date(now).getTime() + HISTORY_DAYS * 86_400_000,
  ).toISOString();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function isMaterialProfileScrapeInputCurrent(input: {
  snapshot: unknown;
  currentUpdatedAt: string;
  currentMaterialId: number | null;
  currentSourceFingerprint: string;
  runSourceFingerprint: string;
  currentSearchGeneration: unknown;
}) {
  const snapshot = recordOf(input.snapshot);
  return (
    input.currentSourceFingerprint === input.runSourceFingerprint &&
    input.currentSearchGeneration === snapshot.searchGeneration &&
    (!("materialId" in snapshot) ||
      input.currentMaterialId === snapshot.materialId)
  );
}

function runOwnsChild(run: ScrapeRunRow) {
  return run.childOwned;
}

function sourceForDecision(
  decision: RowDecision,
  options: {
    explicitSourceUrl?: string;
    explicitSourceCandidateKey?: string;
    interactive: boolean;
  },
) {
  const links = [...(decision.webLinkResults ?? [])].sort(
    (left, right) => (right.rankScore ?? 0) - (left.rankScore ?? 0),
  );
  const explicitUrl = options.explicitSourceUrl?.trim();
  const selectedKey = options.interactive
    ? options.explicitSourceCandidateKey?.trim()
    : undefined;
  const selectedUrl = options.interactive
    ? [
        explicitUrl,
        selectedKey?.startsWith("web:") ? selectedKey.slice(4) : undefined,
        decision.selectedSearchCandidateKey?.startsWith("web:")
          ? decision.selectedSearchCandidateKey.slice(4)
          : undefined,
      ].find(Boolean)
    : undefined;
  const source = selectedUrl
    ? links.find((link) => link.url === selectedUrl)
    : highestProfileScrapeSource(links);

  if (!source) {
    return {
      decision,
      error: "Chưa có nguồn web đã chọn cho dòng này.",
    } as const;
  }
  if (isProfilePdfSource(source.url)) {
    return {
      decision,
      error:
        "Nguồn PDF dùng thao tác “Dùng catalog PDF”, không chạy scraper HTML.",
    } as const;
  }
  return { decision, source, error: null } as const;
}

async function requireWorkspace(workspaceId: number) {
  const [workspace] = await db
    .select({ id: excelWorkspaces.id })
    .from(excelWorkspaces)
    .where(eq(excelWorkspaces.id, workspaceId))
    .limit(1);
  if (!workspace) {
    throw new MaterialProfileScrapeJobError(
      "NOT_FOUND",
      "Không tìm thấy hồ sơ vật tư.",
    );
  }
}

async function loadItems(workspaceId: number, itemIds: number[]) {
  if (itemIds.length === 0 || itemIds.length > MAX_BATCH_ITEMS) {
    throw new MaterialProfileScrapeJobError(
      "BAD_REQUEST",
      `Chọn từ 1 đến ${MAX_BATCH_ITEMS} dòng để scrape.`,
    );
  }
  const uniqueIds = [...new Set(itemIds)];
  const items = await db
    .select()
    .from(excelWorkspaceItems)
    .where(
      and(
        eq(excelWorkspaceItems.workspaceId, workspaceId),
        inArray(excelWorkspaceItems.id, uniqueIds),
      ),
    )
    .orderBy(asc(excelWorkspaceItems.sortOrder));
  if (items.length !== uniqueIds.length) {
    throw new MaterialProfileScrapeJobError(
      "BAD_REQUEST",
      "Một hoặc nhiều dòng không thuộc hồ sơ vật tư này.",
    );
  }
  return items;
}

export async function startMaterialProfileScrapeJob(input: {
  workspaceId: number;
  itemIds: number[];
  interactive?: boolean;
  sourceUrl?: string;
  sourceCandidateKey?: string;
}) {
  await requireWorkspace(input.workspaceId);
  const items = await loadItems(input.workspaceId, input.itemIds);
  if (input.interactive && items.length !== 1) {
    throw new MaterialProfileScrapeJobError(
      "BAD_REQUEST",
      "Scrape tương tác chỉ nhận một dòng.",
    );
  }

  const now = new Date().toISOString();
  const jobId = randomUUID();
  const decisions = await materialProfileDecisionsForItems(items);
  const runValues = await Promise.all(
    items.map(async (item, sortOrder) => {
      const decision =
        decisions.get(item.id) ?? (await materialProfileDecisionForItem(item));
      const selected = sourceForDecision(decision, {
        explicitSourceUrl: input.sourceUrl,
        explicitSourceCandidateKey: input.sourceCandidateKey,
        interactive: input.interactive === true,
      });
      const selectedSource = "source" in selected ? selected.source : undefined;
      let source = selectedSource;
      let sourceError: string | null = selected.error;
      if (source) {
        try {
          await assertSafeScrapeUrl(source.url);
        } catch (error) {
          sourceError =
            error instanceof Error
              ? error.message
              : "URL nguồn không an toàn hoặc không hợp lệ.";
          source = undefined;
        }
      }
      if (input.interactive && !source) {
        throw new MaterialProfileScrapeJobError(
          "BAD_REQUEST",
          sourceError ?? "Nguồn web không hợp lệ.",
        );
      }
      return {
        id: randomUUID(),
        jobId,
        workspaceId: input.workspaceId,
        itemId: item.id,
        originalRowIndex: item.originalRowIndex,
        sortOrder,
        status: source ? "queued" : "skipped",
        sourceCandidateKey: source
          ? searchCandidateKey("web", source.url)
          : input.sourceCandidateKey,
        sourceUrl:
          source?.url ?? selectedSource?.url ?? input.sourceUrl ?? null,
        sourceKind: source ? "html" : null,
        sourceScore: source?.rankScore ?? null,
        inputSnapshotJson: {
          productName: item.productName,
          code: selected.decision.editedValues?.code ?? null,
          searchGeneration: profileCandidateSearchGeneration(selected.decision),
          itemUpdatedAt: item.updatedAt,
          materialId: item.materialId,
        },
        sourceFingerprint: item.sourceFingerprint,
        warningsJson: source || !sourceError ? [] : [sourceError],
        errorMessage: source ? null : sourceError,
        startedAt: source ? null : now,
        finishedAt: source ? null : now,
        updatedAt: now,
      };
    }),
  );

  if (input.interactive) {
    const run = runValues[0];
    if (run?.sourceCandidateKey) {
      const [duplicate] = await db
        .select({ id: materialProfileScrapeRuns.id })
        .from(materialProfileScrapeRuns)
        .where(
          and(
            eq(materialProfileScrapeRuns.workspaceId, input.workspaceId),
            eq(materialProfileScrapeRuns.itemId, run.itemId),
            eq(
              materialProfileScrapeRuns.sourceCandidateKey,
              run.sourceCandidateKey,
            ),
            inArray(materialProfileScrapeRuns.status, ["queued", "running"]),
          ),
        )
        .limit(1);
      if (duplicate) {
        throw new MaterialProfileScrapeJobError(
          "CONFLICT",
          "Nguồn này đang được scrape cho dòng vật tư.",
        );
      }
    }
  }

  await db.transaction(async (tx) => {
    await tx.insert(materialProfileScrapeJobs).values({
      id: jobId,
      workspaceId: input.workspaceId,
      status: "queued",
      requestedItemIds: items.map((item) => item.id),
      total: items.length,
      skipped: runValues.filter((run) => run.status === "skipped").length,
      message: "Đang xếp hàng scrape nguồn web.",
      startedAt: now,
      lastProgressAt: now,
      expiresAt: expiresAt(now),
      updatedAt: now,
    });
    await tx.insert(materialProfileScrapeRuns).values(runValues);
  });
  await advanceMaterialProfileScrapeJobs();
  return getMaterialProfileScrapeJob(jobId, input.workspaceId);
}

function asProfileProduct(value: unknown): ProfileScrapedProduct | null {
  if (!value || typeof value !== "object") return null;
  const product = value as Partial<ProfileScrapedProduct>;
  if (!product.name || !product.sourceUrl) return null;
  const currency = product.currency?.trim();
  return {
    name: product.name,
    unit: product.unit ?? null,
    category: product.category ?? null,
    specText: product.specText ?? "",
    manufacturer: product.manufacturer ?? null,
    originCountry: product.originCountry ?? null,
    price: product.price ?? null,
    priceText: product.priceText ?? null,
    currency: currency?.length ? currency : "VND",
    sourceUrl: product.sourceUrl,
    imageUrl: product.imageUrl ?? null,
    sku: product.sku ?? null,
    model: product.model ?? null,
    shopCategory: product.shopCategory ?? null,
    catalogPdfUrls: Array.isArray(product.catalogPdfUrls)
      ? product.catalogPdfUrls
      : [],
  };
}

function productsFromJson(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const product = asProfileProduct(entry);
        return product ? [product] : [];
      })
    : [];
}

function unionCatalogPdfUrls(values: string[]) {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const trimmed = value.trim();
    const key = normalizeCatalogPdfUrl(trimmed) ?? trimmed;
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [trimmed];
  });
}

async function applySelectedProduct(
  run: ScrapeRunRow,
  product: ProfileScrapedProduct,
  productMatchScore: number | null,
  activate: boolean,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [item] = await db
      .select()
      .from(excelWorkspaceItems)
      .where(
        and(
          eq(excelWorkspaceItems.id, run.itemId),
          eq(excelWorkspaceItems.workspaceId, run.workspaceId),
        ),
      )
      .limit(1);
    if (!item)
      return { status: "skipped", error: "Dòng hồ sơ không còn tồn tại." };
    const decision = await materialProfileDecisionForItem(item);
    const snapshot = recordOf(run.inputSnapshotJson);
    if (
      !isMaterialProfileScrapeInputCurrent({
        snapshot,
        currentUpdatedAt: item.updatedAt,
        currentMaterialId: item.materialId,
        currentSourceFingerprint: item.sourceFingerprint,
        runSourceFingerprint: run.sourceFingerprint,
        currentSearchGeneration: profileCandidateSearchGeneration(decision),
      })
    ) {
      return {
        status: "skipped",
        error:
          "Dòng hoặc nguồn web đã thay đổi trong lúc scrape; kết quả cũ không được áp dụng.",
      };
    }
    const source = decision.webLinkResults?.find(
      (link) => link.url === run.sourceUrl,
    );
    if (!source) {
      return {
        status: "skipped",
        error: "Nguồn web đã chọn không còn tồn tại.",
      };
    }
    const stored = storeProfileCandidateCapture(decision, source, product, {
      jobId: run.jobId,
      shopScrapeJobId: run.shopScrapeJobId,
      productMatchScore,
    });
    if (!stored) {
      return {
        status: "failed",
        error: "Nguồn không có đủ thông tin sản phẩm để đưa vào so sánh.",
      };
    }
    const next = activate
      ? activateProfileCandidateCapture(stored.decision, stored.productKey)
      : stored.decision;
    if (!next) {
      return { status: "failed", error: "Không kích hoạt được sản phẩm." };
    }
    const now = new Date().toISOString();
    const serialized = serializeRowDecision(next);
    const [updated] = await db
      .update(excelWorkspaceItems)
      .set({
        reviewDecisionJson: serialized,
        enrichmentUpdatedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(excelWorkspaceItems.id, item.id),
          eq(excelWorkspaceItems.updatedAt, item.updatedAt),
          eq(excelWorkspaceItems.sourceFingerprint, run.sourceFingerprint),
        ),
      )
      .returning({ id: excelWorkspaceItems.id });
    if (updated) {
      return { status: "completed", error: null, decision: serialized };
    }
  }
  return {
    status: "skipped",
    error: "Kết quả scrape bị tranh chấp khi lưu; hãy thử chọn lại.",
  };
}

async function restorePersistedProductsForMissingChild(
  run: ScrapeRunRow,
  now: string,
) {
  const persistedProducts = productsFromJson(
    run.scrapedProductCandidatesJson,
  ).slice(0, MAX_PRODUCTS);
  await db
    .update(materialProfileScrapeRuns)
    .set({
      status:
        persistedProducts.length > 0 ? "awaiting_product_selection" : "failed",
      scrapedProductCandidatesJson: persistedProducts,
      errorMessage:
        persistedProducts.length > 0
          ? "Job scrape gốc đã hết hạn; hãy chọn sản phẩm từ bản chụp đã lưu."
          : "Job scrape gốc đã hết hạn trước khi lưu được sản phẩm.",
      finishedAt: persistedProducts.length > 0 ? null : now,
      updatedAt: now,
    })
    .where(eq(materialProfileScrapeRuns.id, run.id));
}

async function refreshRunningRun(run: ScrapeRunRow) {
  const now = new Date().toISOString();
  if (!run.shopScrapeJobId) {
    await restorePersistedProductsForMissingChild(run, now);
    return;
  }
  const child = await getShopScrapeJob(run.shopScrapeJobId);
  if (!child) {
    await restorePersistedProductsForMissingChild(run, now);
    return;
  }
  if (child.status === "queued") return;
  const products = child.products
    .map(asProfileProduct)
    .filter((product): product is ProfileScrapedProduct => product != null)
    .slice(0, MAX_PRODUCTS);
  if (child.status === "running") {
    if (products.length > 0) {
      await db
        .update(materialProfileScrapeRuns)
        .set({ scrapedProductCandidatesJson: products, updatedAt: now })
        .where(eq(materialProfileScrapeRuns.id, run.id));
    }
    return;
  }
  if (products.length === 0) {
    await db
      .update(materialProfileScrapeRuns)
      .set({
        status: child.status === "cancelled" ? "cancelled" : "failed",
        scrapedProductCandidatesJson: [],
        errorMessage:
          child.error ?? "Không tìm thấy sản phẩm trong nguồn đã chọn.",
        finishedAt: now,
        updatedAt: now,
      })
      .where(eq(materialProfileScrapeRuns.id, run.id));
    return;
  }
  const snapshot = recordOf(run.inputSnapshotJson);
  const resolution = resolveProfileScrapedProduct(
    products,
    run.sourceUrl ?? "",
    {
      title:
        typeof snapshot.productName === "string"
          ? snapshot.productName
          : undefined,
      name:
        typeof snapshot.productName === "string"
          ? snapshot.productName
          : undefined,
      code: typeof snapshot.code === "string" ? snapshot.code : undefined,
    },
  );
  if (resolution.status === "awaiting_product_selection") {
    await db
      .update(materialProfileScrapeRuns)
      .set({
        status: "awaiting_product_selection",
        scrapedProductCandidatesJson: resolution.products,
        errorMessage:
          child.status === "failed"
            ? "Scraper dừng sớm; hãy chọn một sản phẩm đã thu thập."
            : null,
        updatedAt: now,
      })
      .where(eq(materialProfileScrapeRuns.id, run.id));
    return;
  }
  const applied = await applySelectedProduct(
    run,
    resolution.product,
    resolution.score,
    false,
  );
  await db
    .update(materialProfileScrapeRuns)
    .set({
      status: applied.status,
      scrapedProductCandidatesJson: products,
      selectedProductJson: resolution.product,
      errorMessage: applied.error,
      finishedAt: now,
      updatedAt: now,
    })
    .where(eq(materialProfileScrapeRuns.id, run.id));
}

async function startQueuedRun(run: ScrapeRunRow) {
  if (!run.sourceUrl) return;
  const now = new Date().toISOString();
  let childOwned = false;
  let childId: string | null = null;
  try {
    const child = await startShopScrapeJob({
      url: run.sourceUrl,
      scrapeMode: "limited",
      maxPages: 10,
      maxProducts: MAX_PRODUCTS,
      method: "auto",
      detailEnrichment: "missing_fields",
      tenantId: null,
    });
    childOwned = true;
    childId = child.id;
  } catch (error) {
    if (!(error instanceof ShopJobServiceError) || error.code !== "CONFLICT") {
      await db
        .update(materialProfileScrapeRuns)
        .set({
          status: "failed",
          errorMessage:
            error instanceof Error ? error.message : "Không thể tạo shop job.",
          finishedAt: now,
          updatedAt: now,
        })
        .where(eq(materialProfileScrapeRuns.id, run.id));
      return;
    }
    const existing = await getActiveShopScrapeJobByUrl({
      url: run.sourceUrl,
      tenantId: null,
    });
    childId = existing?.id ?? null;
  }
  if (!childId) {
    await db
      .update(materialProfileScrapeRuns)
      .set({
        status: "failed",
        errorMessage: "Không thể nối vào shop job đang chạy.",
        finishedAt: now,
        updatedAt: now,
      })
      .where(eq(materialProfileScrapeRuns.id, run.id));
    return;
  }
  await db
    .update(materialProfileScrapeRuns)
    .set({
      status: "running",
      shopScrapeJobId: childId,
      childOwned,
      startedAt: now,
      updatedAt: now,
    })
    .where(eq(materialProfileScrapeRuns.id, run.id));
}

async function refreshParent(job: ScrapeJobRow) {
  const runs = await db
    .select()
    .from(materialProfileScrapeRuns)
    .where(eq(materialProfileScrapeRuns.jobId, job.id))
    .orderBy(asc(materialProfileScrapeRuns.sortOrder));
  const counts = {
    processed: runs.filter(
      (run) =>
        TERMINAL_RUN_STATUSES.includes(run.status) ||
        run.status === "awaiting_product_selection",
    ).length,
    captured: runs.filter((run) => run.status === "completed").length,
    needsReview: runs.filter(
      (run) => run.status === "awaiting_product_selection",
    ).length,
    skipped: runs.filter((run) => run.status === "skipped").length,
    failed: runs.filter((run) => run.status === "failed").length,
  };
  const active = runs.find((run) => run.status === "running") ?? null;
  const pending = runs.some(
    (run) => run.status === "queued" || run.status === "running",
  );
  let status = job.status;
  if (!pending) {
    if (counts.needsReview > 0) status = "awaiting_review";
    else if (counts.failed > 0 && counts.captured > 0) status = "partial";
    else if (counts.failed > 0 && counts.captured === 0) status = "failed";
    else if (job.status !== "cancelled") status = "completed";
  } else if (job.status !== "cancelled") {
    status = "running";
  }
  const now = new Date().toISOString();
  await db
    .update(materialProfileScrapeJobs)
    .set({
      ...counts,
      status,
      currentItemId: active?.itemId ?? null,
      currentRowIndex: active?.originalRowIndex ?? null,
      currentProductName:
        typeof recordOf(active?.inputSnapshotJson).productName === "string"
          ? (recordOf(active?.inputSnapshotJson).productName as string)
          : null,
      message:
        status === "awaiting_review"
          ? "Có sản phẩm cần chọn trước khi đưa vào so sánh."
          : status === "completed"
            ? "Đã hoàn tất scrape nguồn web."
            : status === "partial"
              ? "Scrape hoàn tất một phần; có dòng thất bại."
              : status === "failed"
                ? "Không scrape được nguồn web đã chọn."
                : "Đang scrape nguồn web.",
      lastProgressAt: now,
      finishedAt: ["completed", "partial", "failed", "cancelled"].includes(
        status,
      )
        ? (job.finishedAt ?? now)
        : null,
      expiresAt: expiresAt(now),
      updatedAt: now,
    })
    .where(eq(materialProfileScrapeJobs.id, job.id));
}

async function advanceMaterialProfileScrapeJobsInternal() {
  const jobs = await db
    .select()
    .from(materialProfileScrapeJobs)
    .where(inArray(materialProfileScrapeJobs.status, ACTIVE_JOB_STATUSES))
    .orderBy(asc(materialProfileScrapeJobs.createdAt));
  for (const job of jobs) {
    const running = await db
      .select()
      .from(materialProfileScrapeRuns)
      .where(
        and(
          eq(materialProfileScrapeRuns.jobId, job.id),
          eq(materialProfileScrapeRuns.status, "running"),
        ),
      );
    for (const run of running) await refreshRunningRun(run);

    const [{ count: activeCount = 0 } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(materialProfileScrapeRuns)
      .where(eq(materialProfileScrapeRuns.status, "running"));
    const capacity = Math.max(0, MAX_CONCURRENT_RUNS - activeCount);
    if (capacity > 0) {
      const queued = await db
        .select()
        .from(materialProfileScrapeRuns)
        .where(
          and(
            eq(materialProfileScrapeRuns.jobId, job.id),
            eq(materialProfileScrapeRuns.status, "queued"),
          ),
        )
        .orderBy(asc(materialProfileScrapeRuns.sortOrder))
        .limit(capacity);
      for (const run of queued) await startQueuedRun(run);
    }
    await refreshParent(job);
  }
}

export async function advanceMaterialProfileScrapeJobs() {
  if (advanceInFlight) return advanceInFlight;
  advanceInFlight = advanceMaterialProfileScrapeJobsInternal().finally(() => {
    advanceInFlight = null;
  });
  return advanceInFlight;
}

export async function getMaterialProfileScrapeJob(
  jobId: string,
  workspaceId: number,
) {
  await advanceMaterialProfileScrapeJobs();
  const [job] = await db
    .select()
    .from(materialProfileScrapeJobs)
    .where(
      and(
        eq(materialProfileScrapeJobs.id, jobId),
        eq(materialProfileScrapeJobs.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!job) {
    throw new MaterialProfileScrapeJobError(
      "NOT_FOUND",
      "Không tìm thấy job scrape.",
    );
  }
  const [currentRun] = await db
    .select({ shopScrapeJobId: materialProfileScrapeRuns.shopScrapeJobId })
    .from(materialProfileScrapeRuns)
    .where(
      and(
        eq(materialProfileScrapeRuns.jobId, job.id),
        eq(materialProfileScrapeRuns.status, "running"),
      ),
    )
    .limit(1);
  const childShopJob = currentRun?.shopScrapeJobId
    ? await getShopScrapeJobProgress(currentRun.shopScrapeJobId)
    : null;
  return { ...job, childShopJob };
}

export async function getActiveMaterialProfileScrapeJob(workspaceId: number) {
  await requireWorkspace(workspaceId);
  await advanceMaterialProfileScrapeJobs();
  const [job] = await db
    .select()
    .from(materialProfileScrapeJobs)
    .where(eq(materialProfileScrapeJobs.workspaceId, workspaceId))
    .orderBy(
      sql`case when ${materialProfileScrapeJobs.status} in ('queued', 'running', 'awaiting_review') then 0 else 1 end`,
      sql`${materialProfileScrapeJobs.updatedAt} desc`,
    )
    .limit(1);
  if (!job) return null;
  const [currentRun] = await db
    .select({ shopScrapeJobId: materialProfileScrapeRuns.shopScrapeJobId })
    .from(materialProfileScrapeRuns)
    .where(
      and(
        eq(materialProfileScrapeRuns.jobId, job.id),
        eq(materialProfileScrapeRuns.status, "running"),
      ),
    )
    .limit(1);
  return {
    ...job,
    childShopJob: currentRun?.shopScrapeJobId
      ? await getShopScrapeJobProgress(currentRun.shopScrapeJobId)
      : null,
  };
}

export async function listMaterialProfileScrapeRuns(
  jobId: string,
  workspaceId: number,
) {
  await getMaterialProfileScrapeJob(jobId, workspaceId);
  return db
    .select()
    .from(materialProfileScrapeRuns)
    .where(
      and(
        eq(materialProfileScrapeRuns.jobId, jobId),
        eq(materialProfileScrapeRuns.workspaceId, workspaceId),
      ),
    )
    .orderBy(asc(materialProfileScrapeRuns.sortOrder));
}

export async function getMaterialProfileScrapeHistory(input: {
  workspaceId: number;
  itemId: number;
}) {
  await advanceMaterialProfileScrapeJobs();
  const [item] = await db
    .select({ id: excelWorkspaceItems.id })
    .from(excelWorkspaceItems)
    .where(
      and(
        eq(excelWorkspaceItems.id, input.itemId),
        eq(excelWorkspaceItems.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  if (!item) {
    throw new MaterialProfileScrapeJobError(
      "NOT_FOUND",
      "Không tìm thấy dòng hồ sơ vật tư.",
    );
  }
  const now = new Date().toISOString();
  const rows = await db
    .select({
      run: materialProfileScrapeRuns,
      parentJob: materialProfileScrapeJobs,
    })
    .from(materialProfileScrapeRuns)
    .innerJoin(
      materialProfileScrapeJobs,
      eq(materialProfileScrapeJobs.id, materialProfileScrapeRuns.jobId),
    )
    .where(
      and(
        eq(materialProfileScrapeRuns.workspaceId, input.workspaceId),
        eq(materialProfileScrapeRuns.itemId, input.itemId),
        or(
          isNull(materialProfileScrapeJobs.expiresAt),
          gte(materialProfileScrapeJobs.expiresAt, now),
        ),
      ),
    )
    .orderBy(desc(materialProfileScrapeRuns.updatedAt))
    .limit(100);
  return Promise.all(
    rows.map(async ({ run, parentJob }) => ({
      ...run,
      parentJob,
      childShopJob:
        run.status === "running" && run.shopScrapeJobId
          ? await getShopScrapeJobProgress(run.shopScrapeJobId).catch(
              () => null,
            )
          : null,
    })),
  );
}

export async function selectMaterialProfileScrapedProduct(input: {
  workspaceId: number;
  runId: string;
  productIndex: number;
}) {
  const [run] = await db
    .select()
    .from(materialProfileScrapeRuns)
    .where(
      and(
        eq(materialProfileScrapeRuns.id, input.runId),
        eq(materialProfileScrapeRuns.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  if (!run)
    throw new MaterialProfileScrapeJobError(
      "NOT_FOUND",
      "Không tìm thấy lượt scrape.",
    );
  if (
    run.status !== "awaiting_product_selection" &&
    run.status !== "completed"
  ) {
    throw new MaterialProfileScrapeJobError(
      "CONFLICT",
      "Lượt scrape này không chờ chọn sản phẩm.",
    );
  }
  const products = productsFromJson(run.scrapedProductCandidatesJson);
  const product = products[input.productIndex];
  if (!product)
    throw new MaterialProfileScrapeJobError(
      "BAD_REQUEST",
      "Sản phẩm đã chọn không hợp lệ.",
    );
  const applied = await applySelectedProduct(run, product, null, true);
  const now = new Date().toISOString();
  await db
    .update(materialProfileScrapeRuns)
    .set({
      status: applied.status,
      selectedProductJson: product,
      errorMessage: applied.error,
      finishedAt: now,
      updatedAt: now,
    })
    .where(eq(materialProfileScrapeRuns.id, run.id));
  const [job] = await db
    .select()
    .from(materialProfileScrapeJobs)
    .where(eq(materialProfileScrapeJobs.id, run.jobId))
    .limit(1);
  if (job) await refreshParent(job);
  if (applied.status !== "completed" || !applied.decision) {
    throw new MaterialProfileScrapeJobError(
      "CONFLICT",
      applied.error ?? "Không thể áp dụng sản phẩm đã chọn.",
    );
  }
  return applied.decision;
}

async function updateRetainedProductDecision(input: {
  workspaceId: number;
  itemId: number;
  productKey: string;
  operation: "activate" | "remove";
}) {
  const [item] = await db
    .select()
    .from(excelWorkspaceItems)
    .where(
      and(
        eq(excelWorkspaceItems.id, input.itemId),
        eq(excelWorkspaceItems.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  if (!item) {
    throw new MaterialProfileScrapeJobError(
      "NOT_FOUND",
      "Không tìm thấy dòng hồ sơ vật tư.",
    );
  }
  const decision = await materialProfileDecisionForItem(item);
  if (
    !decision.scrapeResults?.some(
      (result) => result.productKey === input.productKey,
    )
  ) {
    throw new MaterialProfileScrapeJobError(
      "NOT_FOUND",
      "Sản phẩm scrape đã chọn không còn tồn tại.",
    );
  }
  const next =
    input.operation === "activate"
      ? activateProfileCandidateCapture(decision, input.productKey)
      : removeProfileCandidateCapture(decision, input.productKey);
  if (!next) {
    throw new MaterialProfileScrapeJobError(
      "BAD_REQUEST",
      "Không kích hoạt được sản phẩm scrape.",
    );
  }
  const serialized = serializeRowDecision(next);
  const now = new Date().toISOString();
  await db
    .update(excelWorkspaceItems)
    .set({
      reviewDecisionJson: serialized,
      enrichmentUpdatedAt: now,
      updatedAt: now,
    })
    .where(eq(excelWorkspaceItems.id, item.id));
  return serialized;
}

export function activateMaterialProfileScrapedProduct(input: {
  workspaceId: number;
  itemId: number;
  productKey: string;
}) {
  return updateRetainedProductDecision({ ...input, operation: "activate" });
}

export function removeMaterialProfileScrapedProduct(input: {
  workspaceId: number;
  itemId: number;
  productKey: string;
}) {
  return updateRetainedProductDecision({ ...input, operation: "remove" });
}

export async function retryMaterialProfileScrapeRuns(input: {
  workspaceId: number;
  jobId: string;
  runIds?: string[];
}) {
  await getMaterialProfileScrapeJob(input.jobId, input.workspaceId);
  const now = new Date().toISOString();
  const conditions = [
    eq(materialProfileScrapeRuns.jobId, input.jobId),
    eq(materialProfileScrapeRuns.workspaceId, input.workspaceId),
    eq(materialProfileScrapeRuns.status, "failed"),
  ];
  if (input.runIds?.length)
    conditions.push(inArray(materialProfileScrapeRuns.id, input.runIds));
  const retried = await db
    .update(materialProfileScrapeRuns)
    .set({
      status: "queued",
      shopScrapeJobId: null,
      childOwned: false,
      scrapedProductCandidatesJson: [],
      selectedProductJson: null,
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
      updatedAt: now,
    })
    .where(and(...conditions))
    .returning({ id: materialProfileScrapeRuns.id });
  if (retried.length === 0) {
    throw new MaterialProfileScrapeJobError(
      "BAD_REQUEST",
      "Không có lượt scrape thất bại để thử lại.",
    );
  }
  await db
    .update(materialProfileScrapeJobs)
    .set({ status: "queued", finishedAt: null, error: null, updatedAt: now })
    .where(eq(materialProfileScrapeJobs.id, input.jobId));
  await advanceMaterialProfileScrapeJobs();
  return getMaterialProfileScrapeJob(input.jobId, input.workspaceId);
}

export async function cancelMaterialProfileScrapeJob(
  jobId: string,
  workspaceId: number,
) {
  const job = await getMaterialProfileScrapeJob(jobId, workspaceId);
  const runs = await listMaterialProfileScrapeRuns(jobId, workspaceId);
  for (const run of runs) {
    if (run.status !== "running" || !run.shopScrapeJobId) continue;
    const child = await getShopScrapeJob(run.shopScrapeJobId).catch(() => null);
    const partialProducts = (child?.products ?? [])
      .map(asProfileProduct)
      .filter((product): product is ProfileScrapedProduct => product != null)
      .slice(0, MAX_PRODUCTS);
    if (partialProducts.length > 0) {
      await db
        .update(materialProfileScrapeRuns)
        .set({
          scrapedProductCandidatesJson: partialProducts,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(materialProfileScrapeRuns.id, run.id));
    }
    if (runOwnsChild(run)) {
      const [{ count: sharedCount = 0 } = { count: 0 }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(materialProfileScrapeRuns)
        .where(
          and(
            eq(materialProfileScrapeRuns.shopScrapeJobId, run.shopScrapeJobId),
            eq(materialProfileScrapeRuns.status, "running"),
            sql`${materialProfileScrapeRuns.id} <> ${run.id}`,
          ),
        );
      if (sharedCount === 0) {
        await cancelShopScrapeJob(run.shopScrapeJobId).catch(() => null);
      }
    }
  }
  const now = new Date().toISOString();
  await db
    .update(materialProfileScrapeRuns)
    .set({ status: "cancelled", finishedAt: now, updatedAt: now })
    .where(
      and(
        eq(materialProfileScrapeRuns.jobId, job.id),
        inArray(materialProfileScrapeRuns.status, ACTIVE_RUN_STATUSES),
      ),
    );
  const [cancelled] = await db
    .update(materialProfileScrapeJobs)
    .set({
      status: "cancelled",
      processed: runs.length,
      captured: runs.filter((run) => run.status === "completed").length,
      needsReview: 0,
      skipped: runs.filter((run) => run.status === "skipped").length,
      failed: runs.filter((run) => run.status === "failed").length,
      currentItemId: null,
      currentRowIndex: null,
      currentProductName: null,
      message: "Đã hủy job scrape hồ sơ vật tư.",
      finishedAt: now,
      lastProgressAt: now,
      updatedAt: now,
    })
    .where(eq(materialProfileScrapeJobs.id, job.id))
    .returning();
  return cancelled;
}

export async function attachMaterialProfileCatalogPdfSource(input: {
  workspaceId: number;
  itemId: number;
  sourceUrl: string;
  sourceCandidateKey?: string;
}) {
  if (!isProfilePdfSource(input.sourceUrl)) {
    throw new MaterialProfileScrapeJobError(
      "BAD_REQUEST",
      "Nguồn đã chọn không phải liên kết PDF.",
    );
  }
  const [item] = await db
    .select()
    .from(excelWorkspaceItems)
    .where(
      and(
        eq(excelWorkspaceItems.id, input.itemId),
        eq(excelWorkspaceItems.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  if (!item)
    throw new MaterialProfileScrapeJobError(
      "NOT_FOUND",
      "Không tìm thấy dòng hồ sơ vật tư.",
    );
  const decision = await materialProfileDecisionForItem(item);
  if (!decision.webLinkResults?.some((link) => link.url === input.sourceUrl)) {
    throw new MaterialProfileScrapeJobError(
      "BAD_REQUEST",
      "Nguồn PDF không thuộc kết quả web của dòng này.",
    );
  }
  const urls = unionCatalogPdfUrls([
    ...(decision.catalogPdfUrls ?? []),
    input.sourceUrl,
  ]);
  const normalizedPdfUrl =
    normalizeCatalogPdfUrl(input.sourceUrl) ?? input.sourceUrl;
  const existingEvidence = (decision.webEvidence ?? []).filter(
    (evidence) =>
      evidence.field !== "catalogPdfUrls" ||
      (normalizeCatalogPdfUrl(evidence.sourceUrl ?? "") ??
        evidence.sourceUrl) !== normalizedPdfUrl,
  );
  const next: RowDecision = {
    ...decision,
    selectedSource: "web",
    selectedSearchCandidateKey:
      input.sourceCandidateKey ?? searchCandidateKey("web", input.sourceUrl),
    catalogPdfUrls: urls,
    acceptedFields: new Set([...decision.acceptedFields, "sourceUrl"]),
    editedValues: { ...decision.editedValues, sourceUrl: input.sourceUrl },
    webProposedFields: {
      ...decision.webProposedFields,
      sourceUrl: input.sourceUrl,
    },
    webEvidence: [
      ...existingEvidence,
      {
        field: "catalogPdfUrls",
        value: input.sourceUrl,
        sourceUrl: input.sourceUrl,
        snippet: "Catalog PDF được người vận hành chọn làm bằng chứng.",
      },
    ],
  };
  const now = new Date().toISOString();
  await db
    .update(excelWorkspaceItems)
    .set({ reviewDecisionJson: serializeRowDecision(next), updatedAt: now })
    .where(eq(excelWorkspaceItems.id, item.id));
  return serializeRowDecision(next);
}

export async function cleanupExpiredMaterialProfileScrapeJobs(
  now = new Date().toISOString(),
) {
  const removed = await db
    .delete(materialProfileScrapeJobs)
    .where(lt(materialProfileScrapeJobs.expiresAt, now))
    .returning({ id: materialProfileScrapeJobs.id });
  return removed.length;
}
