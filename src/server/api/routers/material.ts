import { randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";
import { and, desc, eq, ilike, inArray, isNull, not, or } from "drizzle-orm";
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
import {
  buildMaterialMetadata,
  fetchPriceFromUrl,
  normalizeMaterialMetadata,
  type MaterialPriceSource,
} from "~/server/services/material-price-sources";

type AppDb = typeof appDb;
type MaterialInput = z.infer<typeof materialInput>;

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

async function findMaterialByNameUnit(db: AppDb, name: string, unit: string) {
  const [existing] = await db
    .select({ id: materials.id })
    .from(materials)
    .where(
      and(
        isNull(materials.deletedAt),
        eq(materials.name, name),
        eq(materials.unit, unit),
      ),
    )
    .limit(1);

  return existing;
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

  importMaterialsCsv: publicProcedure
    .input(z.object({ csv: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { rows, errors } = parseMaterialsCsv(input.csv);
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
            .where(
              and(
                eq(materials.code, parsed.data.code),
                isNull(materials.deletedAt),
              ),
            )
            .limit(1);

          if (existing) {
            skipped += 1;
            continue;
          }
        }

        const existingNameUnit = await findMaterialByNameUnit(
          ctx.db,
          parsed.data.name,
          parsed.data.unit,
        );
        if (existingNameUnit) {
          skipped += 1;
          continue;
        }

        const now = new Date().toISOString();
        await ctx.db.insert(materials).values(materialValues(parsed.data, now));
        inserted += 1;
      }

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
        const existing = await findMaterialByNameUnit(
          ctx.db,
          parsed.data.name,
          parsed.data.unit,
        );
        if (existing) {
          skipped += 1;
          continue;
        }
        const now = new Date().toISOString();
        await ctx.db.insert(materials).values(materialValues(parsed.data, now));
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
