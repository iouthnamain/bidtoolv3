import { z } from "zod";
import { and, desc, eq, gte, ilike, inArray, lte, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { savedFilters, tenderPackages } from "~/server/db/schema";

const searchInputSchema = z.object({
  keyword: z.string().optional(),
  provinces: z.array(z.string()).default([]),
  categories: z.array(z.string()).default([]),
  budgetMin: z.number().optional(),
  budgetMax: z.number().optional(),
  minMatchScore: z.number().min(0).max(100).default(0),
  limit: z.number().min(1).max(100).default(20),
});

export const searchRouter = createTRPCRouter({
  queryPackages: publicProcedure
    .input(searchInputSchema)
    .query(async ({ ctx, input }) => {
      const keyword = input.keyword?.trim().toLowerCase();
      const conditions = [];

      if (keyword) {
        conditions.push(
          or(
            ilike(tenderPackages.title, `%${keyword}%`),
            ilike(tenderPackages.inviter, `%${keyword}%`),
          ),
        );
      }
      if (input.provinces.length > 0) {
        conditions.push(inArray(tenderPackages.province, input.provinces));
      }
      if (input.categories.length > 0) {
        conditions.push(inArray(tenderPackages.category, input.categories));
      }
      if (typeof input.budgetMin === "number") {
        conditions.push(gte(tenderPackages.budget, input.budgetMin));
      }
      if (typeof input.budgetMax === "number") {
        conditions.push(lte(tenderPackages.budget, input.budgetMax));
      }
      conditions.push(gte(tenderPackages.matchScore, input.minMatchScore));

      const condition = conditions.length > 0 ? and(...conditions) : undefined;

      return ctx.db
        .select()
        .from(tenderPackages)
        .where(condition)
        .orderBy(desc(tenderPackages.publishedAt))
        .limit(input.limit);
    }),

  saveFilter: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        keyword: z.string().default(""),
        provinces: z.array(z.string()).default([]),
        categories: z.array(z.string()).default([]),
        budgetMin: z.number().optional(),
        budgetMax: z.number().optional(),
        notificationFrequency: z.enum(["daily", "weekly"]).default("daily"),
      }).refine(
        ({ budgetMin, budgetMax }) => {
          if (typeof budgetMin !== "number" || typeof budgetMax !== "number") {
            return true;
          }

          return budgetMin <= budgetMax;
        },
        {
          message: "Khoang ngan sach khong hop le (budgetMin phai <= budgetMax).",
          path: ["budgetMax"],
        },
      ),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const [newFilter] = await ctx.db
          .insert(savedFilters)
          .values({
            name: input.name,
            keyword: input.keyword,
            provinces: input.provinces,
            categories: input.categories,
            budgetMin: input.budgetMin,
            budgetMax: input.budgetMax,
            notificationFrequency: input.notificationFrequency,
          })
          .returning();

        if (!newFilter) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Khong luu duoc bo loc.",
          });
        }

        return newFilter;
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Khong the luu bo loc. Kiem tra ket noi database va chay migration.",
          cause: error,
        });
      }
    }),

  listSavedFilters: publicProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(savedFilters)
      .orderBy(desc(savedFilters.createdAt));
  }),

  deleteSavedFilter: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.db
        .delete(savedFilters)
        .where(eq(savedFilters.id, input.id))
        .returning({ id: savedFilters.id });

      return { success: deleted.length > 0 };
    }),
});
