import { randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  not,
  or,
  sql,
} from "drizzle-orm";
import Papa from "papaparse";
import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { materials } from "~/server/db/schema";
import {
  parseWorkbookBase64,
  parseOptionalNumber,
  rowsFromMapping,
  type ColumnMapping,
} from "~/server/services/excel-workbook";
import type { db as appDb } from "~/server/db";
import { materialImageUrlFromScrape } from "~/lib/materials/image";
import {
  buildMaterialMetadata,
  fetchPriceFromUrl,
  normalizeMaterialMetadata,
  type MaterialMetadata,
  type MaterialPriceSource,
} from "~/server/services/material-price-sources";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  SHOP_DETAIL_ENRICHMENT_MODES,
  SHOP_SCRAPE_METHODS,
  type ScrapedShopProduct,
} from "~/server/services/shop-material-scraper";
import {
  cancelShopImportJob,
  getShopImportJob,
  startShopImportJob,
  type ShopImportJobItem,
  type ShopImportJobProgress,
} from "~/server/services/shop-import-jobs";
import {
  cancelShopScrapeJob,
  createExpiredShopScrapeJobSnapshot,
  getShopScrapeJob,
  startShopScrapeJob,
} from "~/server/services/shop-scrape-jobs";

type AppDb = typeof appDb;
type MaterialInput = z.infer<typeof materialInput>;
type MaterialRow = typeof materials.$inferSelect;

const materialSortByInput = z
  .enum([
    "updatedAt",
    "name",
    "unit",
    "category",
    "manufacturer",
    "originCountry",
    "defaultUnitPrice",
  ])
  .default("updatedAt");
const sortOrderInput = z.enum(["asc", "desc"]).default("desc");
const priceStatusInput = z.enum(["all", "priced", "missing"]).default("all");
const sourceStatusInput = z.enum(["all", "with", "without"]).default("all");
const MATERIAL_FILTER_OPTION_LIMIT = 200;
const MATERIAL_EXPORT_LIMIT = 10_000;

const materialInput = z.object({
  code: z.string().trim().optional(),
  name: z.string().trim().min(1),
  unit: z.string().trim().min(1),
  category: z.string().trim().optional(),
  specText: z.string().trim().optional(),
  manufacturer: z.string().trim().optional(),
  originCountry: z.string().trim().optional(),
  defaultUnitPrice: z.number().nonnegative().nullable().optional(),
  currency: z.string().trim().min(1).default("VND"),
  sourceUrl: z.string().trim().optional(),
  defaultDepreciation: z.number().nonnegative().default(1),
  defaultReusePct: z.number().int().min(0).max(100).default(0),
});

const materialSearchFiltersInput = z.object({
  keyword: z.string().trim().optional(),
  name: z.string().trim().optional(),
  unit: z.string().trim().optional(),
  category: z.string().trim().optional(),
  manufacturer: z.string().trim().optional(),
  originCountry: z.string().trim().optional(),
  priceStatus: priceStatusInput,
  sourceStatus: sourceStatusInput,
});

const shopScrapeInput = z
  .object({
    url: z.string().trim().min(1),
    scrapeMode: z.enum(["limited", "all"]).default("limited"),
    maxPages: z.number().int().min(1).max(100).nullable().optional(),
    maxProducts: z.number().int().min(1).max(2000).nullable().optional(),
    method: z.enum(SHOP_SCRAPE_METHODS).default("auto"),
    detailEnrichment: z.enum(SHOP_DETAIL_ENRICHMENT_MODES).default("none"),
  })
  .transform((input) => ({
    ...input,
    maxPages: input.scrapeMode === "all" ? null : (input.maxPages ?? 25),
    maxProducts: input.scrapeMode === "all" ? null : (input.maxProducts ?? 500),
  }));

const shopScrapeJobInput = z.object({
  jobId: z.string().uuid(),
});

const startShopImportJobInput = shopScrapeJobInput.extend({
  sourceUrls: z.array(z.string().min(1)).max(25_000).optional(),
});

const shopImportJobInput = z.object({
  jobId: z.string().uuid(),
});

const priceSourceBaseInput = z.object({
  label: z.string().trim().min(1),
  url: z.string().trim().optional().default(""),
  mode: z.enum(["linked", "fixed"]).default("linked"),
  fixedPrice: z.number().nonnegative().nullable().optional(),
  currency: z.string().trim().min(1).default("VND"),
  note: z.string().trim().optional().default(""),
  isPrimary: z.boolean().default(false),
});

const priceSourceInput = priceSourceBaseInput.superRefine((source, ctx) => {
  validatePriceSourceShape(source, ctx);
});

function validatePriceSourceShape(
  source: {
    mode: "linked" | "fixed";
    url?: string | null;
    fixedPrice?: number | null;
  },
  ctx: z.RefinementCtx,
) {
  if (source.mode === "linked" && !source.url?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["url"],
      message: "Nguồn theo link cần có URL.",
    });
  }

  if (source.mode === "fixed" && source.fixedPrice == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["fixedPrice"],
      message: "Nguồn giá cố định cần có giá.",
    });
  }
}

function assertValidPriceSource(source: MaterialPriceSource) {
  if (source.mode === "linked" && source.url.trim().length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Nguồn theo link cần có URL.",
    });
  }

  if (source.mode === "fixed" && source.fixedPrice == null) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Nguồn giá cố định cần có giá.",
    });
  }
}

function parseMaterialsCsv(csv: string) {
  const result = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim().toLowerCase(),
    transform: (value) => value.trim(),
  });

  const emptyToUndefined = (value: string | undefined) =>
    value && value.length > 0 ? value : undefined;
  const optionalNumber = (value: string | undefined) => {
    const raw = emptyToUndefined(value);
    if (!raw) {
      return null;
    }
    return parseOptionalNumber(raw) ?? Number.NaN;
  };
  const numberOrDefault = (value: string | undefined, fallback: number) => {
    const raw = emptyToUndefined(value);
    if (!raw) {
      return fallback;
    }
    return parseOptionalNumber(raw) ?? Number.NaN;
  };

  return {
    rows: result.data.map((row) => ({
      code: emptyToUndefined(row.code),
      name: row.name ?? "",
      unit: row.unit ?? "",
      category: emptyToUndefined(row.category),
      specText: emptyToUndefined(row.spec_text),
      manufacturer: emptyToUndefined(row.manufacturer),
      originCountry: emptyToUndefined(row.origin_country),
      defaultUnitPrice: optionalNumber(row.default_unit_price),
      currency: emptyToUndefined(row.currency) ?? "VND",
      sourceUrl: emptyToUndefined(row.source_url),
      defaultDepreciation: numberOrDefault(row.default_depreciation, 1),
      defaultReusePct: Math.trunc(numberOrDefault(row.default_reuse_pct, 0)),
    })),
    errors: result.errors.map((error) => {
      const rowLabel =
        typeof error.row === "number" ? `Dòng ${error.row + 2}` : "CSV";
      return `${rowLabel}: ${error.message}`;
    }),
  };
}

async function assertMaterialCodeAvailable(
  db: AppDb,
  code: string | null | undefined,
  excludeId?: number,
) {
  const normalizedCode = code?.trim();
  if (!normalizedCode) {
    return;
  }

  const [existing] = await db
    .select({ id: materials.id })
    .from(materials)
    .where(
      and(
        eq(materials.code, normalizedCode),
        isNull(materials.deletedAt),
        excludeId ? not(eq(materials.id, excludeId)) : undefined,
      ),
    )
    .limit(1);

  if (existing) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Mã vật tư "${normalizedCode}" đã tồn tại.`,
    });
  }
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
    sourceUrl: input.sourceUrl?.trim() ? input.sourceUrl : null,
    createdAt: now,
    updatedAt: now,
  };
}

function materialUpdateValues(input: MaterialInput, now: string) {
  const { createdAt, ...updateValues } = materialValues(input, now);
  void createdAt;
  return updateValues;
}

async function getActiveMaterialById(db: AppDb, id: number) {
  const [material] = await db
    .select()
    .from(materials)
    .where(and(eq(materials.id, id), isNull(materials.deletedAt)))
    .limit(1);

  if (!material) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Không tìm thấy vật tư.",
    });
  }

  return material;
}

function requireUpdatedMaterial<T>(material: T | undefined): T {
  if (!material) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Không tìm thấy vật tư.",
    });
  }

  return material;
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

type MaterialLookupIndexes = {
  bySourceUrl: Map<string, MaterialRow>;
  bySku: Map<string, MaterialRow>;
  byNameUnit: Map<string, MaterialRow>;
};

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

function materialFilterConditions(
  input: z.infer<typeof materialSearchFiltersInput>,
) {
  const keyword = input.keyword ? `%${input.keyword}%` : undefined;

  return [
    isNull(materials.deletedAt),
    keyword
      ? or(
          ilike(materials.name, keyword),
          ilike(materials.code, keyword),
          ilike(materials.unit, keyword),
          ilike(materials.category, keyword),
          ilike(materials.specText, keyword),
          ilike(materials.manufacturer, keyword),
          ilike(materials.originCountry, keyword),
        )
      : undefined,
    input.name ? eq(materials.name, input.name) : undefined,
    input.unit ? eq(materials.unit, input.unit) : undefined,
    input.category ? eq(materials.category, input.category) : undefined,
    input.manufacturer
      ? eq(materials.manufacturer, input.manufacturer)
      : undefined,
    input.originCountry
      ? eq(materials.originCountry, input.originCountry)
      : undefined,
    input.priceStatus === "priced"
      ? isNotNull(materials.defaultUnitPrice)
      : undefined,
    input.priceStatus === "missing"
      ? isNull(materials.defaultUnitPrice)
      : undefined,
    input.sourceStatus === "with"
      ? or(
          sql`nullif(btrim(${materials.sourceUrl}), '') is not null`,
          sql`jsonb_array_length(
            case
              when jsonb_typeof(${materials.metadataJson}->'priceSources') = 'array'
                then ${materials.metadataJson}->'priceSources'
              else '[]'::jsonb
            end
          ) > 0`,
        )
      : undefined,
    input.sourceStatus === "without"
      ? and(
          sql`nullif(btrim(${materials.sourceUrl}), '') is null`,
          sql`jsonb_array_length(
            case
              when jsonb_typeof(${materials.metadataJson}->'priceSources') = 'array'
                then ${materials.metadataJson}->'priceSources'
              else '[]'::jsonb
            end
          ) = 0`,
        )
      : undefined,
  ];
}

async function selectMaterialTextOptions(db: AppDb, column: AnyPgColumn) {
  const trimmedColumn = sql<string>`btrim(${column})`;
  const rows = await db
    .select({ value: trimmedColumn })
    .from(materials)
    .where(
      and(
        isNull(materials.deletedAt),
        sql`nullif(btrim(${column}), '') is not null`,
      ),
    )
    .groupBy(trimmedColumn)
    .orderBy(asc(trimmedColumn))
    .limit(MATERIAL_FILTER_OPTION_LIMIT + 1);

  const values = rows
    .map((row) => row.value.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "vi"));

  return {
    values: values.slice(0, MATERIAL_FILTER_OPTION_LIMIT),
    truncated: values.length > MATERIAL_FILTER_OPTION_LIMIT,
  };
}

function materialExportCsvRow(material: {
  code: string | null;
  name: string;
  unit: string;
  category: string | null;
  specText: string;
  manufacturer: string | null;
  originCountry: string | null;
  defaultUnitPrice: number | null;
  currency: string;
  sourceUrl: string | null;
  defaultDepreciation: number;
  defaultReusePct: number;
}) {
  return {
    code: material.code ?? "",
    name: material.name,
    unit: material.unit,
    category: material.category ?? "",
    spec_text: material.specText,
    manufacturer: material.manufacturer ?? "",
    origin_country: material.originCountry ?? "",
    default_unit_price:
      material.defaultUnitPrice == null ? "" : String(material.defaultUnitPrice),
    currency: material.currency,
    source_url: material.sourceUrl ?? "",
    default_depreciation: String(material.defaultDepreciation),
    default_reuse_pct: String(material.defaultReusePct),
  };
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
    }),
  };
}

type ImportScrapedProductsOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: ShopImportJobProgress) => void;
};

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
  ].filter(Boolean);
}

function filledExistingMaterialFieldLabels(
  existing: MaterialRow,
  product: ScrapedShopProduct,
) {
  return [
    !existing.category?.trim() && product.category
      ? scrapedFieldLabels.category
      : null,
    !existing.specText.trim() && product.specText.trim()
      ? scrapedFieldLabels.specText
      : null,
    !existing.manufacturer?.trim() && product.manufacturer
      ? scrapedFieldLabels.manufacturer
      : null,
    !existing.originCountry?.trim() && product.originCountry
      ? scrapedFieldLabels.originCountry
      : null,
    existing.defaultUnitPrice == null && product.price != null
      ? scrapedFieldLabels.defaultUnitPrice
      : null,
    !existing.sourceUrl?.trim() && product.sourceUrl
      ? scrapedFieldLabels.sourceUrl
      : null,
  ].filter(Boolean);
}

function importMessageForCreated(product: ScrapedShopProduct) {
  const fields = availableScrapedFieldLabels(product);
  return fields.length > 0
    ? `Đã nhập: ${fields.join(", ")}.`
    : "Đã tạo vật tư, còn thiếu thông tin catalog.";
}

function importMessageForUpdated(existing: MaterialRow, product: ScrapedShopProduct) {
  const fields = filledExistingMaterialFieldLabels(existing, product);
  return fields.length > 0
    ? `Bổ sung trường trống: ${fields.join(", ")}.`
    : "Không ghi đè dữ liệu catalog đã có; đã cập nhật nguồn giá.";
}

async function importScrapedProducts(
  db: AppDb,
  products: ScrapedShopProduct[],
  options: ImportScrapedProductsOptions = {},
) {
  if (products.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Không có sản phẩm scrape để nhập.",
    });
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
        const metadataJson = metadataForScrapedProduct(existing, product, now);
        const [row] = await db
          .update(materials)
          .set({
            category:
              existing.category?.trim() || !product.category
                ? existing.category
                : product.category,
            specText:
              existing.specText.trim() || !product.specText
                ? existing.specText
                : product.specText,
            manufacturer:
              existing.manufacturer?.trim() || !product.manufacturer
                ? existing.manufacturer
                : product.manufacturer,
            originCountry:
              existing.originCountry?.trim() || !product.originCountry
                ? existing.originCountry
                : product.originCountry,
            defaultUnitPrice:
              existing.defaultUnitPrice == null && product.price != null
                ? product.price
                : existing.defaultUnitPrice,
            currency:
              existing.defaultUnitPrice == null && product.price != null
                ? product.currency
                : existing.currency,
            sourceUrl: existing.sourceUrl?.trim()
              ? existing.sourceUrl
              : product.sourceUrl,
            imageUrl: materialImageUrlFromScrape(product.imageUrl),
            metadataJson,
            updatedAt: now,
          })
          .where(
            and(eq(materials.id, existing.id), isNull(materials.deletedAt)),
          )
          .returning();

        const updatedRow = requireUpdatedMaterial(row);
        indexMaterialRow(indexes, updatedRow);
        updated += 1;
        items.push({
          name,
          sourceUrl: product.sourceUrl,
          action: "updated",
          materialId: updatedRow.id,
          message: importMessageForUpdated(existing, product),
        });
        processed += 1;
        reportProgress(name, product.sourceUrl);
        continue;
      }

      const createInput: MaterialInput = {
        name,
        unit,
        category: product.category ?? undefined,
        specText: product.specText,
        manufacturer: product.manufacturer ?? undefined,
        originCountry: product.originCountry ?? undefined,
        defaultUnitPrice: product.price,
        currency: product.currency,
        sourceUrl: product.sourceUrl,
        defaultDepreciation: 1,
        defaultReusePct: 0,
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

type MaterialImportRow = {
  rowNumber: number;
  input: MaterialInput;
};

function importNameUnitKey(name: string, unit: string) {
  return `${name.trim().toLowerCase()}|${unit.trim().toLowerCase()}`;
}

async function materialNameUnitExists(
  db: AppDb,
  name: string,
  unit: string,
) {
  const [existing] = await db
    .select({ id: materials.id })
    .from(materials)
    .where(
      and(
        eq(materials.name, name.trim()),
        eq(materials.unit, unit.trim()),
        isNull(materials.deletedAt),
      ),
    )
    .limit(1);

  return Boolean(existing);
}

async function buildDuplicateMaterialName(
  db: AppDb,
  sourceName: string,
  unit: string,
) {
  const trimmedName = sourceName.trim();
  let candidate = `${trimmedName} (bản sao)`;
  let suffix = 2;

  while (await materialNameUnitExists(db, candidate, unit)) {
    candidate = `${trimmedName} (bản sao ${suffix})`;
    suffix += 1;
  }

  return candidate;
}

function cloneMaterialPriceSources(sources: MaterialPriceSource[]) {
  return sources.map((source) => ({
    ...source,
    id: randomUUID(),
  }));
}

const materialBulkPatchInput = z
  .object({
    category: z.string().trim().optional(),
    manufacturer: z.string().trim().optional(),
    originCountry: z.string().trim().optional(),
    defaultUnitPrice: z.number().nonnegative().nullable().optional(),
    currency: z.string().trim().min(1).optional(),
  })
  .refine(
    (patch) =>
      patch.category !== undefined ||
      patch.manufacturer !== undefined ||
      patch.originCountry !== undefined ||
      patch.defaultUnitPrice !== undefined ||
      patch.currency !== undefined,
    { message: "Cần ít nhất một trường cập nhật." },
  );

async function importMaterialRows(db: AppDb, rows: MaterialImportRow[]) {
  if (rows.length === 0) {
    return { inserted: 0, skipped: 0 };
  }

  const existingRows = await db
    .select({
      code: materials.code,
      name: materials.name,
      unit: materials.unit,
    })
    .from(materials)
    .where(isNull(materials.deletedAt));
  const existingCodes = new Set(
    existingRows
      .map((row) => row.code?.trim().toLowerCase())
      .filter((code): code is string => Boolean(code)),
  );
  const existingNameUnits = new Set(
    existingRows.map((row) => importNameUnitKey(row.name, row.unit)),
  );
  const values: Array<ReturnType<typeof materialValues>> = [];
  let skipped = 0;
  const now = new Date().toISOString();

  for (const row of rows) {
    const code = row.input.code?.trim().toLowerCase();
    const nameUnit = importNameUnitKey(row.input.name, row.input.unit);
    if ((code && existingCodes.has(code)) || existingNameUnits.has(nameUnit)) {
      skipped += 1;
      continue;
    }

    if (code) {
      existingCodes.add(code);
    }
    existingNameUnits.add(nameUnit);
    values.push(materialValues(row.input, now));
  }

  for (let start = 0; start < values.length; start += 500) {
    await db.insert(materials).values(values.slice(start, start + 500));
  }

  return { inserted: values.length, skipped };
}

function selectWorkbookSheet(
  workbook: Awaited<ReturnType<typeof parseWorkbookBase64>>,
  sheetName: string | undefined,
) {
  const requestedSheetName = sheetName?.trim();
  if (!requestedSheetName) {
    return workbook.sheets[0];
  }

  const sheet = workbook.sheets.find(
    (item) => item.name === requestedSheetName,
  );
  if (!sheet) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Không tìm thấy sheet "${requestedSheetName}".`,
    });
  }

  return sheet;
}

export const materialRouter = createTRPCRouter({
  getById: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      return getActiveMaterialById(ctx.db, input.id);
    }),

  addPriceSource: publicProcedure
    .input(
      z.object({
        materialId: z.number().int().positive(),
        source: priceSourceInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const material = await getActiveMaterialById(ctx.db, input.materialId);
      const metadata = normalizeMaterialMetadata(material.metadataJson);
      const now = new Date().toISOString();
      const source: MaterialPriceSource = {
        id: randomUUID(),
        label: input.source.label,
        url: input.source.url ?? "",
        mode: input.source.mode,
        fixedPrice: input.source.fixedPrice ?? null,
        lastPrice: null,
        lastPriceText: null,
        currency: input.source.currency,
        lastCheckedAt: null,
        note: input.source.note ?? "",
        isPrimary: input.source.isPrimary || metadata.priceSources.length === 0,
      };
      const priceSources = normalizePrimarySources(
        [...metadata.priceSources, source],
        source.isPrimary ? source.id : undefined,
      );
      const shouldApplyFixedPrice =
        source.isPrimary &&
        source.mode === "fixed" &&
        source.fixedPrice != null;

      const [updated] = await ctx.db
        .update(materials)
        .set({
          metadataJson: {
            ...material.metadataJson,
            ...buildMaterialMetadata({ priceSources }),
          },
          sourceUrl:
            source.isPrimary && source.url ? source.url : material.sourceUrl,
          defaultUnitPrice: shouldApplyFixedPrice
            ? source.fixedPrice
            : material.defaultUnitPrice,
          currency: shouldApplyFixedPrice ? source.currency : material.currency,
          updatedAt: now,
        })
        .where(
          and(eq(materials.id, input.materialId), isNull(materials.deletedAt)),
        )
        .returning();

      return { material: requireUpdatedMaterial(updated), source };
    }),

  updatePriceSource: publicProcedure
    .input(
      z.object({
        materialId: z.number().int().positive(),
        sourceId: z.string().min(1),
        patch: priceSourceBaseInput.partial(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const material = await getActiveMaterialById(ctx.db, input.materialId);
      const metadata = normalizeMaterialMetadata(material.metadataJson);
      const existing = metadata.priceSources.find(
        (source) => source.id === input.sourceId,
      );
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy link giá.",
        });
      }

      const nextSource: MaterialPriceSource = {
        ...existing,
        ...input.patch,
        fixedPrice:
          input.patch.fixedPrice === undefined
            ? existing.fixedPrice
            : (input.patch.fixedPrice ?? null),
        note: input.patch.note ?? existing.note,
        url: input.patch.url ?? existing.url,
        label: input.patch.label ?? existing.label,
        currency: input.patch.currency ?? existing.currency,
        mode: input.patch.mode ?? existing.mode,
        isPrimary: input.patch.isPrimary ?? existing.isPrimary,
      };
      assertValidPriceSource(nextSource);
      const priceSources = normalizePrimarySources(
        metadata.priceSources.map((source) =>
          source.id === input.sourceId ? nextSource : source,
        ),
        nextSource.isPrimary ? nextSource.id : undefined,
      );
      const primary = priceSources.find((source) => source.isPrimary);

      const [updated] = await ctx.db
        .update(materials)
        .set({
          metadataJson: {
            ...material.metadataJson,
            ...buildMaterialMetadata({ priceSources }),
          },
          sourceUrl:
            primary?.url != null && primary.url.length > 0
              ? primary.url
              : material.sourceUrl,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(eq(materials.id, input.materialId), isNull(materials.deletedAt)),
        )
        .returning();

      return { material: requireUpdatedMaterial(updated), source: nextSource };
    }),

  deletePriceSource: publicProcedure
    .input(
      z.object({
        materialId: z.number().int().positive(),
        sourceId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const material = await getActiveMaterialById(ctx.db, input.materialId);
      const metadata = normalizeMaterialMetadata(material.metadataJson);
      const priceSources = metadata.priceSources.filter(
        (source) => source.id !== input.sourceId,
      );
      if (priceSources.length === metadata.priceSources.length) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy link giá.",
        });
      }

      const deletedSource = metadata.priceSources.find(
        (source) => source.id === input.sourceId,
      );
      const normalizedSources =
        priceSources.some((source) => source.isPrimary) ||
        priceSources.length === 0
          ? priceSources
          : priceSources.map((source, index) => ({
              ...source,
              isPrimary: index === 0,
            }));
      const primary = normalizedSources.find((source) => source.isPrimary);
      const deletedSourceUrl = deletedSource?.url.trim();
      const currentSourceUrl = material.sourceUrl?.trim();
      const shouldClearCurrentSourceUrl =
        deletedSourceUrl != null &&
        deletedSourceUrl.length > 0 &&
        currentSourceUrl === deletedSourceUrl;
      const nextSourceUrl =
        shouldClearCurrentSourceUrl && primary?.url.trim()
          ? primary.url
          : shouldClearCurrentSourceUrl
            ? null
            : material.sourceUrl;

      const [updated] = await ctx.db
        .update(materials)
        .set({
          metadataJson: {
            ...material.metadataJson,
            ...buildMaterialMetadata({ priceSources: normalizedSources }),
          },
          sourceUrl: nextSourceUrl,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(eq(materials.id, input.materialId), isNull(materials.deletedAt)),
        )
        .returning();

      return requireUpdatedMaterial(updated);
    }),

  refreshPriceSource: publicProcedure
    .input(
      z.object({
        materialId: z.number().int().positive(),
        sourceId: z.string().min(1),
        updateDefaultPrice: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const material = await getActiveMaterialById(ctx.db, input.materialId);
      const metadata = normalizeMaterialMetadata(material.metadataJson);
      const source = metadata.priceSources.find(
        (item) => item.id === input.sourceId,
      );
      if (!source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy link giá.",
        });
      }
      if (source.mode !== "linked" || !source.url) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Nguồn giá này không phải link có thể cập nhật.",
        });
      }

      let result: Awaited<ReturnType<typeof fetchPriceFromUrl>>;
      try {
        result = await fetchPriceFromUrl(source.url);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Không thể đọc giá từ link sản phẩm.",
        });
      }
      const checkedAt = new Date().toISOString();
      const nextSource: MaterialPriceSource = {
        ...source,
        lastPrice: result.price,
        lastPriceText: result.priceText,
        lastCheckedAt: checkedAt,
      };
      const priceSources = metadata.priceSources.map((item) =>
        item.id === source.id ? nextSource : item,
      );
      const nextDefaultPrice =
        input.updateDefaultPrice && result.price != null
          ? result.price
          : material.defaultUnitPrice;

      const [updated] = await ctx.db
        .update(materials)
        .set({
          metadataJson: {
            ...material.metadataJson,
            ...buildMaterialMetadata({ priceSources }),
          },
          defaultUnitPrice: nextDefaultPrice,
          sourceUrl: source.isPrimary ? source.url : material.sourceUrl,
          updatedAt: checkedAt,
        })
        .where(
          and(eq(materials.id, input.materialId), isNull(materials.deletedAt)),
        )
        .returning();

      return { material: requireUpdatedMaterial(updated), source: nextSource };
    }),

  applyPriceSourcePrice: publicProcedure
    .input(
      z.object({
        materialId: z.number().int().positive(),
        sourceId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const material = await getActiveMaterialById(ctx.db, input.materialId);
      const metadata = normalizeMaterialMetadata(material.metadataJson);
      const source = metadata.priceSources.find(
        (item) => item.id === input.sourceId,
      );
      if (!source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy link giá.",
        });
      }

      const price =
        source.mode === "fixed" ? source.fixedPrice : source.lastPrice;
      if (price == null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Nguồn giá chưa có giá để áp dụng.",
        });
      }

      const [updated] = await ctx.db
        .update(materials)
        .set({
          defaultUnitPrice: price,
          currency: source.currency,
          sourceUrl: source.url.trim() ? source.url : material.sourceUrl,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(eq(materials.id, input.materialId), isNull(materials.deletedAt)),
        )
        .returning();

      return requireUpdatedMaterial(updated);
    }),

  startShopScrapeJob: publicProcedure
    .input(shopScrapeInput)
    .mutation(({ input }) => startShopScrapeJob(input)),

  getShopScrapeJob: publicProcedure
    .input(shopScrapeJobInput)
    .query(({ input }) => {
      const job = getShopScrapeJob(input.jobId);
      return job ?? createExpiredShopScrapeJobSnapshot(input.jobId);
    }),

  cancelShopScrapeJob: publicProcedure
    .input(shopScrapeJobInput)
    .mutation(({ input }) => {
      const job = cancelShopScrapeJob(input.jobId);
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy job scrape shop.",
        });
      }
      return job;
    }),

  startShopImportJob: publicProcedure
    .input(startShopImportJobInput)
    .mutation(({ ctx, input }) => {
      const job = getShopScrapeJob(input.jobId);
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy job scrape shop.",
        });
      }

      if (job.status === "queued" || job.status === "running") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Đợi job scrape hoàn tất hoặc hủy trước khi nhập catalog.",
        });
      }

      if (job.status === "failed" && job.products.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: job.error ?? "Job scrape shop đã lỗi.",
        });
      }

      const sourceUrlSet = input.sourceUrls ? new Set(input.sourceUrls) : null;
      const products = sourceUrlSet
        ? job.products.filter((product) => sourceUrlSet.has(product.sourceUrl))
        : job.products;
      if (products.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Không có sản phẩm scrape để nhập.",
        });
      }

      return startShopImportJob(
        {
          scrapeJobId: job.id,
          products,
        },
        ({ products: importProducts, signal, onProgress }) =>
          importScrapedProducts(ctx.db, importProducts, {
            signal,
            onProgress,
          }),
      );
    }),

  getShopImportJob: publicProcedure
    .input(shopImportJobInput)
    .query(({ input }) => {
      const job = getShopImportJob(input.jobId);
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy job nhập catalog.",
        });
      }
      return job;
    }),

  cancelShopImportJob: publicProcedure
    .input(shopImportJobInput)
    .mutation(({ input }) => {
      const job = cancelShopImportJob(input.jobId);
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy job nhập catalog.",
        });
      }
      return job;
    }),

  searchMaterials: publicProcedure
    .input(
      materialSearchFiltersInput.extend({
        sortBy: materialSortByInput,
        sortOrder: sortOrderInput,
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const order =
        input.sortOrder === "asc"
          ? asc(materials[input.sortBy])
          : desc(materials[input.sortBy]);

      return ctx.db
        .select({
          id: materials.id,
          code: materials.code,
          name: materials.name,
          unit: materials.unit,
          category: materials.category,
          specText: materials.specText,
          manufacturer: materials.manufacturer,
          originCountry: materials.originCountry,
          defaultUnitPrice: materials.defaultUnitPrice,
          currency: materials.currency,
          sourceUrl: materials.sourceUrl,
          metadataJson: materials.metadataJson,
          updatedAt: materials.updatedAt,
        })
        .from(materials)
        .where(and(...materialFilterConditions(input)))
        .orderBy(order, desc(materials.updatedAt), asc(materials.id))
        .limit(input.limit)
        .offset(input.offset);
    }),

  getMaterialSummary: publicProcedure
    .input(materialSearchFiltersInput)
    .query(async ({ ctx, input }) => {
      const [summary] = await ctx.db
        .select({
          total: sql<number>`count(*)::int`.as("total"),
          priced:
            sql<number>`count(*) filter (where ${materials.defaultUnitPrice} is not null)::int`.as(
              "priced",
            ),
          withSources: sql<number>`count(*) filter (
            where nullif(btrim(${materials.sourceUrl}), '') is not null
              or jsonb_array_length(
                case
                  when jsonb_typeof(${materials.metadataJson}->'priceSources') = 'array'
                    then ${materials.metadataJson}->'priceSources'
                  else '[]'::jsonb
                end
              ) > 0
          )::int`.as("withSources"),
          withManufacturer: sql<number>`count(*) filter (
            where nullif(btrim(${materials.manufacturer}), '') is not null
          )::int`.as("withManufacturer"),
          uniqueManufacturers:
            sql<number>`count(distinct nullif(btrim(${materials.manufacturer}), ''))::int`.as(
              "uniqueManufacturers",
            ),
          withOrigin: sql<number>`count(*) filter (
            where nullif(btrim(${materials.originCountry}), '') is not null
          )::int`.as("withOrigin"),
          uniqueOrigins:
            sql<number>`count(distinct nullif(btrim(${materials.originCountry}), ''))::int`.as(
              "uniqueOrigins",
            ),
        })
        .from(materials)
        .where(and(...materialFilterConditions(input)));

      const total = Number(summary?.total ?? 0);
      const priced = Number(summary?.priced ?? 0);

      return {
        total,
        priced,
        missingPrice: total - priced,
        withSources: Number(summary?.withSources ?? 0),
        withManufacturer: Number(summary?.withManufacturer ?? 0),
        uniqueManufacturers: Number(summary?.uniqueManufacturers ?? 0),
        withOrigin: Number(summary?.withOrigin ?? 0),
        uniqueOrigins: Number(summary?.uniqueOrigins ?? 0),
      };
    }),

  getMaterialFilterOptions: publicProcedure.query(async ({ ctx }) => {
    const [names, units, categories, manufacturers, origins] =
      await Promise.all([
        selectMaterialTextOptions(ctx.db, materials.name),
        selectMaterialTextOptions(ctx.db, materials.unit),
        selectMaterialTextOptions(ctx.db, materials.category),
        selectMaterialTextOptions(ctx.db, materials.manufacturer),
        selectMaterialTextOptions(ctx.db, materials.originCountry),
      ]);

    return {
      names: names.values,
      units: units.values,
      categories: categories.values,
      manufacturers: manufacturers.values,
      origins: origins.values,
      truncated: {
        names: names.truncated,
        units: units.truncated,
        categories: categories.truncated,
        manufacturers: manufacturers.truncated,
        origins: origins.truncated,
      },
    };
  }),

  exportMaterialsCsv: publicProcedure
    .input(
      materialSearchFiltersInput.extend({
        sortBy: materialSortByInput,
        sortOrder: sortOrderInput,
      }),
    )
    .query(async ({ ctx, input }) => {
      const order =
        input.sortOrder === "asc"
          ? asc(materials[input.sortBy])
          : desc(materials[input.sortBy]);

      const rows = await ctx.db
        .select({
          code: materials.code,
          name: materials.name,
          unit: materials.unit,
          category: materials.category,
          specText: materials.specText,
          manufacturer: materials.manufacturer,
          originCountry: materials.originCountry,
          defaultUnitPrice: materials.defaultUnitPrice,
          currency: materials.currency,
          sourceUrl: materials.sourceUrl,
          defaultDepreciation: materials.defaultDepreciation,
          defaultReusePct: materials.defaultReusePct,
        })
        .from(materials)
        .where(and(...materialFilterConditions(input)))
        .orderBy(order, desc(materials.updatedAt), asc(materials.id))
        .limit(MATERIAL_EXPORT_LIMIT);

      const csv = Papa.unparse(rows.map(materialExportCsvRow));
      return {
        csv,
        count: rows.length,
        truncated: rows.length >= MATERIAL_EXPORT_LIMIT,
      };
    }),

  createMaterial: publicProcedure
    .input(materialInput)
    .mutation(async ({ ctx, input }) => {
      const now = new Date().toISOString();
      await assertMaterialCodeAvailable(ctx.db, input.code);
      const [created] = await ctx.db
        .insert(materials)
        .values(materialValues(input, now))
        .returning();

      return created;
    }),

  upsertMaterial: publicProcedure
    .input(
      z.object({
        id: z.number().int().positive().optional(),
        patch: materialInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date().toISOString();
      if (input.id) {
        await assertMaterialCodeAvailable(ctx.db, input.patch.code, input.id);
        const [updated] = await ctx.db
          .update(materials)
          .set(materialUpdateValues(input.patch, now))
          .where(and(eq(materials.id, input.id), isNull(materials.deletedAt)))
          .returning();
        if (!updated) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Không tìm thấy vật tư.",
          });
        }
        return updated;
      }

      await assertMaterialCodeAvailable(ctx.db, input.patch.code);
      const [created] = await ctx.db
        .insert(materials)
        .values(materialValues(input.patch, now))
        .returning();
      return created;
    }),

  updateMaterial: publicProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        patch: materialInput.partial(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const patch = input.patch;
      await assertMaterialCodeAvailable(ctx.db, patch.code, input.id);
      const [updated] = await ctx.db
        .update(materials)
        .set({
          ...patch,
          code: patch.code === "" ? null : patch.code,
          category: patch.category === "" ? null : patch.category,
          manufacturer: patch.manufacturer === "" ? null : patch.manufacturer,
          originCountry:
            patch.originCountry === "" ? null : patch.originCountry,
          defaultUnitPrice:
            patch.defaultUnitPrice === undefined
              ? undefined
              : patch.defaultUnitPrice,
          sourceUrl: patch.sourceUrl === "" ? null : patch.sourceUrl,
          updatedAt: new Date().toISOString(),
        })
        .where(and(eq(materials.id, input.id), isNull(materials.deletedAt)))
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy vật tư.",
        });
      }

      return updated;
    }),

  deleteMaterial: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(materials)
        .set({
          deletedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(and(eq(materials.id, input.id), isNull(materials.deletedAt)))
        .returning({ id: materials.id });

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy vật tư.",
        });
      }

      return { success: true };
    }),

  duplicateMaterial: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const source = await getActiveMaterialById(ctx.db, input.id);
      const metadata = normalizeMaterialMetadata(source.metadataJson);
      const now = new Date().toISOString();
      const duplicateName = await buildDuplicateMaterialName(
        ctx.db,
        source.name,
        source.unit,
      );
      const priceSources = cloneMaterialPriceSources(metadata.priceSources);

      const [created] = await ctx.db
        .insert(materials)
        .values({
          code: null,
          name: duplicateName,
          unit: source.unit,
          category: source.category,
          specText: source.specText,
          manufacturer: source.manufacturer,
          originCountry: source.originCountry,
          defaultUnitPrice: source.defaultUnitPrice,
          currency: source.currency,
          sourceUrl: source.sourceUrl,
          defaultDepreciation: source.defaultDepreciation,
          defaultReusePct: source.defaultReusePct,
          metadataJson: buildMaterialMetadata({ priceSources }),
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      return requireUpdatedMaterial(created);
    }),

  bulkUpdateMaterials: publicProcedure
    .input(
      z.object({
        ids: z.array(z.number().int().positive()).min(1).max(100),
        patch: materialBulkPatchInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date().toISOString();
      const patch = input.patch;
      const setValues: {
        updatedAt: string;
        category?: string | null;
        manufacturer?: string | null;
        originCountry?: string | null;
        defaultUnitPrice?: number | null;
        currency?: string;
      } = { updatedAt: now };

      if (patch.category !== undefined) {
        setValues.category = patch.category || null;
      }
      if (patch.manufacturer !== undefined) {
        setValues.manufacturer = patch.manufacturer || null;
      }
      if (patch.originCountry !== undefined) {
        setValues.originCountry = patch.originCountry || null;
      }
      if (patch.defaultUnitPrice !== undefined) {
        setValues.defaultUnitPrice = patch.defaultUnitPrice;
      }
      if (patch.currency !== undefined) {
        setValues.currency = patch.currency;
      }

      const updated = await ctx.db
        .update(materials)
        .set(setValues)
        .where(
          and(inArray(materials.id, input.ids), isNull(materials.deletedAt)),
        )
        .returning({ id: materials.id });

      return { count: updated.length };
    }),

  importMaterialsCsv: publicProcedure
    .input(z.object({ csv: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { rows, errors } = parseMaterialsCsv(input.csv);
      const validRows: MaterialImportRow[] = [];

      for (const [index, row] of rows.entries()) {
        const parsed = materialInput.safeParse(row);
        if (!parsed.success) {
          errors.push(
            `Dòng ${index + 2}: ${parsed.error.issues[0]?.message ?? "Không hợp lệ"}`,
          );
          continue;
        }

        validRows.push({
          rowNumber: index + 2,
          input: parsed.data,
        });
      }

      const { inserted, skipped } = await importMaterialRows(ctx.db, validRows);
      return { inserted, skipped, errors };
    }),

  previewMaterialsXlsx: publicProcedure
    .input(
      z.object({
        fileName: z.string().min(1).default("materials.xlsx"),
        workbookBase64: z.string().min(1),
        sheetName: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const workbook = await parseWorkbookBase64(
        input.fileName,
        input.workbookBase64,
      );
      const selectedSheet = selectWorkbookSheet(workbook, input.sheetName);
      if (!selectedSheet) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Không tìm thấy trang tính hợp lệ.",
        });
      }

      return {
        selectedSheetName: selectedSheet.name,
        warnings: workbook.warnings,
        sheets: workbook.sheets.map((sheet) => {
          let previewRows: ReturnType<typeof rowsFromMapping> = [];
          const warnings = [...sheet.warnings];
          try {
            previewRows = rowsFromMapping(sheet, sheet.suggestedMapping).slice(
              0,
              10,
            );
          } catch (error) {
            warnings.push(
              error instanceof Error
                ? error.message
                : "Không tạo được preview cho sheet này.",
            );
          }

          return {
            name: sheet.name,
            detectedHeaderRowIndex: sheet.detectedHeaderRowIndex,
            activeHeaderRowIndex: sheet.activeHeaderRowIndex,
            rowCount: sheet.rows.length,
            importablePreviewCount: previewRows.length,
            headers: sheet.headers.slice(0, 24),
            suggestedMapping: sheet.suggestedMapping,
            warnings,
            previewRows: previewRows.map((row) => ({
              rowNumber: row.originalRowIndex,
              name: row.productName,
              unit: row.unit,
              specText: row.specText,
              details: row.notes,
              manufacturer: row.vendorHint,
              originCountry: row.originHint,
              defaultUnitPrice: row.unitPrice,
              sourceUrl: row.sourceUrl,
            })),
          };
        }),
      };
    }),

  importMaterialsXlsx: publicProcedure
    .input(
      z.object({
        fileName: z.string().min(1).default("materials.xlsx"),
        workbookBase64: z.string().min(1),
        sheetName: z.string().optional(),
        mapping: z.record(z.string(), z.string().nullable()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const workbook = await parseWorkbookBase64(
        input.fileName,
        input.workbookBase64,
      );
      const sheet = selectWorkbookSheet(workbook, input.sheetName);
      if (!sheet) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Không tìm thấy trang tính hợp lệ.",
        });
      }
      const rows = rowsFromMapping(
        sheet,
        (input.mapping ?? sheet.suggestedMapping) as ColumnMapping,
      );
      const errors: string[] = [];
      const validRows: MaterialImportRow[] = [];
      for (const [index, row] of rows.entries()) {
        const parsed = materialInput.safeParse({
          name: row.productName,
          unit: row.unit,
          specText: row.specText,
          manufacturer: row.vendorHint ?? undefined,
          originCountry: row.originHint ?? undefined,
          defaultUnitPrice: row.unitPrice,
          currency: row.currency,
          sourceUrl: row.sourceUrl ?? undefined,
          defaultDepreciation: row.depreciation,
          defaultReusePct: row.reusePct,
        });
        if (!parsed.success) {
          errors.push(
            `Dòng ${row.originalRowIndex || index + 2}: ${parsed.error.issues[0]?.message ?? "Không hợp lệ"}`,
          );
          continue;
        }
        validRows.push({
          rowNumber: row.originalRowIndex || index + 2,
          input: parsed.data,
        });
      }

      const { inserted, skipped } = await importMaterialRows(ctx.db, validRows);
      return { inserted, skipped, errors, warnings: workbook.warnings };
    }),

  deleteMany: publicProcedure
    .input(
      z.object({ ids: z.array(z.number().int().positive()).min(1).max(100) }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date().toISOString();
      const updated = await ctx.db
        .update(materials)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(inArray(materials.id, input.ids), isNull(materials.deletedAt)),
        )
        .returning({ id: materials.id });
      return { count: updated.length };
    }),
});
