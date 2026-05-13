import { randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";
import { and, desc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import Papa from "papaparse";
import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import {
  excelWorkspaceItems,
  excelWorkspaces,
  materials,
} from "~/server/db/schema";
import {
  parseWorkbookBase64,
  rowsFromMapping,
  type ColumnMapping,
} from "~/server/services/excel-workbook";
import type { db as appDb } from "~/server/db";
import {
  buildMaterialMetadata,
  fetchPriceFromUrl,
  normalizeMaterialMetadata,
  type MaterialPriceSource,
} from "~/server/services/material-price-sources";

type AppDb = typeof appDb;

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

const priceSourceInput = z.object({
  label: z.string().trim().min(1),
  url: z.string().trim().optional().default(""),
  mode: z.enum(["linked", "fixed"]).default("linked"),
  fixedPrice: z.number().nonnegative().nullable().optional(),
  currency: z.string().trim().min(1).default("VND"),
  note: z.string().trim().optional().default(""),
  isPrimary: z.boolean().default(false),
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

  return result.data.map((row) => ({
    code: emptyToUndefined(row.code),
    name: row.name ?? "",
    unit: row.unit ?? "",
    category: emptyToUndefined(row.category),
    specText: emptyToUndefined(row.spec_text),
    manufacturer: emptyToUndefined(row.manufacturer),
    originCountry: emptyToUndefined(row.origin_country),
    defaultUnitPrice:
      Number(emptyToUndefined(row.default_unit_price) ?? 0) || null,
    currency: emptyToUndefined(row.currency) ?? "VND",
    sourceUrl: emptyToUndefined(row.source_url),
    defaultDepreciation: Number(
      emptyToUndefined(row.default_depreciation) ?? 1,
    ),
    defaultReusePct: Number.parseInt(
      emptyToUndefined(row.default_reuse_pct) ?? "0",
      10,
    ),
  }));
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

export const materialRouter = createTRPCRouter({
  getById: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      return getActiveMaterialById(ctx.db, input.id);
    }),

  getUsage: publicProcedure
    .input(
      z.object({
        materialId: z.number().int().positive(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          itemId: excelWorkspaceItems.id,
          workspaceId: excelWorkspaces.id,
          workspaceName: excelWorkspaces.name,
          workspaceStatus: excelWorkspaces.status,
          productName: excelWorkspaceItems.productName,
          unit: excelWorkspaceItems.unit,
          term: excelWorkspaceItems.term,
          qtyTotal: excelWorkspaceItems.qtyTotal,
          qtyInStock: excelWorkspaceItems.qtyInStock,
          unitPrice: excelWorkspaceItems.unitPrice,
          includedInExport: excelWorkspaceItems.includedInExport,
          updatedAt: excelWorkspaceItems.updatedAt,
        })
        .from(excelWorkspaceItems)
        .innerJoin(
          excelWorkspaces,
          eq(excelWorkspaceItems.workspaceId, excelWorkspaces.id),
        )
        .innerJoin(materials, eq(excelWorkspaceItems.materialId, materials.id))
        .where(
          and(
            eq(excelWorkspaceItems.materialId, input.materialId),
            isNull(materials.deletedAt),
          ),
        )
        .orderBy(desc(excelWorkspaceItems.updatedAt))
        .limit(input.limit);
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
        .where(eq(materials.id, input.materialId))
        .returning();

      return { material: updated, source };
    }),

  updatePriceSource: publicProcedure
    .input(
      z.object({
        materialId: z.number().int().positive(),
        sourceId: z.string().min(1),
        patch: priceSourceInput.partial(),
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
        .where(eq(materials.id, input.materialId))
        .returning();

      return { material: updated, source: nextSource };
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
      const normalizedSources =
        priceSources.some((source) => source.isPrimary) ||
        priceSources.length === 0
          ? priceSources
          : priceSources.map((source, index) => ({
              ...source,
              isPrimary: index === 0,
            }));
      const primary = normalizedSources.find((source) => source.isPrimary);

      const [updated] = await ctx.db
        .update(materials)
        .set({
          metadataJson: {
            ...material.metadataJson,
            ...buildMaterialMetadata({ priceSources: normalizedSources }),
          },
          sourceUrl: primary?.url ?? material.sourceUrl,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(materials.id, input.materialId))
        .returning();

      return updated;
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
        .where(eq(materials.id, input.materialId))
        .returning();

      return { material: updated, source: nextSource };
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
          sourceUrl: source.url || material.sourceUrl,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(materials.id, input.materialId))
        .returning();

      return updated;
    }),

  searchMaterials: publicProcedure
    .input(
      z.object({
        keyword: z.string().trim().optional(),
        unit: z.string().trim().optional(),
        category: z.string().trim().optional(),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const keyword = input.keyword ? `%${input.keyword}%` : undefined;

      return ctx.db
        .select()
        .from(materials)
        .where(
          and(
            isNull(materials.deletedAt),
            keyword
              ? or(
                  ilike(materials.name, keyword),
                  ilike(materials.code, keyword),
                  ilike(materials.unit, keyword),
                  ilike(materials.category, keyword),
                )
              : undefined,
            input.unit ? eq(materials.unit, input.unit) : undefined,
            input.category ? eq(materials.category, input.category) : undefined,
          ),
        )
        .orderBy(desc(materials.updatedAt))
        .limit(input.limit)
        .offset(input.offset);
    }),

  createMaterial: publicProcedure
    .input(materialInput)
    .mutation(async ({ ctx, input }) => {
      const now = new Date().toISOString();
      const [created] = await ctx.db
        .insert(materials)
        .values({
          ...input,
          code: input.code ?? null,
          category: input.category ?? null,
          createdAt: now,
          updatedAt: now,
        })
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
        const [updated] = await ctx.db
          .update(materials)
          .set({
            ...input.patch,
            code: input.patch.code === "" ? null : input.patch.code,
            category: input.patch.category === "" ? null : input.patch.category,
            manufacturer:
              input.patch.manufacturer === "" ? null : input.patch.manufacturer,
            originCountry:
              input.patch.originCountry === ""
                ? null
                : input.patch.originCountry,
            defaultUnitPrice: input.patch.defaultUnitPrice ?? null,
            sourceUrl:
              input.patch.sourceUrl === "" ? null : input.patch.sourceUrl,
            updatedAt: now,
          })
          .where(eq(materials.id, input.id))
          .returning();
        if (!updated) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Không tìm thấy vật tư.",
          });
        }
        return updated;
      }

      const [created] = await ctx.db
        .insert(materials)
        .values({
          ...input.patch,
          code: input.patch.code ?? null,
          category: input.patch.category ?? null,
          specText: input.patch.specText ?? "",
          manufacturer: input.patch.manufacturer ?? null,
          originCountry: input.patch.originCountry ?? null,
          defaultUnitPrice: input.patch.defaultUnitPrice ?? null,
          sourceUrl: input.patch.sourceUrl ?? null,
          createdAt: now,
          updatedAt: now,
        })
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
        .where(eq(materials.id, input.id))
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
        .where(eq(materials.id, input.id))
        .returning({ id: materials.id });

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy vật tư.",
        });
      }

      return { success: true };
    }),

  importMaterialsCsv: publicProcedure
    .input(z.object({ csv: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const rows = parseMaterialsCsv(input.csv);
      const errors: string[] = [];
      let inserted = 0;
      let skipped = 0;

      for (const [index, row] of rows.entries()) {
        const parsed = materialInput.safeParse(row);
        if (!parsed.success) {
          errors.push(
            `Dòng ${index + 2}: ${parsed.error.issues[0]?.message ?? "Không hợp lệ"}`,
          );
          continue;
        }

        if (parsed.data.code) {
          const [existing] = await ctx.db
            .select({ id: materials.id })
            .from(materials)
            .where(eq(materials.code, parsed.data.code))
            .limit(1);

          if (existing) {
            skipped += 1;
            continue;
          }
        }

        await ctx.db.insert(materials).values({
          ...parsed.data,
          code: parsed.data.code ?? null,
          category: parsed.data.category ?? null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        inserted += 1;
      }

      return { inserted, skipped, errors };
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
      const sheet =
        workbook.sheets.find((item) => item.name === input.sheetName) ??
        workbook.sheets[0];
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
      let inserted = 0;
      let skipped = 0;
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
        const [existing] = await ctx.db
          .select({ id: materials.id })
          .from(materials)
          .where(
            and(
              eq(materials.name, parsed.data.name),
              eq(materials.unit, parsed.data.unit),
            ),
          )
          .limit(1);
        if (existing) {
          skipped += 1;
          continue;
        }
        await ctx.db.insert(materials).values({
          ...parsed.data,
          code: parsed.data.code ?? null,
          category: parsed.data.category ?? null,
          specText: parsed.data.specText ?? "",
          manufacturer: parsed.data.manufacturer ?? null,
          originCountry: parsed.data.originCountry ?? null,
          defaultUnitPrice: parsed.data.defaultUnitPrice ?? null,
          sourceUrl: parsed.data.sourceUrl ?? null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        inserted += 1;
      }

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
