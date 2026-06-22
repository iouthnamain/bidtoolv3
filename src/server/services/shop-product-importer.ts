import { randomUUID } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import { materialImageUrlFromScrape } from "~/lib/materials/image";
import type { db as appDb } from "~/server/db";
import { materials } from "~/server/db/schema";
import {
  findFuzzyCandidates,
  getCachedDecision,
  hashScrapedProduct,
  saveMatchDecision,
} from "~/server/services/ai-product-matcher";
import { attachCatalogPdfUrlsToMaterial } from "~/server/services/catalog-documents";
import {
  resolveAiMatchAutoThreshold,
  resolveAiMatchCandidateThreshold,
} from "~/server/services/app-settings";
import {
  buildMaterialMetadata,
  normalizeMaterialMetadata,
  type MaterialFieldLockKey,
  type MaterialMetadata,
  type MaterialPriceSource,
} from "~/server/services/material-price-sources";
import type {
  ShopImportJobItem,
  ShopImportJobProgress,
  ShopImportJobResult,
} from "~/server/services/shop-import-jobs";
import type { ScrapedShopProduct } from "~/server/services/shop-material-scraper";
import { createLogger, traceFn } from "~/server/lib/logger";
const log = createLogger("services-shop-product-importer");

type AppDb = typeof appDb;
type MaterialRow = typeof materials.$inferSelect;

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

export type ImportScrapedProductsOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: ShopImportJobProgress) => void;
};

async function _importScrapedProducts(
  db: AppDb,
  products: ScrapedShopProduct[],
  options: ImportScrapedProductsOptions = {},
): Promise<ShopImportJobResult> {
  if (products.length === 0) {
    throw new Error("Không có sản phẩm scrape để nhập.");
  }

  throwIfImportAborted(options.signal);
  const existingMaterials = await db
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
    if (!name) {
      skipped += 1;
      items.push({
        name: "(không có tên)",
        sourceUrl: product.sourceUrl,
        action: "skipped",
        message: "Bỏ qua vì thiếu tên sản phẩm.",
      });
      processed += 1;
      reportProgress("(không có tên)", product.sourceUrl);
      continue;
    }

    const scrapedUnit = product.unit?.trim();
    const unit =
      scrapedUnit && scrapedUnit.length > 0 ? scrapedUnit : "unknown";
    const now = new Date().toISOString();

    try {
      const existing = findExistingScrapedMaterial(indexes, {
        ...product,
        unit,
      });
      if (existing) {
        const locks =
          normalizeMaterialMetadata(existing.metadataJson).fieldLocks ?? {};
        const metadataJson = metadataForScrapedProduct(existing, product, now);
        const [row] = await db
          .update(materials)
          .set({
            category: applyLockedFillEmptyField(
              locks,
              "category",
              existing.category,
              product.category,
            ),
            specText:
              applyLockedFillEmptyField(
                locks,
                "specText",
                existing.specText,
                product.specText,
              ) ?? existing.specText,
            manufacturer: applyLockedFillEmptyField(
              locks,
              "manufacturer",
              existing.manufacturer,
              product.manufacturer,
            ),
            originCountry: applyLockedFillEmptyField(
              locks,
              "originCountry",
              existing.originCountry,
              product.originCountry,
            ),
            defaultUnitPrice: applyLockedPriceField(
              locks,
              existing.defaultUnitPrice,
              product.price,
            ),
            currency: applyLockedCurrencyField(
              locks,
              existing.defaultUnitPrice,
              existing.currency,
              product.price,
              product.currency,
            ),
            sourceUrl: applyLockedFillEmptyField(
              locks,
              "sourceUrl",
              existing.sourceUrl,
              product.sourceUrl,
            ),
            imageUrl: isFieldLocked(locks, "imageUrl")
              ? existing.imageUrl
              : materialImageUrlFromScrape(product.imageUrl),
            metadataJson,
            updatedAt: now,
          })
          .where(
            and(eq(materials.id, existing.id), isNull(materials.deletedAt)),
          )
          .returning();

        const updatedRow = requireUpdatedMaterial(row);
        indexMaterialRow(indexes, updatedRow);
        await linkScrapedCatalogPdfs(db, updatedRow.id, product);
        updated += 1;
        items.push({
          name,
          sourceUrl: product.sourceUrl,
          action: "updated",
          materialId: updatedRow.id,
          message: importMessageForUpdated(existing, product, locks),
        });
        processed += 1;
        reportProgress(name, product.sourceUrl);
        continue;
      }

      // Tier 4: Fuzzy matching via pg_trgm + multi-signal scoring
      const fuzzyResult = await tryFuzzyMatch(db, product, unit, indexes);
      if (fuzzyResult) {
        if (fuzzyResult.action === "auto_matched" && fuzzyResult.materialRow) {
          const locks =
            normalizeMaterialMetadata(fuzzyResult.materialRow.metadataJson)
              .fieldLocks ?? {};
          const metadataJson = metadataForScrapedProduct(
            fuzzyResult.materialRow,
            product,
            now,
          );
          const [row] = await db
            .update(materials)
            .set({
              category: applyLockedFillEmptyField(
                locks,
                "category",
                fuzzyResult.materialRow.category,
                product.category,
              ),
              specText:
                applyLockedFillEmptyField(
                  locks,
                  "specText",
                  fuzzyResult.materialRow.specText,
                  product.specText,
                ) ?? fuzzyResult.materialRow.specText,
              manufacturer: applyLockedFillEmptyField(
                locks,
                "manufacturer",
                fuzzyResult.materialRow.manufacturer,
                product.manufacturer,
              ),
              originCountry: applyLockedFillEmptyField(
                locks,
                "originCountry",
                fuzzyResult.materialRow.originCountry,
                product.originCountry,
              ),
              defaultUnitPrice: applyLockedPriceField(
                locks,
                fuzzyResult.materialRow.defaultUnitPrice,
                product.price,
              ),
              currency: applyLockedCurrencyField(
                locks,
                fuzzyResult.materialRow.defaultUnitPrice,
                fuzzyResult.materialRow.currency,
                product.price,
                product.currency,
              ),
              sourceUrl: applyLockedFillEmptyField(
                locks,
                "sourceUrl",
                fuzzyResult.materialRow.sourceUrl,
                product.sourceUrl,
              ),
              imageUrl: isFieldLocked(locks, "imageUrl")
                ? fuzzyResult.materialRow.imageUrl
                : materialImageUrlFromScrape(product.imageUrl),
              metadataJson,
              updatedAt: now,
            })
            .where(
              and(
                eq(materials.id, fuzzyResult.materialRow.id),
                isNull(materials.deletedAt),
              ),
            )
            .returning();

          const updatedRow = requireUpdatedMaterial(row);
          indexMaterialRow(indexes, updatedRow);
          await linkScrapedCatalogPdfs(db, updatedRow.id, product);
          updated += 1;
          items.push({
            name,
            sourceUrl: product.sourceUrl,
            action: "updated",
            materialId: updatedRow.id,
            message: `Ghép tự động (AI: ${(fuzzyResult.confidence * 100).toFixed(0)}%) với "${fuzzyResult.materialRow.name}".`,
          });
          processed += 1;
          reportProgress(name, product.sourceUrl);
          continue;
        }

        if (fuzzyResult.action === "pending_review") {
          skipped += 1;
          items.push({
            name,
            sourceUrl: product.sourceUrl,
            action: "skipped",
            message: `Tìm thấy ứng viên tương tự (${(fuzzyResult.confidence * 100).toFixed(0)}%), chờ xác nhận.`,
          });
          processed += 1;
          reportProgress(name, product.sourceUrl);
          continue;
        }
      }

      const createInput: MaterialInput = {
        name,
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
        name,
        sourceUrl: product.sourceUrl,
        action: "created",
        materialId: createdRow.id,
        message: importMessageForCreated(product),
      });
      processed += 1;
      reportProgress(name, product.sourceUrl);
    } catch (error) {
      failed += 1;
      items.push({
        name,
        sourceUrl: product.sourceUrl,
        action: "failed",
        message:
          error instanceof Error ? error.message : "Không thể lưu sản phẩm.",
      });
      processed += 1;
      reportProgress(name, product.sourceUrl);
    }
  }

  reportProgress(null, null);
  return { created, updated, skipped, failed, items };
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

function createMaterialLookupIndexes(
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

function applyLockedFillEmptyField(
  locks: Partial<Record<MaterialFieldLockKey, boolean>>,
  field: MaterialFieldLockKey,
  existing: string | null | undefined,
  scraped: string | null | undefined,
): string | undefined {
  if (isFieldLocked(locks, field)) {
    return existing ?? undefined;
  }
  const existingTrimmed = existing?.trim();
  if (existingTrimmed) {
    return existing ?? undefined;
  }
  const scrapedTrimmed = scraped?.trim();
  return scrapedTrimmed ? (scraped ?? undefined) : (existing ?? undefined);
}

function applyLockedPriceField(
  locks: Partial<Record<MaterialFieldLockKey, boolean>>,
  existingPrice: number | null,
  scrapedPrice: number | null,
) {
  if (isFieldLocked(locks, "defaultUnitPrice")) {
    return existingPrice;
  }
  return existingPrice == null && scrapedPrice != null
    ? scrapedPrice
    : existingPrice;
}

function applyLockedCurrencyField(
  locks: Partial<Record<MaterialFieldLockKey, boolean>>,
  existingPrice: number | null,
  existingCurrency: string,
  scrapedPrice: number | null,
  scrapedCurrency: string,
) {
  if (isFieldLocked(locks, "currency")) {
    return existingCurrency;
  }
  return existingPrice == null && scrapedPrice != null
    ? scrapedCurrency
    : existingCurrency;
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
  db: AppDb,
  materialId: number,
  product: ScrapedShopProduct,
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
  } catch {
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

async function tryFuzzyMatch(
  db: AppDb,
  product: ScrapedShopProduct,
  unit: string,
  indexes: MaterialLookupIndexes,
): Promise<{
  action: "auto_matched" | "pending_review" | "no_match";
  confidence: number;
  materialRow?: MaterialRow;
} | null> {
  const hash = hashScrapedProduct(product);

  const cached = await getCachedDecision(db, hash);
  if (cached) {
    if (cached.status === "accepted" && cached.matchedMaterialId) {
      const row = await db
        .select()
        .from(materials)
        .where(
          and(
            eq(materials.id, cached.matchedMaterialId),
            isNull(materials.deletedAt),
          ),
        )
        .limit(1);
      if (row[0]) {
        return {
          action: "auto_matched",
          confidence: cached.confidence,
          materialRow: row[0],
        };
      }
    }
    if (cached.status === "rejected") {
      return null;
    }
    if (cached.status === "pending") {
      return {
        action: "pending_review",
        confidence: cached.confidence,
      };
    }
  }

  const candidates = await findFuzzyCandidates(db, product);
  if (candidates.length === 0) return null;

  const decision = await saveMatchDecision(db, product, candidates, {
    autoThreshold: await resolveAiMatchAutoThreshold(),
    candidateThreshold: await resolveAiMatchCandidateThreshold(),
  });

  if (decision.action === "auto_matched" && decision.matchedMaterialId) {
    const row = await db
      .select()
      .from(materials)
      .where(
        and(
          eq(materials.id, decision.matchedMaterialId),
          isNull(materials.deletedAt),
        ),
      )
      .limit(1);
    if (row[0]) {
      indexMaterialRow(indexes, row[0]);
      return {
        action: "auto_matched",
        confidence: decision.confidence,
        materialRow: row[0],
      };
    }
  }

  if (decision.action === "pending_review") {
    return {
      action: "pending_review",
      confidence: decision.confidence,
    };
  }

  return null;
}

export const importScrapedProducts = traceFn(log, "importScrapedProducts", _importScrapedProducts);
