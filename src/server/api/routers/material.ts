import { TRPCError } from "@trpc/server";
import { and, desc, eq, ilike, isNull, or } from "drizzle-orm";
import Papa from "papaparse";
import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { materials } from "~/server/db/schema";
import {
  parseWorkbookBase64,
  rowsFromMapping,
  type ColumnMapping,
} from "~/server/services/excel-workbook";

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

export const materialRouter = createTRPCRouter({
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
      const [updated] = await ctx.db
        .update(materials)
        .set({
          ...input.patch,
          code: input.patch.code === "" ? null : input.patch.code,
          category: input.patch.category === "" ? null : input.patch.category,
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
      const workbook = parseWorkbookBase64(
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
});
