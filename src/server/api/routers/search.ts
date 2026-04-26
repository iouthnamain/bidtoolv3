import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import {
  CATEGORY_OPTIONS,
  KEYWORD_OPTIONS,
  PROVINCE_OPTIONS,
} from "~/constants/search-options";
import { normalizeSearchSelections } from "~/lib/search-filter-utils";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { savedFilters, tenderPackages } from "~/server/db/schema";
import {
  fetchBidWinnerDetail,
  InvalidSourceUrlError,
} from "~/server/services/bidwinner-detail";
import { searchBidWinnerLive } from "~/server/services/bidwinner-search";
import {
  isSavedFilterSchemaDriftError,
  throwSavedFilterSchemaDriftError,
} from "~/server/lib/saved-filter-schema-errors";

const searchInputSchema = z
  .object({
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
  })
  .refine(
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

const savedFilterInputBaseSchema = z.object({
  name: z.string().trim().min(1),
  keyword: z.string().default(""),
  provinces: z.array(z.string()).default([]),
  categories: z.array(z.string()).default([]),
  budgetMin: z.number().optional(),
  budgetMax: z.number().optional(),
  minMatchScore: z.number().min(0).max(100).default(0),
  notificationFrequency: z.enum(["daily", "weekly"]).default("daily"),
});

const savedFilterInputSchema = savedFilterInputBaseSchema.refine(
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

const savedFilterUpdateInputSchema = savedFilterInputBaseSchema
  .extend({
    id: z.number().int().positive(),
  })
  .refine(
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

function normalizeSavedFilterInput(
  input: z.infer<typeof savedFilterInputBaseSchema>,
) {
  return normalizeSearchSelections({
    ...input,
    name: input.name.trim(),
    keyword: input.keyword.trim(),
  });
}

function mapSavedFilterRow(row: typeof savedFilters.$inferSelect) {
  return normalizeSearchSelections({
    ...row,
    name: row.name.trim(),
    keyword: row.keyword.trim(),
    provinces: row.provinces,
    categories: row.categories,
  });
}

export const searchRouter = createTRPCRouter({
  queryPackages: publicProcedure
    .input(searchInputSchema)
    .query(async ({ input }) => {
      const normalizedInput = normalizeSearchSelections({
        ...input,
        sortBy: "publishedAt" as const,
        sortOrder: "desc" as const,
      });

      try {
        return await searchBidWinnerLive(normalizedInput);
      } catch (error) {
        console.error("BidWinner live search failed", {
          input: normalizedInput,
          error,
        });

        return {
          items: [],
          total: 0,
          visibleCount: 0,
          offset: normalizedInput.offset,
          limit: normalizedInput.limit,
          source: "bidwinner_live" as const,
          fetchedAt: new Date().toISOString(),
          warning:
            "Nguồn realtime BidWinner tạm thời không ổn định. Dữ liệu hiện tại có thể trống, vui lòng thử lại sau vài phút.",
          localRefinement: {
            active: false,
            fields: [],
          },
          options: {
            provinces: [...PROVINCE_OPTIONS],
            categories: [...CATEGORY_OPTIONS],
            keywords: [...KEYWORD_OPTIONS],
          },
        };
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
        if (error instanceof InvalidSourceUrlError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error.message,
            cause: error,
          });
        }

        console.error("BidWinner detail fetch failed", {
          input,
          error,
        });

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
              closingAt: z.string().nullish(),
              sourceUrl: z.string().min(1),
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
          .where(eq(tenderPackages.externalId, item.externalId))
          .limit(1);

        if (existing) {
          skipped += 1;
          insertedIds.push(existing.id);
          continue;
        }

        const [created] = await ctx.db
          .insert(tenderPackages)
          .values({
            externalId: item.externalId,
            title: item.title,
            inviter: item.inviter,
            province: item.province,
            category: item.category,
            budget: Math.round(item.budget),
            publishedAt: item.publishedAt,
            closingAt: item.closingAt ?? null,
            sourceUrl: item.sourceUrl,
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
    .input(savedFilterInputSchema)
    .mutation(async ({ ctx, input }) => {
      const normalizedInput = normalizeSavedFilterInput(input);
      const now = new Date().toISOString();

      try {
        const [newFilter] = await ctx.db
          .insert(savedFilters)
          .values({
            name: normalizedInput.name,
            keyword: normalizedInput.keyword,
            provinces: normalizedInput.provinces,
            categories: normalizedInput.categories,
            budgetMin: normalizedInput.budgetMin,
            budgetMax: normalizedInput.budgetMax,
            minMatchScore: normalizedInput.minMatchScore,
            notificationFrequency: normalizedInput.notificationFrequency,
            updatedAt: now,
          })
          .returning();

        if (!newFilter) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Không lưu được bộ lọc.",
          });
        }

        return mapSavedFilterRow(newFilter);
      } catch (error) {
        if (isSavedFilterSchemaDriftError(error)) {
          throwSavedFilterSchemaDriftError(error);
        }

        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Không thể lưu bộ lọc. Kiểm tra kết nối database và chạy migration.",
          cause: error,
        });
      }
    }),

  getSavedFilter: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      try {
        const [savedFilter] = await ctx.db
          .select()
          .from(savedFilters)
          .where(eq(savedFilters.id, input.id))
          .limit(1);

        if (!savedFilter) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Smart View không tồn tại.",
          });
        }

        return mapSavedFilterRow(savedFilter);
      } catch (error) {
        if (isSavedFilterSchemaDriftError(error)) {
          throwSavedFilterSchemaDriftError(error);
        }

        throw error;
      }
    }),

  listSavedFilters: publicProcedure.query(async ({ ctx }) => {
    try {
      const rows = await ctx.db
        .select()
        .from(savedFilters)
        .orderBy(desc(savedFilters.updatedAt), desc(savedFilters.createdAt));

      return rows.map((row) => mapSavedFilterRow(row));
    } catch (error) {
      if (isSavedFilterSchemaDriftError(error)) {
        throwSavedFilterSchemaDriftError(error);
      }

      throw error;
    }
  }),

  updateSavedFilter: publicProcedure
    .input(savedFilterUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const normalizedInput = normalizeSavedFilterInput(input);

      try {
        const [updatedFilter] = await ctx.db
          .update(savedFilters)
          .set({
            name: normalizedInput.name,
            keyword: normalizedInput.keyword,
            provinces: normalizedInput.provinces,
            categories: normalizedInput.categories,
            budgetMin: normalizedInput.budgetMin,
            budgetMax: normalizedInput.budgetMax,
            minMatchScore: normalizedInput.minMatchScore,
            notificationFrequency: normalizedInput.notificationFrequency,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(savedFilters.id, input.id))
          .returning();

        if (!updatedFilter) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Smart View không tồn tại.",
          });
        }

        return mapSavedFilterRow(updatedFilter);
      } catch (error) {
        if (isSavedFilterSchemaDriftError(error)) {
          throwSavedFilterSchemaDriftError(error);
        }

        throw error;
      }
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
