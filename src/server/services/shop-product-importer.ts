import { createHash, randomUUID } from "node:crypto";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { materialImageUrlFromScrape } from "~/lib/materials/image";
import { computeMergedMaterialValues } from "~/lib/materials/shop-import-merge-preview";
import type { db as appDb } from "~/server/db";
import { materials, shopImportItems, shopImportJobs } from "~/server/db/schema";
import {
  findFuzzyCandidates,
  getCachedDecision,
  hashScrapedProduct,
  saveMatchDecision,
} from "~/server/services/ai-product-matcher";
import { attachCatalogPdfUrlsToMaterial } from "~/server/services/catalog-documents";
import { resolveAiMatchCandidateThreshold } from "~/server/services/app-settings";
import {
  buildMaterialMetadata,
  normalizeMaterialMetadata,
  type MaterialFieldLockKey,
  type MaterialMetadata,
  type MaterialPriceSource,
} from "~/server/services/material-price-sources";
import {
  lockMaterialForUpdate,
  type MaterialWriteHandle,
  updateLockedMaterial,
} from "~/server/services/material-write";
import type {
  ShopImportJobItem,
  ShopImportJobProgress,
  ShopImportJobResult,
} from "~/server/services/shop-import-jobs";
import type { ShopImportMode } from "~/server/services/shop-import-source";
import type { ScrapedShopProduct } from "~/server/services/shop-material-scraper";
import { createLogger, traceFn } from "~/server/lib/logger";

const log = createLogger("services-shop-product-importer");

type AppDb = typeof appDb;
type MaterialRow = typeof materials.$inferSelect;
type ImportDb = MaterialWriteHandle;

type MaterialInput = {
  code?: string | null;
  name: string;
  unit: string;
  category?: string | null;
  specText?: string | null;
  manufacturer?: string | null;
  originCountry?: string | null;
  defaultUnitPrice?: number | null;
  currency?: string | null;
  sourceUrl?: string | null;
};

type MaterialLookupIndexes = {
  bySourceUrl: Map<string, MaterialRow>;
  bySku: Map<string, MaterialRow>;
  byNameUnit: Map<string, MaterialRow>;
};

export type ImportPreviewAction = "create" | "update" | "skip_no_name";

export type ImportClassification = {
  action: ImportPreviewAction;
  name: string;
  sourceUrl: string;
  message: string;
  confidence?: number;
  materialId?: number;
  matchedMaterialName?: string;
};

export type ImportPreviewSummary = {
  create: number;
  update: number;
  skipNoName: number;
  total: number;
};

export type ImportScrapedProductsOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: ShopImportJobProgress) => void;
  importJobId?: string;
  scrapeJobId?: string;
  mode?: ShopImportMode;
};

type ImportItemStatus = (typeof shopImportItems.$inferSelect)["status"];
type ImportItemRow = typeof shopImportItems.$inferSelect;

type ClassifyOptions = {
  dryRun?: boolean;
  scrapeJobId?: string;
  mode?: ShopImportMode;
};

async function _importScrapedProductsLegacy(
  db: AppDb,
  products: ScrapedShopProduct[],
  options: ImportScrapedProductsOptions = {},
): Promise<ShopImportJobResult> {
  if (products.length === 0) {
    throw new Error("Không có sản phẩm scrape để nhập.");
  }

  throwIfImportAborted(options.signal);
  const existingMaterials =
    options.mode === "create_all"
      ? []
      : await db
          .select()
          .from(materials)
          .where(isNull(materials.deletedAt))
          .limit(25_000);
  throwIfImportAborted(options.signal);

  const indexes = createMaterialLookupIndexes(existingMaterials);
  const items: ShopImportJobItem[] = [];
  const total = products.length;
  let processed = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const reportProgress = (
    currentProductName: string | null,
    currentSourceUrl: string | null,
  ) => {
    options.onProgress?.({
      processed,
      total,
      created,
      updated,
      skipped,
      failed,
      items: [...items],
      currentProductName,
      currentSourceUrl,
    });
  };

  reportProgress(null, null);

  for (const product of products) {
    throwIfImportAborted(options.signal);
    const name = product.name.trim();
    reportProgress(name || "(không có tên)", product.sourceUrl);

    try {
      const classification = await classifyScrapedProductForImport(
        db,
        product,
        indexes,
        { scrapeJobId: options.scrapeJobId, mode: options.mode },
      );

      if (classification.action === "skip_no_name") {
        skipped += 1;
        items.push({
          name: classification.name,
          sourceUrl: classification.sourceUrl,
          action: "skipped",
          message: classification.message,
        });
        processed += 1;
        reportProgress(classification.name, classification.sourceUrl);
        continue;
      }

      if (classification.action === "update" && classification.materialId) {
        const existing = await loadMaterialById(db, classification.materialId);
        const updatedRow = await applyScrapedProductToMaterial(
          db,
          existing,
          product,
        );
        indexMaterialRow(indexes, updatedRow);
        updated += 1;
        items.push({
          name: classification.name,
          sourceUrl: classification.sourceUrl,
          action: "updated",
          materialId: updatedRow.id,
          message: classification.message,
        });
        processed += 1;
        reportProgress(classification.name, classification.sourceUrl);
        continue;
      }

      const now = new Date().toISOString();
      const scrapedUnit = product.unit?.trim();
      const unit =
        scrapedUnit && scrapedUnit.length > 0 ? scrapedUnit : "unknown";
      const createInput: MaterialInput = {
        name: classification.name,
        unit,
        category: product.category,
        specText: product.specText,
        manufacturer: product.manufacturer,
        originCountry: product.originCountry,
        defaultUnitPrice: product.price,
        currency: product.currency,
        sourceUrl: product.sourceUrl,
      };
      const [row] = await db
        .insert(materials)
        .values({
          ...materialValues(createInput, now),
          imageUrl: materialImageUrlFromScrape(product.imageUrl),
          metadataJson: metadataForScrapedProduct(null, product, now),
        })
        .returning();

      const createdRow = requireUpdatedMaterial(row);
      indexMaterialRow(indexes, createdRow);
      await linkScrapedCatalogPdfs(db, createdRow.id, product);
      created += 1;
      items.push({
        name: classification.name,
        sourceUrl: classification.sourceUrl,
        action: "created",
        materialId: createdRow.id,
        message: classification.message,
      });
      processed += 1;
      reportProgress(classification.name, classification.sourceUrl);
    } catch (error) {
      failed += 1;
      items.push({
        name: name || "(không có tên)",
        sourceUrl: product.sourceUrl,
        action: "failed",
        message:
          error instanceof Error ? error.message : "Không thể lưu sản phẩm.",
      });
      processed += 1;
      reportProgress(name || "(không có tên)", product.sourceUrl);
    }
  }

  reportProgress(null, null);
  return { created, updated, skipped, failed, items };
}

async function _importScrapedProducts(
  db: AppDb,
  products: ScrapedShopProduct[],
  options: ImportScrapedProductsOptions = {},
) {
  const importJobId = options.importJobId;
  if (!importJobId) {
    return _importScrapedProductsLegacy(db, products, options);
  }

  return importScrapedProductsWithLedger(db, products, {
    ...options,
    importJobId,
  });
}

function importProductKey(product: ScrapedShopProduct) {
  const sourceUrl = product.sourceUrl.trim();
  const identity = sourceUrl
    ? `url:${sourceUrl}`
    : [
        product.sku?.trim() ?? "",
        product.model?.trim() ?? "",
        product.name.trim(),
        product.unit?.trim() ?? "",
      ].join("\\u001f");
  return createHash("sha256").update(identity).digest("hex");
}

export function getImportProductKey(product: ScrapedShopProduct) {
  return importProductKey(product);
}

function isSuccessfulImportItem(status: ImportItemStatus) {
  return status === "created" || status === "updated" || status === "skipped";
}

function countsAfterItem(
  counts: {
    processed: number;
    created: number;
    updated: number;
    skipped: number;
    failed: number;
  },
  status: ImportItemStatus,
  delta = 1,
) {
  return {
    processed: counts.processed + delta,
    created: counts.created + (status === "created" ? delta : 0),
    updated: counts.updated + (status === "updated" ? delta : 0),
    skipped: counts.skipped + (status === "skipped" ? delta : 0),
    failed: counts.failed + (status === "failed" ? delta : 0),
  };
}

function importItemToJobItem(item: ImportItemRow): ShopImportJobItem {
  return {
    name: item.productName,
    sourceUrl: item.sourceUrl,
    action:
      item.status === "created"
        ? "created"
        : item.status === "updated"
          ? "updated"
          : item.status === "skipped"
            ? "skipped"
            : "failed",
    ...(item.materialId ? { materialId: item.materialId } : {}),
    ...(item.message ? { message: item.message } : {}),
  };
}

async function getImportItem(
  db: ImportDb,
  importJobId: string,
  productKey: string,
) {
  const [item] = await db
    .select()
    .from(shopImportItems)
    .where(
      and(
        eq(shopImportItems.importJobId, importJobId),
        eq(shopImportItems.productKey, productKey),
      ),
    )
    .limit(1);
  return item ?? null;
}

async function claimImportItem(
  tx: ImportDb,
  input: {
    importJobId: string;
    productKey: string;
    sourceUrl: string;
    productName: string;
  },
) {
  await tx
    .insert(shopImportItems)
    .values({ ...input, status: "processing" })
    .onConflictDoNothing({
      target: [shopImportItems.importJobId, shopImportItems.productKey],
    });
  const [item] = await tx
    .select()
    .from(shopImportItems)
    .where(
      and(
        eq(shopImportItems.importJobId, input.importJobId),
        eq(shopImportItems.productKey, input.productKey),
      ),
    )
    .for("update")
    .limit(1);
  if (!item) {
    throw new Error("Không thể ghi nhận dòng nhập catalog.");
  }
  if (item.status === "failed") {
    const now = new Date().toISOString();
    const [retry] = await tx
      .update(shopImportItems)
      .set({ status: "processing", message: null, updatedAt: now })
      .where(eq(shopImportItems.id, item.id))
      .returning();
    return retry ?? item;
  }
  return item;
}

async function persistImportItemFailure(
  db: AppDb,
  importJobId: string,
  product: ScrapedShopProduct,
  productKey: string,
  message: string,
) {
  const now = new Date().toISOString();
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select({ status: shopImportJobs.status })
      .from(shopImportJobs)
      .where(eq(shopImportJobs.id, importJobId))
      .for("update")
      .limit(1);
    if (job?.status !== "running") throw new ImportJobStoppedError();
    const [recorded] = await tx
      .insert(shopImportItems)
      .values({
        importJobId,
        productKey,
        sourceUrl: product.sourceUrl,
        productName: product.name.trim() || "(không có tên)",
        status: "failed",
        message,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [shopImportItems.importJobId, shopImportItems.productKey],
        set: { status: "failed", message, updatedAt: now },
        // A delayed rollback or lost COMMIT acknowledgement must never downgrade
        // a success. PostgreSQL rechecks this predicate after the unique-key wait.
        setWhere: inArray(shopImportItems.status, ["processing", "failed"]),
      })
      .returning();
    const winning =
      recorded ?? (await getImportItem(tx, importJobId, productKey));
    if (!winning) throw new Error("Không thể đọc kết quả nhập catalog.");
    return winning;
  });
}

async function persistImportItem(
  db: AppDb,
  importJobId: string,
  product: ScrapedShopProduct,
  productKey: string,
  classification: ImportClassification,
  signal?: AbortSignal,
) {
  const outcome = await db.transaction(async (tx) => {
    // Cancellation and product commits serialize on the parent job first.
    const [job] = await tx
      .select({ status: shopImportJobs.status })
      .from(shopImportJobs)
      .where(eq(shopImportJobs.id, importJobId))
      .for("update")
      .limit(1);
    if (job?.status !== "running") throw new ImportJobStoppedError();
    throwIfImportAborted(signal);
    const ledger = await claimImportItem(tx, {
      importJobId,
      productKey,
      sourceUrl: product.sourceUrl,
      productName: classification.name,
    });
    if (isSuccessfulImportItem(ledger.status)) {
      return {
        ledger,
        material: null,
      };
    }

    const now = new Date().toISOString();
    if (classification.action === "skip_no_name") {
      const [updated] = await tx
        .update(shopImportItems)
        .set({
          status: "skipped",
          message: classification.message,
          updatedAt: now,
        })
        .where(eq(shopImportItems.id, ledger.id))
        .returning();
      if (!updated) throw new Error("Không thể lưu kết quả nhập catalog.");
      return {
        ledger: updated,
        material: null,
      };
    }

    let material: MaterialRow;
    let status: "created" | "updated";
    if (classification.action === "update" && classification.materialId) {
      const current = await lockMaterialForUpdate(
        tx,
        classification.materialId,
      );
      const merged = computeMergedMaterialValues(current, product, now);
      material = await updateLockedMaterial(tx, current, merged, { now });
      status = "updated";
    } else {
      const trimmedUnit = product.unit?.trim();
      const unit =
        trimmedUnit && trimmedUnit.length > 0 ? trimmedUnit : "unknown";
      const [created] = await tx
        .insert(materials)
        .values({
          ...materialValues(
            {
              name: classification.name,
              unit,
              category: product.category,
              specText: product.specText,
              manufacturer: product.manufacturer,
              originCountry: product.originCountry,
              defaultUnitPrice: product.price,
              currency: product.currency,
              sourceUrl: product.sourceUrl,
            },
            now,
          ),
          imageUrl: materialImageUrlFromScrape(product.imageUrl),
          metadataJson: metadataForScrapedProduct(null, product, now),
        })
        .returning();
      material = requireUpdatedMaterial(created);
      status = "created";
    }
    await linkScrapedCatalogPdfs(tx, material.id, product, true);
    throwIfImportAborted(signal);
    const [updated] = await tx
      .update(shopImportItems)
      .set({
        status,
        materialId: material.id,
        message: classification.message,
        updatedAt: now,
      })
      .where(eq(shopImportItems.id, ledger.id))
      .returning();
    if (!updated) throw new Error("Không thể lưu kết quả nhập catalog.");
    return { ledger: updated, material };
  });
  return outcome;
}

async function loadImportItems(db: ImportDb, importJobId: string) {
  return db
    .select()
    .from(shopImportItems)
    .where(eq(shopImportItems.importJobId, importJobId))
    .orderBy(asc(shopImportItems.id));
}

function progressFromImportItems(rows: ImportItemRow[]): ShopImportJobProgress {
  let counts = { processed: 0, created: 0, updated: 0, skipped: 0, failed: 0 };
  const items: ShopImportJobItem[] = [];
  for (const row of rows) {
    if (row.status !== "processing") {
      counts = countsAfterItem(counts, row.status);
      items.push(importItemToJobItem(row));
    }
  }
  return {
    ...counts,
    total: rows.length,
    items,
    currentProductName: null,
    currentSourceUrl: null,
  };
}

export async function readImportJobProgress(
  db: ImportDb,
  importJobId: string,
): Promise<ShopImportJobProgress | null> {
  const rows = await loadImportItems(db, importJobId);
  return rows.length > 0 ? progressFromImportItems(rows) : null;
}

export async function reconcileImportJobProgress(
  db: AppDb,
  importJobId: string,
) {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select({ id: shopImportJobs.id })
      .from(shopImportJobs)
      .where(eq(shopImportJobs.id, importJobId))
      .for("update")
      .limit(1);
    if (!job) throw new Error("Không tìm thấy job nhập catalog.");
    const progress = await readImportJobProgress(tx, importJobId);
    // Legacy jobs have no ledger; preserve their last known partial evidence.
    if (progress) {
      await tx
        .update(shopImportJobs)
        .set({ ...progress, updatedAt: new Date().toISOString() })
        .where(eq(shopImportJobs.id, importJobId));
    }
    return progress;
  });
}

class ImportJobStoppedError extends Error {
  constructor() {
    super("Đã hủy job nhập catalog.");
  }
}

async function importScrapedProductsWithLedger(
  db: AppDb,
  products: ScrapedShopProduct[],
  options: ImportScrapedProductsOptions & { importJobId: string },
): Promise<ShopImportJobResult> {
  if (products.length === 0) {
    throwIfImportAborted(options.signal);
    const durable = await readImportJobProgress(db, options.importJobId);
    // A restarted job can have a source list that now sanitizes to empty after
    // every ledger row already reached a terminal outcome. Preserve that
    // durable result instead of turning an idempotent replay into a failure.
    if (!durable || durable.processed !== durable.total) {
      throw new Error("Không có sản phẩm scrape để nhập.");
    }
    options.onProgress?.({
      ...durable,
      currentProductName: null,
      currentSourceUrl: null,
    });
    return {
      created: durable.created,
      updated: durable.updated,
      skipped: durable.skipped,
      failed: durable.failed,
      items: durable.items,
    };
  }

  throwIfImportAborted(options.signal);
  const uniqueProducts = new Map(
    products.map((product) => [importProductKey(product), product]),
  );
  // Persist pending identities before the first material transaction. A rollback
  // before its first material commit can then resume without guessing.
  const entries = Array.from(uniqueProducts, ([productKey, product]) => ({
    importJobId: options.importJobId,
    productKey,
    sourceUrl: product.sourceUrl,
    productName: product.name.trim() || "(không có tên)",
    status: "processing" as const,
  }));
  for (let start = 0; start < entries.length; start += 500) {
    await db
      .insert(shopImportItems)
      .values(entries.slice(start, start + 500))
      .onConflictDoNothing({
        target: [shopImportItems.importJobId, shopImportItems.productKey],
      });
  }
  const existingMaterials =
    options.mode === "create_all"
      ? []
      : await db
          .select()
          .from(materials)
          .where(isNull(materials.deletedAt))
          .limit(25_000);
  const indexes = createMaterialLookupIndexes(existingMaterials);
  const rows = await loadImportItems(db, options.importJobId);
  const byKey = new Map(rows.map((row) => [row.productKey, row]));
  let progress = progressFromImportItems(rows);
  const itemIndexes = new Map(
    rows
      .filter((row) => row.status !== "processing")
      .map((row, index) => [row.productKey, index]),
  );
  const applyWinningItem = (winning: ImportItemRow) => {
    const previous = byKey.get(winning.productKey);
    if (previous && previous.status !== "processing") {
      progress = {
        ...progress,
        ...countsAfterItem(progress, previous.status, -1),
      };
    }
    byKey.set(winning.productKey, winning);
    if (winning.status !== "processing") {
      progress = { ...progress, ...countsAfterItem(progress, winning.status) };
      const itemIndex = itemIndexes.get(winning.productKey);
      if (itemIndex === undefined) {
        itemIndexes.set(winning.productKey, progress.items.length);
        progress.items.push(importItemToJobItem(winning));
      } else {
        progress.items[itemIndex] = importItemToJobItem(winning);
      }
    }
  };
  const reportProgress = (
    currentProductName: string | null,
    currentSourceUrl: string | null,
  ) => {
    // Callbacks share the incrementally maintained items view. The scheduler
    // reconciles from PostgreSQL at its bounded flush and terminal boundaries.
    options.onProgress?.({ ...progress, currentProductName, currentSourceUrl });
  };

  reportProgress(null, null);
  for (const [productKey, product] of uniqueProducts) {
    throwIfImportAborted(options.signal);
    const name = product.name.trim() || "(không có tên)";
    reportProgress(name, product.sourceUrl);
    throwIfImportAborted(options.signal);
    const existing = byKey.get(productKey);
    if (existing && isSuccessfulImportItem(existing.status)) continue;
    try {
      const classification = await classifyScrapedProductForImport(
        db,
        product,
        indexes,
        { scrapeJobId: options.scrapeJobId, mode: options.mode },
      );
      const outcome = await persistImportItem(
        db,
        options.importJobId,
        product,
        productKey,
        classification,
        options.signal,
      );
      if (outcome.material) indexMaterialRow(indexes, outcome.material);
      applyWinningItem(outcome.ledger);
    } catch (error) {
      if (options.signal?.aborted || error instanceof ImportJobStoppedError)
        throw error;
      const winning = await persistImportItemFailure(
        db,
        options.importJobId,
        product,
        productKey,
        error instanceof Error ? error.message : "Không thể lưu sản phẩm.",
      );
      applyWinningItem(winning);
    }
    // Callback errors are outside failure bookkeeping: the transaction is done.
    reportProgress(name, product.sourceUrl);
  }

  const durable = await readImportJobProgress(db, options.importJobId);
  if (!durable) throw new Error("Không có sổ kiểm kê cho job nhập catalog.");
  progress = durable;
  reportProgress(null, null);
  if (durable.processed !== durable.total) {
    throw new Error(
      "Job nhập catalog còn sản phẩm chưa xử lý; không thể hoàn tất.",
    );
  }
  return {
    created: durable.created,
    updated: durable.updated,
    skipped: durable.skipped,
    failed: durable.failed,
    items: durable.items,
  };
}

async function _previewShopImportProducts(
  db: AppDb,
  products: ScrapedShopProduct[],
  options: Pick<ImportScrapedProductsOptions, "mode"> = {},
): Promise<{ summary: ImportPreviewSummary; items: ImportClassification[] }> {
  if (products.length === 0) {
    throw new Error("Không có sản phẩm scrape để xem trước.");
  }

  const existingMaterials =
    options.mode === "create_all"
      ? []
      : await db
          .select()
          .from(materials)
          .where(isNull(materials.deletedAt))
          .limit(25_000);
  const indexes = createMaterialLookupIndexes(existingMaterials);
  const items: ImportClassification[] = [];

  for (const product of products) {
    items.push(
      await classifyScrapedProductForImport(db, product, indexes, {
        dryRun: true,
        mode: options.mode,
      }),
    );
  }

  const summary: ImportPreviewSummary = {
    create: items.filter((item) => item.action === "create").length,
    update: items.filter((item) => item.action === "update").length,
    skipNoName: items.filter((item) => item.action === "skip_no_name").length,
    total: items.length,
  };

  return { summary, items };
}

async function _classifyScrapedProductForImport(
  db: AppDb,
  product: ScrapedShopProduct,
  indexes: MaterialLookupIndexes,
  options: ClassifyOptions = {},
): Promise<ImportClassification> {
  const name = product.name.trim();
  const sourceUrl = product.sourceUrl;

  if (!name) {
    return {
      action: "skip_no_name",
      name: "(không có tên)",
      sourceUrl,
      message: "Bỏ qua vì thiếu tên sản phẩm.",
    };
  }

  if (options.mode === "create_all") {
    return {
      action: "create",
      name,
      sourceUrl,
      message: importMessageForCreated(product),
    };
  }

  const scrapedUnit = product.unit?.trim();
  const unit = scrapedUnit && scrapedUnit.length > 0 ? scrapedUnit : "unknown";

  const existing = findExistingScrapedMaterial(indexes, {
    ...product,
    unit,
  });
  if (existing) {
    const locks =
      normalizeMaterialMetadata(existing.metadataJson).fieldLocks ?? {};
    return {
      action: "update",
      name,
      sourceUrl,
      materialId: existing.id,
      matchedMaterialName: existing.name,
      message: importMessageForUpdated(existing, product, locks),
    };
  }

  const fuzzyResult = await tryFuzzyMatch(db, product, unit, indexes, options);
  if (fuzzyResult?.action === "auto_matched" && fuzzyResult.materialRow) {
    return {
      action: "update",
      name,
      sourceUrl,
      materialId: fuzzyResult.materialRow.id,
      matchedMaterialName: fuzzyResult.materialRow.name,
      confidence: fuzzyResult.confidence,
      message: `Ghép tự động (AI: ${(fuzzyResult.confidence * 100).toFixed(0)}%) với "${fuzzyResult.materialRow.name}".`,
    };
  }

  return {
    action: "create",
    name,
    sourceUrl,
    message: importMessageForCreated(product),
  };
}

async function _applyScrapedProductToMaterial(
  db: AppDb,
  material: MaterialRow,
  product: ScrapedShopProduct,
): Promise<MaterialRow> {
  const now = new Date().toISOString();
  const updatedRow = await db.transaction(async (tx) => {
    const current = await lockMaterialForUpdate(tx, material.id);
    const mergedValues = computeMergedMaterialValues(current, product, now);
    return updateLockedMaterial(tx, current, mergedValues, { now });
  });
  await linkScrapedCatalogPdfs(db, updatedRow.id, product);
  return updatedRow;
}

function materialValues(input: MaterialInput, now: string) {
  return {
    ...input,
    code: input.code?.trim() ? input.code : null,
    category: input.category?.trim() ? input.category : null,
    specText: input.specText ?? "",
    manufacturer: input.manufacturer?.trim() ? input.manufacturer : null,
    originCountry: input.originCountry?.trim() ? input.originCountry : null,
    defaultUnitPrice: input.defaultUnitPrice ?? null,
    currency: input.currency?.trim() ? input.currency : "VND",
    sourceUrl: input.sourceUrl?.trim() ? input.sourceUrl : null,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizePrimarySources(
  sources: MaterialPriceSource[],
  primaryId?: string,
) {
  if (sources.length === 0) {
    return sources;
  }

  const targetPrimaryId =
    primaryId ?? sources.find((source) => source.isPrimary)?.id;
  if (!targetPrimaryId) {
    return sources;
  }

  return sources.map((source) => ({
    ...source,
    isPrimary: source.id === targetPrimaryId,
  }));
}

function requireUpdatedMaterial<T>(material: T | undefined): T {
  if (!material) {
    throw new Error("Không tìm thấy vật tư.");
  }

  return material;
}

async function loadMaterialById(db: ImportDb, materialId: number) {
  const [material] = await db
    .select()
    .from(materials)
    .where(and(eq(materials.id, materialId), isNull(materials.deletedAt)))
    .limit(1);

  return requireUpdatedMaterial(material);
}

function normalizeLookupKey(value: string | null | undefined) {
  return value
    ?.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sourceUrlsForMaterial(material: MaterialRow) {
  const metadata = normalizeMaterialMetadata(material.metadataJson);
  return [
    material.sourceUrl,
    metadata.shopScrape?.sourceUrl,
    ...metadata.priceSources.map((source) => source.url),
  ]
    .map((url) => url?.trim())
    .filter((url): url is string => Boolean(url));
}

function skuKeysForMaterial(material: MaterialRow) {
  const metadata = normalizeMaterialMetadata(material.metadataJson);
  return [metadata.shopScrape?.sku, metadata.shopScrape?.model]
    .map(normalizeLookupKey)
    .filter((value): value is string => Boolean(value));
}

function nameUnitKey(
  name: string | null | undefined,
  unit: string | null | undefined,
) {
  const normalizedName = normalizeLookupKey(name);
  const normalizedUnit = normalizeLookupKey(unit);
  return normalizedName && normalizedUnit
    ? `${normalizedName}|${normalizedUnit}`
    : null;
}

export function createMaterialLookupIndexes(
  rows: MaterialRow[],
): MaterialLookupIndexes {
  const indexes: MaterialLookupIndexes = {
    bySourceUrl: new Map(),
    bySku: new Map(),
    byNameUnit: new Map(),
  };

  for (const row of rows) {
    indexMaterialRow(indexes, row);
  }

  return indexes;
}

function indexMaterialRow(indexes: MaterialLookupIndexes, row: MaterialRow) {
  for (const sourceUrl of sourceUrlsForMaterial(row)) {
    indexes.bySourceUrl.set(sourceUrl, row);
  }
  for (const sku of skuKeysForMaterial(row)) {
    indexes.bySku.set(sku, row);
  }
  const key = nameUnitKey(row.name, row.unit);
  if (key) {
    indexes.byNameUnit.set(key, row);
  }
}

function findExistingScrapedMaterial(
  indexes: MaterialLookupIndexes,
  product: ScrapedShopProduct,
) {
  const sourceMatch = indexes.bySourceUrl.get(product.sourceUrl.trim());
  if (sourceMatch) {
    return sourceMatch;
  }

  const skuKey =
    normalizeLookupKey(product.sku) ?? normalizeLookupKey(product.model);
  if (skuKey) {
    const skuMatch = indexes.bySku.get(skuKey);
    if (skuMatch) {
      return skuMatch;
    }
  }

  return (
    indexes.byNameUnit.get(
      nameUnitKey(product.name, product.unit ?? "unknown") ?? "",
    ) ?? null
  );
}

function scrapedShopMetadata(
  product: ScrapedShopProduct,
  scrapedAt: string,
): NonNullable<MaterialMetadata["shopScrape"]> {
  let shopHost = "";
  try {
    shopHost = new URL(product.sourceUrl).hostname;
  } catch {
    shopHost = "";
  }

  return {
    sourceUrl: product.sourceUrl,
    shopHost,
    scrapedAt,
    imageUrl: product.imageUrl,
    sku: product.sku,
    model: product.model,
    availability: product.availability,
    shopCategory: product.shopCategory,
  };
}

function upsertScrapedPriceSource(
  existingSources: MaterialPriceSource[],
  product: ScrapedShopProduct,
  checkedAt: string,
) {
  const sourceUrl = product.sourceUrl.trim();
  const hasPrimary = existingSources.some((source) => source.isPrimary);
  const sourceIndex = existingSources.findIndex(
    (source) => source.url.trim() === sourceUrl,
  );

  if (sourceIndex >= 0) {
    return normalizePrimarySources(
      existingSources.map((source, index) =>
        index === sourceIndex
          ? {
              ...source,
              lastPrice: product.price,
              lastPriceText: product.priceText,
              currency: product.currency,
              lastCheckedAt: checkedAt,
            }
          : source,
      ),
    );
  }

  let label = "Shop scrape";
  try {
    label = new URL(sourceUrl).hostname;
  } catch {
    // Keep generic label.
  }

  const source: MaterialPriceSource = {
    id: randomUUID(),
    label,
    url: sourceUrl,
    mode: "linked",
    fixedPrice: null,
    lastPrice: product.price,
    lastPriceText: product.priceText,
    currency: product.currency,
    lastCheckedAt: checkedAt,
    note: "Tự động nhập từ shop URL.",
    isPrimary: !hasPrimary,
  };

  return normalizePrimarySources([...existingSources, source], source.id);
}

function metadataForScrapedProduct(
  material: MaterialRow | null,
  product: ScrapedShopProduct,
  scrapedAt: string,
) {
  const existingMetadata = normalizeMaterialMetadata(material?.metadataJson);
  const priceSources = upsertScrapedPriceSource(
    existingMetadata.priceSources,
    product,
    scrapedAt,
  );

  return {
    ...(material?.metadataJson ?? {}),
    ...buildMaterialMetadata({
      priceSources,
      shopScrape: scrapedShopMetadata(product, scrapedAt),
      fieldLocks: normalizeMaterialMetadata(material?.metadataJson).fieldLocks,
    }),
  };
}

function isFieldLocked(
  locks: Partial<Record<MaterialFieldLockKey, boolean>>,
  field: MaterialFieldLockKey,
) {
  return locks[field] === true;
}

function countLockedFields(
  locks: Partial<Record<MaterialFieldLockKey, boolean>>,
) {
  return Object.values(locks).filter(Boolean).length;
}

function throwIfImportAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new Error("Đã hủy job nhập catalog.");
  }
}

const scrapedFieldLabels = {
  category: "nhóm",
  specText: "thông số",
  manufacturer: "NCC",
  originCountry: "xuất xứ",
  defaultUnitPrice: "giá",
  sourceUrl: "nguồn",
  imageUrl: "ảnh",
  catalogPdfUrls: "catalog PDF",
} as const;

function availableScrapedFieldLabels(product: ScrapedShopProduct) {
  return [
    product.category ? scrapedFieldLabels.category : null,
    product.specText.trim() ? scrapedFieldLabels.specText : null,
    product.manufacturer ? scrapedFieldLabels.manufacturer : null,
    product.originCountry ? scrapedFieldLabels.originCountry : null,
    product.price != null ? scrapedFieldLabels.defaultUnitPrice : null,
    product.sourceUrl ? scrapedFieldLabels.sourceUrl : null,
    product.imageUrl ? scrapedFieldLabels.imageUrl : null,
    product.catalogPdfUrls.length > 0
      ? scrapedFieldLabels.catalogPdfUrls
      : null,
  ].filter(Boolean) as string[];
}

function filledExistingMaterialFieldLabels(
  existing: MaterialRow,
  product: ScrapedShopProduct,
  locks: Partial<Record<MaterialFieldLockKey, boolean>> = {},
) {
  return [
    !isFieldLocked(locks, "category") &&
    !existing.category?.trim() &&
    product.category
      ? scrapedFieldLabels.category
      : null,
    !isFieldLocked(locks, "specText") &&
    !existing.specText.trim() &&
    product.specText.trim()
      ? scrapedFieldLabels.specText
      : null,
    !isFieldLocked(locks, "manufacturer") &&
    !existing.manufacturer?.trim() &&
    product.manufacturer
      ? scrapedFieldLabels.manufacturer
      : null,
    !isFieldLocked(locks, "originCountry") &&
    !existing.originCountry?.trim() &&
    product.originCountry
      ? scrapedFieldLabels.originCountry
      : null,
    !isFieldLocked(locks, "defaultUnitPrice") &&
    existing.defaultUnitPrice == null &&
    product.price != null
      ? scrapedFieldLabels.defaultUnitPrice
      : null,
    !isFieldLocked(locks, "sourceUrl") &&
    !existing.sourceUrl?.trim() &&
    product.sourceUrl
      ? scrapedFieldLabels.sourceUrl
      : null,
    !isFieldLocked(locks, "imageUrl") &&
    !existing.imageUrl?.trim() &&
    product.imageUrl
      ? scrapedFieldLabels.imageUrl
      : null,
  ].filter(Boolean) as string[];
}

async function linkScrapedCatalogPdfs(
  db: ImportDb,
  materialId: number,
  product: ScrapedShopProduct,
  required = false,
) {
  if (product.catalogPdfUrls.length === 0) {
    return;
  }
  try {
    await attachCatalogPdfUrlsToMaterial(
      db,
      product.catalogPdfUrls,
      materialId,
      {
        sourceType: "detected",
        linkSource: "scrape",
        fallbackTitle: product.name,
        supplier: product.manufacturer,
      },
    );
  } catch (error) {
    if (required) {
      throw error;
    }
    // Catalog PDF linking must not fail the product import.
  }
}

function importMessageForCreated(product: ScrapedShopProduct) {
  const fields = availableScrapedFieldLabels(product);
  return fields.length > 0
    ? `Đã nhập: ${fields.join(", ")}.`
    : "Đã tạo vật tư, còn thiếu thông tin catalog.";
}

function importMessageForUpdated(
  existing: MaterialRow,
  product: ScrapedShopProduct,
  locks: Partial<Record<MaterialFieldLockKey, boolean>> = {},
) {
  const fields = filledExistingMaterialFieldLabels(existing, product, locks);
  const lockedCount = countLockedFields(locks);
  const lockedSuffix =
    lockedCount > 0 ? ` Đã bỏ qua ${lockedCount} trường đã khóa.` : "";
  return fields.length > 0
    ? `Bổ sung trường trống: ${fields.join(", ")}.${lockedSuffix}`
    : `Không ghi đè dữ liệu catalog đã có; đã cập nhật nguồn giá.${lockedSuffix}`;
}

async function loadLiveMaterialRow(db: AppDb, materialId: number) {
  const [row] = await db
    .select()
    .from(materials)
    .where(and(eq(materials.id, materialId), isNull(materials.deletedAt)))
    .limit(1);

  return row ?? null;
}

async function autoMatchFromCandidate(
  db: AppDb,
  candidate: { materialId: number; score: number },
  indexes: MaterialLookupIndexes,
) {
  const materialRow = await loadLiveMaterialRow(db, candidate.materialId);
  if (!materialRow) {
    return null;
  }

  indexMaterialRow(indexes, materialRow);
  return {
    action: "auto_matched" as const,
    confidence: candidate.score,
    materialRow,
  };
}

async function tryFuzzyMatch(
  db: AppDb,
  product: ScrapedShopProduct,
  unit: string,
  indexes: MaterialLookupIndexes,
  options: ClassifyOptions = {},
): Promise<{
  action: "auto_matched" | "no_match";
  confidence: number;
  materialRow?: MaterialRow;
} | null> {
  try {
    const hash = hashScrapedProduct(product);

    const cached = await getCachedDecision(db, hash);
    if (cached) {
      if (cached.status === "rejected") {
        return null;
      }
      if (cached.matchedMaterialId) {
        const cachedMatch = await autoMatchFromCandidate(
          db,
          { materialId: cached.matchedMaterialId, score: cached.confidence },
          indexes,
        );
        if (cachedMatch) {
          return cachedMatch;
        }
      }
    }

    const candidates = await findFuzzyCandidates(db, product);
    if (candidates.length === 0) return null;

    const candidateThreshold = await resolveAiMatchCandidateThreshold();
    const topCandidate = candidates[0];
    if (!topCandidate || topCandidate.score < candidateThreshold) {
      return null;
    }

    if (options.dryRun) {
      return autoMatchFromCandidate(db, topCandidate, indexes);
    }

    const decision = await saveMatchDecision(db, product, candidates, {
      candidateThreshold,
      scrapeJobId: options.scrapeJobId,
    });

    if (decision.action === "auto_matched" && decision.matchedMaterialId) {
      return autoMatchFromCandidate(
        db,
        { materialId: decision.matchedMaterialId, score: decision.confidence },
        indexes,
      );
    }

    return null;
  } catch (error) {
    log.warn("fuzzy_match_failed", {
      sourceUrl: product.sourceUrl,
      error,
    });
    return null;
  }
}

export const importScrapedProducts = traceFn(
  log,
  "importScrapedProducts",
  _importScrapedProducts,
);
export const previewShopImportProducts = traceFn(
  log,
  "previewShopImportProducts",
  _previewShopImportProducts,
);
export const classifyScrapedProductForImport = traceFn(
  log,
  "classifyScrapedProductForImport",
  _classifyScrapedProductForImport,
);
export const applyScrapedProductToMaterial = traceFn(
  log,
  "applyScrapedProductToMaterial",
  _applyScrapedProductToMaterial,
);
