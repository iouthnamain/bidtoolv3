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

import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
  requirePermission,
} from "~/server/api/trpc";
import { creatorTenantId, tenantScopeValue } from "~/server/api/tenant-scope";
import {
  materialCatalogDocumentLinks,
  materialCatalogDocuments,
  materials,
} from "~/server/db/schema";
import {
  parseWorkbookBase64,
  parseOptionalNumber,
  rebuildSheetWithHeaderRow,
  rowsFromMapping,
  type ColumnMapping,
  type ParsedWorkbookSheet,
} from "~/server/services/excel-workbook";
import {
  extractRowFields,
  matchRows,
  writeEnrichedWorkbook,
  ENRICH_THRESHOLDS,
  MAX_ENRICH_ROWS,
  FILLABLE_FIELDS,
} from "~/server/services/excel-enrich";
import type { db as appDb } from "~/server/db";
import {
  formatCatalogPdfUrlsCell,
  parseCatalogPdfUrlsCell,
} from "~/lib/materials/catalog-pdf";
import { attachCatalogPdfUrlsToMaterial } from "~/server/services/catalog-documents";
import {
  buildMaterialMetadata,
  fetchPriceFromUrl,
  MATERIAL_FIELD_LOCK_KEYS,
  normalizeMaterialMetadata,
  type MaterialFieldLockKey,
  type MaterialPriceSource,
} from "~/server/services/material-price-sources";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  SHOP_DETAIL_ENRICHMENT_MODES,
  SHOP_SCRAPE_METHODS,
} from "~/server/services/shop-material-scraper";
import {
  cancelShopImportJob,
  getShopImportJobProgress,
  getShopImportJob,
  listShopImportJobs,
  startShopImportJob,
} from "~/server/services/shop-import-jobs";
import { previewShopImportJob } from "~/server/services/shop-import-preview";
import { ShopJobServiceError } from "~/server/services/shop-job-errors";
import { findFuzzyCandidates } from "~/server/services/ai-product-matcher";
import {
  enrichRowFromWeb,
  enrichRowFromWebResults,
} from "~/server/services/enrich-web-row";
import { buildSearchQueries } from "~/server/services/excel-research/query-builder";
import {
  rankSearchResults,
  searchWebForProduct,
} from "~/server/services/material-web-search";
import {
  addShopScrapeJobProduct,
  cancelShopScrapeJob,
  deleteShopScrapeJob,
  deleteShopScrapeJobProduct,
  deleteShopScrapeJobProducts,
  getShopScrapeJob,
  getShopScrapeJobProgress,
  listShopScrapeJobs,
  startShopScrapeJob,
  updateShopScrapeJobProduct,
} from "~/server/services/shop-scrape-jobs";

type AppDb = typeof appDb;
type MaterialInput = z.infer<typeof materialInput>;

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
const catalogStatusInput = z.enum(["all", "with", "without"]).default("all");
const MATERIAL_FILTER_OPTION_LIMIT = 200;
const MATERIAL_EXPORT_LIMIT = 10_000;
const SHOP_SCRAPE_EXPORT_LIMIT = 10_000;
const SHOP_SCRAPE_ALL_MAX_PAGES = 100;
const SHOP_SCRAPE_ALL_MAX_PRODUCTS = 2_000;

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
});

const enrichWebRowInput = z.object({
  name: z.string().trim().min(1),
  code: z.string().trim().optional(),
  manufacturer: z.string().trim().optional(),
  specText: z.string().trim().optional(),
  unit: z.string().trim().optional(),
  category: z.string().trim().optional(),
});

const webSearchResultInput = z.object({
  title: z.string().trim().min(1),
  url: z.string().trim().min(1),
  domain: z.string().trim(),
  snippet: z.string(),
  query: z.string().optional(),
  rankScore: z.number().optional(),
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
  catalogStatus: catalogStatusInput,
});

const shopScrapeInput = z
  .object({
    url: z.string().trim().min(1),
    scrapeMode: z.enum(["limited", "all"]).default("limited"),
    maxPages: z.number().int().min(1).max(100).nullable().optional(),
    maxProducts: z.number().int().min(1).max(2000).nullable().optional(),
    method: z.enum(SHOP_SCRAPE_METHODS).default("auto"),
    detailEnrichment: z
      .enum(SHOP_DETAIL_ENRICHMENT_MODES)
      .default("missing_fields"),
  })
  .transform((input) => ({
    ...input,
    maxPages:
      input.scrapeMode === "all"
        ? SHOP_SCRAPE_ALL_MAX_PAGES
        : (input.maxPages ?? 25),
    maxProducts:
      input.scrapeMode === "all"
        ? SHOP_SCRAPE_ALL_MAX_PRODUCTS
        : (input.maxProducts ?? 500),
  }));

const shopScrapeJobInput = z.object({
  jobId: z.string().uuid(),
});

const scrapedShopProductInput = z
  .object({
    name: z.string().trim().min(1),
    unit: z.string().trim().nullish(),
    category: z.string().trim().nullish(),
    specText: z.string().default(""),
    manufacturer: z.string().trim().nullish(),
    originCountry: z.string().trim().nullish(),
    price: z.number().nullable().optional(),
    priceText: z.string().trim().nullish(),
    currency: z.string().trim().default("VND"),
    sourceUrl: z.string().trim().min(1),
    imageUrl: z.string().trim().nullish(),
    sku: z.string().trim().nullish(),
    model: z.string().trim().nullish(),
    availability: z.string().trim().nullish(),
    shopCategory: z.string().trim().nullish(),
    catalogPdfUrls: z.array(z.string().trim().min(1)).default([]),
  })
  .transform((product) => ({
    ...product,
    unit: product.unit ?? null,
    category: product.category ?? null,
    manufacturer: product.manufacturer ?? null,
    originCountry: product.originCountry ?? null,
    priceText: product.priceText ?? null,
    imageUrl: product.imageUrl ?? null,
    sku: product.sku ?? null,
    model: product.model ?? null,
    availability: product.availability ?? null,
    shopCategory: product.shopCategory ?? null,
    price: product.price ?? null,
  }));

const updateShopScrapeJobProductInput = z.object({
  jobId: z.string().uuid(),
  sourceUrl: z.string().trim().min(1),
  product: scrapedShopProductInput,
});

const deleteShopScrapeJobProductInput = z.object({
  jobId: z.string().uuid(),
  sourceUrl: z.string().trim().min(1),
});

const deleteShopScrapeJobProductsInput = z.object({
  jobId: z.string().uuid(),
  sourceUrls: z.array(z.string().trim().min(1)).min(1).max(25_000),
});

const addShopScrapeJobProductInput = z.object({
  jobId: z.string().uuid(),
  product: scrapedShopProductInput,
});

const listShopJobsBaseInput = z.object({
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
});

const listShopJobsInput = listShopJobsBaseInput.optional();

const startShopImportJobInput = z.object({
  scrapeJobId: z.string().uuid(),
  productSourceUrls: z.array(z.string().min(1)).max(25_000).optional(),
});

const shopImportJobInput = z.object({
  jobId: z.string().uuid(),
});

const listShopImportJobsInput = listShopJobsBaseInput
  .extend({
    scrapeJobId: z.string().uuid().optional(),
  })
  .optional();

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

async function withShopJobErrors<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ShopJobServiceError) {
      throw new TRPCError({
        code: error.code,
        message: error.message,
      });
    }
    throw error;
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
      catalogPdfUrls: parseCatalogPdfUrlsCell(row.catalog_pdf_urls),
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
    input.catalogStatus === "with"
      ? sql`exists (
          select 1
          from material_catalog_document_links links
          inner join material_catalog_documents docs
            on docs.id = links.document_id
          where links.material_id = ${materials.id}
            and docs.deleted_at is null
        )`
      : undefined,
    input.catalogStatus === "without"
      ? sql`not exists (
          select 1
          from material_catalog_document_links links
          inner join material_catalog_documents docs
            on docs.id = links.document_id
          where links.material_id = ${materials.id}
            and docs.deleted_at is null
        )`
      : undefined,
  ];
}

async function catalogDocumentCountsByMaterialIds(
  db: AppDb,
  materialIds: number[],
) {
  const counts = new Map<number, number>();
  if (materialIds.length === 0) {
    return counts;
  }

  const rows = await db
    .select({
      materialId: materialCatalogDocumentLinks.materialId,
      count: sql<number>`count(*)::int`.as("count"),
    })
    .from(materialCatalogDocumentLinks)
    .innerJoin(
      materialCatalogDocuments,
      eq(materialCatalogDocumentLinks.documentId, materialCatalogDocuments.id),
    )
    .where(
      and(
        inArray(materialCatalogDocumentLinks.materialId, materialIds),
        isNull(materialCatalogDocuments.deletedAt),
      ),
    )
    .groupBy(materialCatalogDocumentLinks.materialId);

  for (const row of rows) {
    counts.set(row.materialId, Number(row.count ?? 0));
  }
  return counts;
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

function scrapeProductExportCsvRow(product: {
  name: string;
  unit: string | null;
  category: string | null;
  specText: string;
  manufacturer: string | null;
  originCountry: string | null;
  price: number | null;
  priceText: string | null;
  currency: string;
  sourceUrl: string;
  sku: string | null;
  model: string | null;
  shopCategory: string | null;
  catalogPdfUrls: string[];
}) {
  return {
    name: product.name,
    unit: product.unit ?? "",
    category: product.category ?? "",
    spec_text: product.specText,
    manufacturer: product.manufacturer ?? "",
    origin_country: product.originCountry ?? "",
    price: product.price == null ? "" : String(product.price),
    price_text: product.priceText ?? "",
    currency: product.currency,
    source_url: product.sourceUrl,
    sku: product.sku ?? "",
    model: product.model ?? "",
    shop_category: product.shopCategory ?? "",
    catalog_pdf_urls: product.catalogPdfUrls.join(" | "),
  };
}

function materialExportCsvRow(
  material: {
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
  },
  catalogPdfUrls: string[] = [],
) {
  return {
    code: material.code ?? "",
    name: material.name,
    unit: material.unit,
    category: material.category ?? "",
    spec_text: material.specText,
    manufacturer: material.manufacturer ?? "",
    origin_country: material.originCountry ?? "",
    default_unit_price:
      material.defaultUnitPrice == null
        ? ""
        : String(material.defaultUnitPrice),
    currency: material.currency,
    source_url: material.sourceUrl ?? "",
    catalog_pdf_urls: formatCatalogPdfUrlsCell(catalogPdfUrls),
  };
}

type MaterialImportRow = {
  rowNumber: number;
  input: MaterialInput;
  catalogPdfUrls?: string[];
};

function importNameUnitKey(name: string, unit: string) {
  return `${name.trim().toLowerCase()}|${unit.trim().toLowerCase()}`;
}

async function materialNameUnitExists(db: AppDb, name: string, unit: string) {
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
  const pending: MaterialImportRow[] = [];
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
    pending.push(row);
  }

  for (let start = 0; start < pending.length; start += 500) {
    const batch = pending.slice(start, start + 500);
    const insertedRows = await db
      .insert(materials)
      .values(batch.map((row) => materialValues(row.input, now)))
      .returning({ id: materials.id });

    for (const [index, insertedRow] of insertedRows.entries()) {
      const batchRow = batch[index];
      const pdfUrls = batchRow?.catalogPdfUrls ?? [];
      if (!batchRow || pdfUrls.length === 0) {
        continue;
      }
      try {
        await attachCatalogPdfUrlsToMaterial(db, pdfUrls, insertedRow.id, {
          sourceType: "manual_url",
          linkSource: "import",
          fallbackTitle: batchRow.input.name,
        });
      } catch {
        // Catalog PDF linking must not fail the row import.
      }
    }
  }

  return { inserted: pending.length, skipped };
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

  addPriceSource: requirePermission("material:write")
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

  updatePriceSource: requirePermission("material:write")
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

  deletePriceSource: requirePermission("material:write")
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

  refreshPriceSource: requirePermission("material:write")
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

  applyPriceSourcePrice: requirePermission("material:write")
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

  startShopScrapeJob: requirePermission("scrape:run")
    .input(shopScrapeInput)
    .mutation(({ ctx, input }) =>
      withShopJobErrors(() =>
        startShopScrapeJob({ ...input, tenantId: creatorTenantId(ctx) }),
      ),
    ),

  listShopScrapeJobs: requirePermission("scrape:run")
    .input(listShopJobsInput)
    .query(({ ctx, input }) =>
      listShopScrapeJobs(input, tenantScopeValue(ctx)),
    ),

  getShopScrapeJob: requirePermission("scrape:run")
    .input(shopScrapeJobInput)
    .query(async ({ ctx, input }) => {
      const job = await getShopScrapeJob(input.jobId, tenantScopeValue(ctx));
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy job scrape shop.",
        });
      }
      return job;
    }),

  getShopScrapeJobProgress: requirePermission("scrape:run")
    .input(z.object({ jobId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const job = await getShopScrapeJobProgress(
        input.jobId,
        tenantScopeValue(ctx),
      );
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy job scrape shop.",
        });
      }
      return job;
    }),

  cancelShopScrapeJob: requirePermission("scrape:run")
    .input(shopScrapeJobInput)
    .mutation(async ({ ctx, input }) => {
      const job = await withShopJobErrors(() =>
        cancelShopScrapeJob(input.jobId, tenantScopeValue(ctx)),
      );
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy job scrape shop.",
        });
      }
      return job;
    }),

  deleteShopScrapeJob: requirePermission("scrape:run")
    .input(shopScrapeJobInput)
    .mutation(async ({ ctx, input }) => {
      const job = await withShopJobErrors(() =>
        deleteShopScrapeJob(input.jobId, tenantScopeValue(ctx)),
      );
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy job scrape shop.",
        });
      }
      return job;
    }),

  updateShopScrapeJobProduct: requirePermission("scrape:run")
    .input(updateShopScrapeJobProductInput)
    .mutation(({ ctx, input }) =>
      withShopJobErrors(() =>
        updateShopScrapeJobProduct(input, tenantScopeValue(ctx)),
      ),
    ),

  deleteShopScrapeJobProduct: requirePermission("scrape:run")
    .input(deleteShopScrapeJobProductInput)
    .mutation(({ ctx, input }) =>
      withShopJobErrors(() =>
        deleteShopScrapeJobProduct(input, tenantScopeValue(ctx)),
      ),
    ),

  deleteShopScrapeJobProducts: requirePermission("scrape:run")
    .input(deleteShopScrapeJobProductsInput)
    .mutation(({ ctx, input }) =>
      withShopJobErrors(() =>
        deleteShopScrapeJobProducts(input, tenantScopeValue(ctx)),
      ),
    ),

  addShopScrapeJobProduct: requirePermission("scrape:run")
    .input(addShopScrapeJobProductInput)
    .mutation(({ ctx, input }) =>
      withShopJobErrors(() =>
        addShopScrapeJobProduct(input, tenantScopeValue(ctx)),
      ),
    ),

  startShopImportJob: requirePermission("scrape:run")
    .input(startShopImportJobInput)
    .mutation(({ ctx, input }) =>
      withShopJobErrors(() =>
        startShopImportJob(
          {
            scrapeJobId: input.scrapeJobId,
            productSourceUrls: input.productSourceUrls,
          },
          tenantScopeValue(ctx),
        ),
      ),
    ),

  previewShopImportJob: requirePermission("scrape:run")
    .input(startShopImportJobInput)
    .query(({ ctx, input }) =>
      withShopJobErrors(() =>
        previewShopImportJob(
          {
            scrapeJobId: input.scrapeJobId,
            productSourceUrls: input.productSourceUrls,
          },
          tenantScopeValue(ctx),
        ),
      ),
    ),

  listShopImportJobs: requirePermission("scrape:run")
    .input(listShopImportJobsInput)
    .query(({ ctx, input }) =>
      listShopImportJobs(input, tenantScopeValue(ctx)),
    ),

  getShopImportJob: requirePermission("scrape:run")
    .input(shopImportJobInput)
    .query(async ({ ctx, input }) => {
      const job = await getShopImportJob(input.jobId, tenantScopeValue(ctx));
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy job nhập catalog.",
        });
      }
      return job;
    }),

  getShopImportJobProgress: requirePermission("scrape:run")
    .input(shopImportJobInput)
    .query(async ({ ctx, input }) => {
      const job = await getShopImportJobProgress(
        input.jobId,
        tenantScopeValue(ctx),
      );
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy job nhập catalog.",
        });
      }
      return job;
    }),

  exportShopScrapeJobCsv: requirePermission("scrape:run")
    .input(z.object({ jobId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const job = await getShopScrapeJob(input.jobId, tenantScopeValue(ctx));
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy job scrape shop.",
        });
      }
      const rows = job.products.slice(0, SHOP_SCRAPE_EXPORT_LIMIT);
      const csv = Papa.unparse(rows.map(scrapeProductExportCsvRow));
      return {
        csv,
        count: rows.length,
        truncated: job.products.length > rows.length,
      };
    }),

  cancelShopImportJob: requirePermission("scrape:run")
    .input(shopImportJobInput)
    .mutation(async ({ ctx, input }) => {
      const job = await withShopJobErrors(() =>
        cancelShopImportJob(input.jobId, tenantScopeValue(ctx)),
      );
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
        limit: z.number().int().min(1).max(MATERIAL_EXPORT_LIMIT).default(20),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const order =
        input.sortOrder === "asc"
          ? asc(materials[input.sortBy])
          : desc(materials[input.sortBy]);

      const rows = await ctx.db
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

      const catalogCounts = await catalogDocumentCountsByMaterialIds(
        ctx.db,
        rows.map((row) => row.id),
      );

      return rows.map((row) => ({
        ...row,
        catalogDocumentCount: catalogCounts.get(row.id) ?? 0,
      }));
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
          withCatalog: sql<number>`count(*) filter (
            where exists (
              select 1
              from material_catalog_document_links links
              inner join material_catalog_documents docs
                on docs.id = links.document_id
              where links.material_id = "materials"."id"
                and docs.deleted_at is null
            )
          )::int`.as("withCatalog"),
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
        withCatalog: Number(summary?.withCatalog ?? 0),
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
        })
        .from(materials)
        .where(and(...materialFilterConditions(input)))
        .orderBy(order, desc(materials.updatedAt), asc(materials.id))
        .limit(MATERIAL_EXPORT_LIMIT);

      const pdfUrlsByMaterialId = new Map<number, string[]>();
      const materialIds = rows.map((row) => row.id);
      if (materialIds.length > 0) {
        const linkRows = await ctx.db
          .select({
            materialId: materialCatalogDocumentLinks.materialId,
            sourceUrl: materialCatalogDocuments.sourceUrl,
          })
          .from(materialCatalogDocumentLinks)
          .innerJoin(
            materialCatalogDocuments,
            eq(
              materialCatalogDocumentLinks.documentId,
              materialCatalogDocuments.id,
            ),
          )
          .where(
            and(
              inArray(materialCatalogDocumentLinks.materialId, materialIds),
              isNull(materialCatalogDocuments.deletedAt),
              isNotNull(materialCatalogDocuments.sourceUrl),
            ),
          );
        for (const linkRow of linkRows) {
          const url = linkRow.sourceUrl?.trim();
          if (!url) {
            continue;
          }
          const list = pdfUrlsByMaterialId.get(linkRow.materialId) ?? [];
          list.push(url);
          pdfUrlsByMaterialId.set(linkRow.materialId, list);
        }
      }

      const csv = Papa.unparse(
        rows.map((row) =>
          materialExportCsvRow(row, pdfUrlsByMaterialId.get(row.id) ?? []),
        ),
      );
      return {
        csv,
        count: rows.length,
        truncated: rows.length >= MATERIAL_EXPORT_LIMIT,
      };
    }),

  createMaterial: requirePermission("material:write")
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

  upsertMaterial: requirePermission("material:write")
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

  updateMaterial: requirePermission("material:write")
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

  setMaterialFieldLocks: requirePermission("material:write")
    .input(
      z.object({
        id: z.number().int().positive(),
        fieldLocks: z.record(z.string(), z.boolean()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const material = await getActiveMaterialById(ctx.db, input.id);
      const metadata = normalizeMaterialMetadata(material.metadataJson);
      const nextLocks = { ...metadata.fieldLocks };
      for (const [key, value] of Object.entries(input.fieldLocks)) {
        if (!MATERIAL_FIELD_LOCK_KEYS.includes(key as MaterialFieldLockKey)) {
          continue;
        }
        if (value) {
          nextLocks[key as keyof typeof nextLocks] = true;
        } else {
          delete nextLocks[key as keyof typeof nextLocks];
        }
      }

      const [updated] = await ctx.db
        .update(materials)
        .set({
          metadataJson: buildMaterialMetadata({
            priceSources: metadata.priceSources,
            shopScrape: metadata.shopScrape,
            webEnrichment: metadata.webEnrichment,
            fieldLocks:
              Object.keys(nextLocks).length > 0 ? nextLocks : undefined,
          }),
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

  deleteMaterial: requirePermission("material:delete")
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

  duplicateMaterial: requirePermission("material:write")
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
          metadataJson: buildMaterialMetadata({ priceSources }),
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      return requireUpdatedMaterial(created);
    }),

  bulkUpdateMaterials: requirePermission("material:write")
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

  importMaterialsCsv: requirePermission("material:write")
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
          catalogPdfUrls: row.catalogPdfUrls,
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

  importMaterialsXlsx: requirePermission("material:write")
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
          code: row.code ?? undefined,
          name: row.productName,
          unit: row.unit,
          category: row.category ?? undefined,
          specText: row.specText,
          manufacturer: row.vendorHint ?? undefined,
          originCountry: row.originHint ?? undefined,
          defaultUnitPrice: row.unitPrice,
          currency: row.currency,
          sourceUrl: row.sourceUrl ?? undefined,
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
          catalogPdfUrls: parseCatalogPdfUrlsCell(row.catalogPdfUrls),
        });
      }

      const { inserted, skipped } = await importMaterialRows(ctx.db, validRows);
      return { inserted, skipped, errors, warnings: workbook.warnings };
    }),

  deleteMany: requirePermission("material:delete")
    .input(
      z.object({
        ids: z.array(z.number().int().positive()).min(1).max(10_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Soft-deletes up to 10k shared-catalog rows in one call; access is gated
      // by the `material:delete` permission, which is the governance boundary.
      const ids = Array.from(new Set(input.ids));
      const now = new Date().toISOString();
      const updated = await ctx.db
        .update(materials)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(inArray(materials.id, ids), isNull(materials.deletedAt)))
        .returning({ id: materials.id });
      return { count: updated.length };
    }),

  matchScrapedProduct: publicProcedure
    .input(
      z.object({
        product: scrapedShopProductInput,
        limit: z.number().int().min(1).max(20).default(8),
        minSimilarity: z.number().min(0).max(1).default(0.1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const product = {
        ...input.product,
        specText: input.product.specText ?? "",
        currency: input.product.currency ?? "VND",
        catalogPdfUrls: input.product.catalogPdfUrls ?? [],
        shopCategory: input.product.shopCategory ?? null,
      };
      const candidates = await findFuzzyCandidates(
        ctx.db,
        product,
        input.minSimilarity,
        input.limit,
      );
      return { candidates };
    }),

  // -------------------------------------------------------------------------
  // Excel Enrich & Export (AI-less, pg_trgm + weighted scoring)
  // -------------------------------------------------------------------------

  enrichPreviewXlsx: protectedProcedure
    .input(
      z.object({
        fileName: z.string().min(1).default("materials.xlsx"),
        workbookBase64: z.string().min(1),
        sheetName: z.string().optional(),
        headerRowIndex: z.number().int().min(1).optional(),
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
          const active =
            sheet.name === selectedSheet.name && input.headerRowIndex
              ? rebuildSheetWithHeaderRow(sheet, input.headerRowIndex)
              : sheet;
          return {
            name: active.name,
            detectedHeaderRowIndex: active.detectedHeaderRowIndex,
            activeHeaderRowIndex: active.activeHeaderRowIndex,
            rowCount: active.rows.length,
            headers: active.headers.slice(0, 60),
            suggestedMapping: active.suggestedMapping,
            warnings: active.warnings,
            previewRows: active.previewRows.slice(0, 12).map((values, i) => ({
              key: i,
              values,
            })),
          };
        }),
      };
    }),

  enrichMatchRows: protectedProcedure
    .input(
      z.object({
        fileName: z.string().min(1).default("materials.xlsx"),
        workbookBase64: z.string().min(1),
        sheetName: z.string().optional(),
        headerRowIndex: z.number().int().min(1).optional(),
        mapping: z.record(z.string(), z.string().nullable()),
        minSimilarity: z.number().min(0).max(1).default(0.1),
        limit: z.number().int().min(1).max(20).default(8),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const workbook = await parseWorkbookBase64(
        input.fileName,
        input.workbookBase64,
      );
      const baseSheet = selectWorkbookSheet(workbook, input.sheetName);
      if (!baseSheet) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Không tìm thấy trang tính hợp lệ.",
        });
      }
      const sheet: ParsedWorkbookSheet = input.headerRowIndex
        ? rebuildSheetWithHeaderRow(baseSheet, input.headerRowIndex)
        : baseSheet;

      let rows;
      try {
        rows = extractRowFields(sheet, input.mapping as ColumnMapping);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Không đọc được dòng dữ liệu.",
        });
      }

      const truncated = rows.length > MAX_ENRICH_ROWS;
      const limitedRows = truncated ? rows.slice(0, MAX_ENRICH_ROWS) : rows;

      const results = await matchRows(ctx.db, limitedRows, {
        minSimilarity: input.minSimilarity,
        limit: input.limit,
      });

      // Index source rows so each result carries the sheet name + field values
      // the review UI needs to render the Excel row and recompute fill plans
      // locally when the user swaps the chosen candidate.
      const rowByIndex = new Map(
        limitedRows.map((row) => [row.originalRowIndex, row]),
      );
      const resultsWithRow = results.map((result) => {
        const source = rowByIndex.get(result.originalRowIndex);
        return {
          ...result,
          name: source?.name ?? "",
          sheetFields: source?.fields ?? {},
        };
      });

      const summary = results.reduce(
        (acc, r) => {
          acc[r.status] += 1;
          acc.fieldsToFill += r.fillPlan.filter(
            (cell) => cell.action === "filled",
          ).length;
          return acc;
        },
        { auto: 0, review: 0, unmatched: 0, fieldsToFill: 0 },
      );

      return {
        sheetName: sheet.name,
        thresholds: ENRICH_THRESHOLDS,
        totalRows: rows.length,
        matchedRows: limitedRows.length,
        truncated,
        summary,
        results: resultsWithRow,
      };
    }),

  enrichSearchMaterials: protectedProcedure
    .input(
      z.object({
        query: z.string().trim().min(1),
        limit: z.number().int().min(1).max(20).default(8),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(materials)
        .where(
          and(
            isNull(materials.deletedAt),
            ilike(materials.name, `%${input.query}%`),
          ),
        )
        .orderBy(asc(materials.name))
        .limit(input.limit);

      return {
        candidates: rows.map((row) => ({
          materialId: row.id,
          name: row.name,
          code: row.code,
          unit: row.unit,
          category: row.category,
          manufacturer: row.manufacturer,
          originCountry: row.originCountry,
          defaultUnitPrice: row.defaultUnitPrice,
          currency: row.currency,
          imageUrl: row.imageUrl,
          sourceUrl: row.sourceUrl,
          specSnippet: (row.specText ?? "").slice(0, 120),
          score: 0,
          breakdown: null,
        })),
      };
    }),

  enrichWebSearchRowLinks: protectedProcedure
    .input(enrichWebRowInput)
    .mutation(async ({ input }) => {
      const queries = buildSearchQueries({
        name: input.name,
        manufacturer: input.manufacturer,
        code: input.code,
        specText: input.specText,
      }).map((query) => query.query);

      if (queries.length === 0) {
        return { results: [], warnings: [] };
      }

      const response = await searchWebForProduct(queries);
      const results = rankSearchResults(response.results, {
        manufacturer: input.manufacturer ?? null,
        name: input.name,
        sourceUrl: null,
      }).slice(0, 8);

      return { results, warnings: response.warnings };
    }),

  enrichAiSearchRow: protectedProcedure
    .input(
      enrichWebRowInput.extend({
        webResults: z.array(webSearchResultInput).min(1).max(12),
      }),
    )
    .mutation(async ({ input }) => {
      const result = await enrichRowFromWebResults(input);
      return result;
    }),

  enrichWebSearchRow: protectedProcedure
    .input(enrichWebRowInput)
    .mutation(async ({ input }) => {
      const result = await enrichRowFromWeb(input);
      return result;
    }),

  enrichExportXlsx: requirePermission("material:write")
    .input(
      z.object({
        fileName: z.string().min(1).default("materials.xlsx"),
        workbookBase64: z.string().min(1),
        sheetName: z.string().min(1),
        headerRowIndex: z.number().int().min(1),
        mapping: z.record(z.string(), z.string().nullable()),
        mode: z.enum(["preserve", "clean"]).default("preserve"),
        decisions: z
          .array(
            z.object({
              originalRowIndex: z.number().int().min(1),
              materialId: z.number().int().positive().nullable(),
              fields: z.array(z.enum(FILLABLE_FIELDS)),
              overwriteFields: z.array(z.enum(FILLABLE_FIELDS)).optional(),
              valueOverrides: z
                .record(z.enum(FILLABLE_FIELDS), z.string())
                .optional(),
            }),
          )
          .max(MAX_ENRICH_ROWS),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const materialIds = Array.from(
        new Set(
          input.decisions
            .map((d) => d.materialId)
            .filter((id): id is number => id != null),
        ),
      );

      const materialRows = materialIds.length
        ? await ctx.db
            .select()
            .from(materials)
            .where(
              and(
                inArray(materials.id, materialIds),
                isNull(materials.deletedAt),
              ),
            )
        : [];
      const materialsById = new Map(materialRows.map((row) => [row.id, row]));

      const buffer = await writeEnrichedWorkbook({
        workbookBase64: input.workbookBase64,
        sheetName: input.sheetName,
        mapping: input.mapping as ColumnMapping,
        headerRowIndex: input.headerRowIndex,
        decisions: input.decisions.map((d) => ({
          originalRowIndex: d.originalRowIndex,
          materialId: d.materialId,
          fields: d.fields,
          overwriteFields: d.overwriteFields,
          valueOverrides: d.valueOverrides,
        })),
        materialsById,
        mode: input.mode,
      });

      const baseName = input.fileName.replace(/\.xlsx$/i, "");
      return {
        fileName: `${baseName}-enriched.xlsx`,
        workbookBase64: buffer.toString("base64"),
      };
    }),
});
