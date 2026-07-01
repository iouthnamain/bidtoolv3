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
  publicProcedure,
  requirePermission,
} from "~/server/api/trpc";
import {
  materialCatalogDocumentLinks,
  materialCatalogDocuments,
  materials,
} from "~/server/db/schema";
import {
  parseWorkbookBase64,
  parseOptionalNumber,
  rowsFromMapping,
  type ColumnMapping,
} from "~/server/services/excel-workbook";
import type { db as appDb } from "~/server/db";
import {
  formatCatalogPdfUrlsCell,
  parseCatalogPdfUrlsCell,
} from "~/lib/materials/catalog-pdf";
import { attachCatalogPdfUrlsToMaterial } from "~/server/services/catalog-documents";
import {
  buildMaterialMetadata,
  MATERIAL_FIELD_LOCK_KEYS,
  normalizeMaterialMetadata,
  type MaterialFieldLockKey,
  type MaterialPriceSource,
} from "~/server/services/material-price-sources";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { materialEnrichmentProcedures } from "~/server/api/routers/material/enrichment";
import { priceSourceProcedures } from "~/server/api/routers/material/price-sources";
import {
  getActiveMaterialById,
  requireUpdatedMaterial,
} from "~/server/api/routers/material/records";
import { shopJobProcedures } from "~/server/api/routers/material/shop-jobs";
import { selectWorkbookSheet } from "~/server/api/routers/material/workbook";

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
  catalogPdfUrls: z.array(z.string().trim().min(1)).optional(),
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
  const { catalogPdfUrls: _catalogPdfUrls, ...materialFields } = input;
  void _catalogPdfUrls;
  return {
    ...materialFields,
    code: materialFields.code?.trim() ? materialFields.code : null,
    category: materialFields.category?.trim() ? materialFields.category : null,
    specText: materialFields.specText ?? "",
    manufacturer: materialFields.manufacturer?.trim()
      ? materialFields.manufacturer
      : null,
    originCountry: materialFields.originCountry?.trim()
      ? materialFields.originCountry
      : null,
    defaultUnitPrice: materialFields.defaultUnitPrice ?? null,
    sourceUrl: materialFields.sourceUrl?.trim()
      ? materialFields.sourceUrl
      : null,
    createdAt: now,
    updatedAt: now,
  };
}

function materialUpdateValues(input: MaterialInput, now: string) {
  const { createdAt, ...updateValues } = materialValues(input, now);
  void createdAt;
  return updateValues;
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

export const materialRouter = createTRPCRouter({
  getById: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      return getActiveMaterialById(ctx.db, input.id);
    }),

  ...shopJobProcedures,
  ...priceSourceProcedures,

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
      const catalogPdfUrls = input.patch.catalogPdfUrls ?? [];
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
        if (catalogPdfUrls.length > 0) {
          try {
            await attachCatalogPdfUrlsToMaterial(
              ctx.db,
              catalogPdfUrls,
              updated.id,
              {
                sourceType: "detected",
                linkSource: "manual",
                fallbackTitle: updated.name,
                supplier: updated.manufacturer,
              },
            );
          } catch {
            // Catalog PDF linking must not fail the material save.
          }
        }
        return updated;
      }

      await assertMaterialCodeAvailable(ctx.db, input.patch.code);
      const [created] = await ctx.db
        .insert(materials)
        .values(materialValues(input.patch, now))
        .returning();
      if (created && catalogPdfUrls.length > 0) {
        try {
          await attachCatalogPdfUrlsToMaterial(
            ctx.db,
            catalogPdfUrls,
            created.id,
            {
              sourceType: "detected",
              linkSource: "manual",
              fallbackTitle: created.name,
              supplier: created.manufacturer,
            },
          );
        } catch {
          // Catalog PDF linking must not fail the material save.
        }
      }
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

  previewMaterialsXlsx: requirePermission("material:write")
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

  ...materialEnrichmentProcedures,
});
