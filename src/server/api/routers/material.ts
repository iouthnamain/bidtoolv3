import { TRPCError } from "@trpc/server";
import { and, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { materials } from "~/server/db/schema";

const materialInput = z.object({
  code: z.string().trim().optional(),
  name: z.string().trim().min(1),
  unit: z.string().trim().min(1),
  category: z.string().trim().optional(),
  defaultDepreciation: z.number().nonnegative().default(1),
  defaultReusePct: z.number().int().min(0).max(100).default(0),
});

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function parseMaterialsCsv(csv: string) {
  const rows = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (rows.length === 0) {
    return [];
  }

  const header = parseCsvLine(rows[0] ?? "").map((cell) => cell.toLowerCase());
  return rows.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const value = (name: string) => cells[header.indexOf(name)] ?? "";

    return {
      code: value("code") || undefined,
      name: value("name"),
      unit: value("unit"),
      category: value("category") || undefined,
      defaultDepreciation: Number(value("default_depreciation") || 1),
      defaultReusePct: Number.parseInt(value("default_reuse_pct") || "0", 10),
    };
  });
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
});
