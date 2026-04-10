import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { savedFilters, tenderPackages } from "~/server/db/schema";
import { fetchBidWinnerDetail } from "~/server/services/bidwinner-detail";
import { searchBidWinnerLive } from "~/server/services/bidwinner-search";

const searchInputSchema = z.object({
  keyword: z.string().optional(),
  provinces: z.array(z.string()).default([]),
  categories: z.array(z.string()).default([]),
  budgetMin: z.number().optional(),
  budgetMax: z.number().optional(),
  minMatchScore: z.number().min(0).max(100).default(0),
  sortBy: z
    .enum(["publishedAt", "budget", "matchScore", "title", "inviter"])
    .default("publishedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  offset: z.number().min(0).default(0),
  limit: z.number().min(1).max(100).default(20),
}).refine(
  ({ budgetMin, budgetMax }) => {
    if (typeof budgetMin !== "number" || typeof budgetMax !== "number") {
      return true;
    }

    return budgetMin <= budgetMax;
  },
  {
    message: "Khoảng ngân sách không hợp lệ (budgetMin phải <= budgetMax).",
    path: ["budgetMax"],
  },
);

export const searchRouter = createTRPCRouter({
  queryPackages: publicProcedure
    .input(searchInputSchema)
    .query(async ({ input }) => {
      try {
        return await searchBidWinnerLive(input);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message:
            "Không thể lấy dữ liệu realtime từ BidWinner. Vui lòng thử lại sau.",
          cause: error,
        });
      }
    }),

  getPackageDetails: publicProcedure
    .input(
      z.object({
        externalId: z.string().min(1),
        sourceUrl: z.string().url().optional(),
      }),
    )
    .query(async ({ input }) => {
      try {
        return await fetchBidWinnerDetail(input);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message:
            "Không thể lấy chi tiết từ trang nguồn. Vui lòng thử lại sau.",
          cause: error,
        });
      }
    }),

  saveSelectedPackages: publicProcedure
    .input(
      z.object({
        items: z
          .array(
            z.object({
              externalId: z.string().min(1),
              title: z.string().min(1),
              inviter: z.string().min(1),
              province: z.string().min(1),
              category: z.string().min(1),
              budget: z.number().nonnegative(),
              publishedAt: z.string().min(1),
              matchScore: z.number().min(0).max(100),
            }),
          )
          .min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const insertedIds: number[] = [];
      let skipped = 0;

      for (const item of input.items) {
        const [existing] = await ctx.db
          .select({ id: tenderPackages.id })
          .from(tenderPackages)
          .where(
            and(
              eq(tenderPackages.title, item.title),
              eq(tenderPackages.inviter, item.inviter),
              eq(tenderPackages.publishedAt, item.publishedAt),
            ),
          )
          .limit(1);

        if (existing) {
          skipped += 1;
          insertedIds.push(existing.id);
          continue;
        }

        const [created] = await ctx.db
          .insert(tenderPackages)
          .values({
            title: item.title,
            inviter: item.inviter,
            province: item.province,
            category: item.category,
            budget: Math.round(item.budget),
            publishedAt: item.publishedAt,
            matchScore: Math.round(item.matchScore),
          })
          .returning({ id: tenderPackages.id });

        if (created) {
          insertedIds.push(created.id);
        }
      }

      return {
        savedCount: insertedIds.length - skipped,
        skippedCount: skipped,
        savedIds: insertedIds,
      };
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
            message: "Khoảng ngân sách không hợp lệ (budgetMin phải <= budgetMax).",
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
            message: "Không lưu được bộ lọc.",
          });
        }

        return newFilter;
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Không thể lưu bộ lọc. Kiểm tra kết nối database và chạy migration.",
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
