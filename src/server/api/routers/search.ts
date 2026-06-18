import { and, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  CATEGORY_OPTIONS,
  KEYWORD_OPTIONS,
  PROVINCE_OPTIONS,
} from "~/constants/search-options";
import {
  buildCriteriaFromLegacyPackageFields,
  DATE_ONLY_REGEX,
  emptySearchCriteria,
  normalizeSearchCriteria,
} from "~/lib/search-criteria";
import {
  SEARCH_MODE_LABELS,
  SEARCH_MODE_VALUES,
  type SearchMode,
} from "~/lib/search-modes";
import {
  createTRPCRouter,
  publicProcedure,
  requirePermission,
} from "~/server/api/trpc";
import { stampTenant, withTenant } from "~/server/api/tenant-scope";
import { type db as appDb } from "~/server/db";
import {
  investmentProjects,
  savedFilters,
  tenderPackages,
  tenderPlans,
} from "~/server/db/schema";
import {
  fetchBidWinnerDetail,
  fetchBidWinnerSourceDetail,
  InvalidSourceUrlError,
} from "~/server/services/bidwinner-detail";
import { queryBidWinnerPublicSearch } from "~/server/services/bidwinner-public-search";
import {
  isSavedFilterSchemaDriftError,
  throwSavedFilterSchemaDriftError,
} from "~/server/lib/saved-filter-schema-errors";

const modeSchema = z.enum(SEARCH_MODE_VALUES);

const criteriaInputBaseSchema = z.object({
  keyword: z.string().optional(),
  provinces: z.array(z.string()).default([]),
  packageCategories: z.array(z.string()).default([]),
  classifyIds: z.array(z.number().int().positive()).default([]),
  planFields: z.array(z.string()).default([]),
  procurementMethods: z.array(z.string()).default([]),
  projectGroups: z.array(z.string()).default([]),
  budgetMin: z.number().nonnegative().nullable().optional(),
  budgetMax: z.number().nonnegative().nullable().optional(),
  publishedFrom: z
    .string()
    .regex(DATE_ONLY_REGEX, "Ngày từ phải theo định dạng YYYY-MM-DD.")
    .optional(),
  publishedTo: z
    .string()
    .regex(DATE_ONLY_REGEX, "Ngày đến phải theo định dạng YYYY-MM-DD.")
    .optional(),
  minMatchScore: z.number().min(0).max(100).default(0),
});

const searchQueryInputSchema = criteriaInputBaseSchema
  .extend({
    mode: modeSchema.default("package_keyword"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
    offset: z.number().min(0).default(0),
    limit: z.number().min(1).max(100).default(20),
  })
  .refine(
    ({ budgetMin, budgetMax }) =>
      budgetMin === null ||
      budgetMax === null ||
      budgetMin === undefined ||
      budgetMax === undefined ||
      budgetMin <= budgetMax,
    {
      message: "Khoảng ngân sách không hợp lệ (budgetMin phải <= budgetMax).",
      path: ["budgetMax"],
    },
  )
  .refine(
    ({ publishedFrom, publishedTo }) =>
      !publishedFrom || !publishedTo || publishedFrom <= publishedTo,
    {
      message: "Khoảng ngày không hợp lệ (publishedFrom phải <= publishedTo).",
      path: ["publishedTo"],
    },
  );

const savedFilterInputSchema = criteriaInputBaseSchema
  .extend({
    name: z.string().trim().min(1),
    mode: modeSchema.default("package_keyword"),
    notificationFrequency: z.enum(["daily", "weekly"]).default("daily"),
  })
  .refine(
    ({ budgetMin, budgetMax }) =>
      budgetMin === null ||
      budgetMax === null ||
      budgetMin === undefined ||
      budgetMax === undefined ||
      budgetMin <= budgetMax,
    {
      message: "Khoảng ngân sách không hợp lệ (budgetMin phải <= budgetMax).",
      path: ["budgetMax"],
    },
  )
  .refine(
    ({ publishedFrom, publishedTo }) =>
      !publishedFrom || !publishedTo || publishedFrom <= publishedTo,
    {
      message: "Khoảng ngày không hợp lệ (publishedFrom phải <= publishedTo).",
      path: ["publishedTo"],
    },
  );

const savedFilterUpdateInputSchema = criteriaInputBaseSchema
  .extend({
    id: z.number().int().positive(),
    name: z.string().trim().min(1),
    mode: modeSchema.default("package_keyword"),
    notificationFrequency: z.enum(["daily", "weekly"]).default("daily"),
  })
  .refine(
    ({ budgetMin, budgetMax }) =>
      budgetMin === null ||
      budgetMax === null ||
      budgetMin === undefined ||
      budgetMax === undefined ||
      budgetMin <= budgetMax,
    {
      message: "Khoảng ngân sách không hợp lệ (budgetMin phải <= budgetMax).",
      path: ["budgetMax"],
    },
  )
  .refine(
    ({ publishedFrom, publishedTo }) =>
      !publishedFrom || !publishedTo || publishedFrom <= publishedTo,
    {
      message: "Khoảng ngày không hợp lệ (publishedFrom phải <= publishedTo).",
      path: ["publishedTo"],
    },
  );

const packageSaveSchema = z.object({
  entityType: z.literal("package"),
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
});

const planSaveSchema = z.object({
  entityType: z.literal("plan"),
  externalId: z.string().min(1),
  title: z.string().min(1),
  owner: z.string().min(1),
  province: z.string().min(1),
  field: z.string().min(1),
  procurementMethod: z.string().min(1),
  budget: z.number().nonnegative(),
  publishedAt: z.string().min(1),
  timeline: z.string().nullish(),
  sourceUrl: z.string().min(1),
});

const projectSaveSchema = z.object({
  entityType: z.literal("project"),
  externalId: z.string().min(1),
  title: z.string().min(1),
  owner: z.string().min(1),
  province: z.string().min(1),
  projectGroup: z.string().min(1),
  budget: z.number().nonnegative(),
  publishedAt: z.string().min(1),
  approvedAt: z.string().nullish(),
  relatedPlanCount: z.number().int().min(0).default(0),
  sourceUrl: z.string().min(1),
});

const saveSearchResultsInputSchema = z.object({
  items: z
    .array(z.union([packageSaveSchema, planSaveSchema, projectSaveSchema]))
    .min(1),
});

type CriteriaInput = z.infer<typeof criteriaInputBaseSchema>;
type SavedFilterInput = CriteriaInput & {
  name: string;
  mode: SearchMode;
  notificationFrequency: "daily" | "weekly";
};

function emptyOptions() {
  return {
    provinces: [...PROVINCE_OPTIONS],
    keywords: [...KEYWORD_OPTIONS],
    packageCategories: [...CATEGORY_OPTIONS],
    planFields: [],
    procurementMethods: [],
    projectGroups: [],
    classifies: [],
  };
}

function modePageUrl(mode: SearchMode): string {
  if (mode === "plan") {
    return "https://bidwinner.info/4.0/tim-kiem-khlcnt";
  }

  if (mode === "project") {
    return "https://bidwinner.info/4.0/du-an-dau-tu-phat-trien";
  }

  if (mode === "package_area_location") {
    return "https://bidwinner.info/4.0/goi-thau-theo-linh-vuc-dia-phuong";
  }

  return "https://bidwinner.info/4.0/tim-kiem-goi-thau";
}

function normalizeCriteriaInput(input: CriteriaInput) {
  return normalizeSearchCriteria({
    ...emptySearchCriteria,
    ...input,
    budgetMin: input.budgetMin ?? null,
    budgetMax: input.budgetMax ?? null,
  });
}

function normalizeSavedFilterInput(input: SavedFilterInput) {
  return {
    mode: input.mode,
    name: input.name.trim(),
    criteria: normalizeCriteriaInput(input),
    notificationFrequency: input.notificationFrequency,
  };
}

function normalizeSavedFilterRow(row: typeof savedFilters.$inferSelect) {
  const legacyCriteria = buildCriteriaFromLegacyPackageFields({
    keyword: row.keyword,
    provinces: row.provinces,
    categories: row.categories,
    budgetMin: row.budgetMin,
    budgetMax: row.budgetMax,
    minMatchScore: row.minMatchScore,
  });

  const rawCriteria =
    row.criteriaJson && typeof row.criteriaJson === "object"
      ? row.criteriaJson
      : {};

  const criteria = normalizeSearchCriteria({
    ...legacyCriteria,
    ...rawCriteria,
  });

  return {
    id: row.id,
    name: row.name.trim(),
    mode: row.mode ?? "package_keyword",
    criteria,
    keyword: criteria.keyword,
    provinces: criteria.provinces,
    categories: criteria.packageCategories,
    budgetMin: criteria.budgetMin,
    budgetMax: criteria.budgetMax,
    minMatchScore: criteria.minMatchScore,
    notificationFrequency: row.notificationFrequency,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function saveSearchResultItems(
  ctx: { db: typeof appDb },
  items: z.infer<typeof saveSearchResultsInputSchema>["items"],
) {
  const insertedIds: number[] = [];
  let skipped = 0;

  for (const item of items) {
    if (item.entityType === "package") {
      const [existing] = await ctx.db
        .select({ id: tenderPackages.id })
        .from(tenderPackages)
        .where(eq(tenderPackages.externalId, item.externalId))
        .limit(1);

      if (existing) {
        insertedIds.push(existing.id);
        skipped += 1;
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

      continue;
    }

    if (item.entityType === "plan") {
      const [existing] = await ctx.db
        .select({ id: tenderPlans.id })
        .from(tenderPlans)
        .where(eq(tenderPlans.externalId, item.externalId))
        .limit(1);

      if (existing) {
        insertedIds.push(existing.id);
        skipped += 1;
        continue;
      }

      const [created] = await ctx.db
        .insert(tenderPlans)
        .values({
          externalId: item.externalId,
          title: item.title,
          owner: item.owner,
          province: item.province,
          field: item.field,
          procurementMethod: item.procurementMethod,
          budget: Math.round(item.budget),
          publishedAt: item.publishedAt,
          timeline: item.timeline ?? null,
          sourceUrl: item.sourceUrl,
        })
        .returning({ id: tenderPlans.id });

      if (created) {
        insertedIds.push(created.id);
      }

      continue;
    }

    const [existing] = await ctx.db
      .select({ id: investmentProjects.id })
      .from(investmentProjects)
      .where(eq(investmentProjects.externalId, item.externalId))
      .limit(1);

    if (existing) {
      insertedIds.push(existing.id);
      skipped += 1;
      continue;
    }

    const [created] = await ctx.db
      .insert(investmentProjects)
      .values({
        externalId: item.externalId,
        title: item.title,
        owner: item.owner,
        province: item.province,
        projectGroup: item.projectGroup,
        investmentBudget: Math.round(item.budget),
        publishedAt: item.publishedAt,
        approvedAt: item.approvedAt ?? null,
        relatedPlanCount: item.relatedPlanCount,
        sourceUrl: item.sourceUrl,
      })
      .returning({ id: investmentProjects.id });

    if (created) {
      insertedIds.push(created.id);
    }
  }

  return {
    savedCount: insertedIds.length - skipped,
    skippedCount: skipped,
    savedIds: insertedIds,
  };
}

export const searchRouter = createTRPCRouter({
  querySearchResults: publicProcedure
    .input(searchQueryInputSchema)
    .query(async ({ input }) => {
      const criteria = normalizeCriteriaInput(input);

      try {
        return await queryBidWinnerPublicSearch({
          mode: input.mode,
          criteria,
          offset: input.offset,
          limit: input.limit,
          sortOrder: input.sortOrder,
        });
      } catch (error) {
        console.warn("BidWinner public search failed", {
          input: {
            mode: input.mode,
            criteria,
            offset: input.offset,
            limit: input.limit,
            sortOrder: input.sortOrder,
          },
          error,
        });

        return {
          mode: input.mode,
          items: [],
          total: 0,
          visibleCount: 0,
          scannedCount: 0,
          windowTruncated: false,
          offset: input.offset,
          limit: input.limit,
          windowBudgetRange: {
            min: 0,
            max: 0,
          },
          source: "bidwinner_public" as const,
          fetchedAt: new Date().toISOString(),
          warning:
            "Nguồn realtime BidWinner tạm thời không ổn định. Dữ liệu hiện tại có thể trống, vui lòng thử lại sau vài phút.",
          localRefinement: {
            active: false,
            fields: [],
          },
          options: emptyOptions(),
          sourceMeta: {
            modeLabel: SEARCH_MODE_LABELS[input.mode],
            pageUrl: modePageUrl(input.mode),
            exactFields: [],
            localOnlyFields: [],
            notices: [],
          },
        };
      }
    }),

  queryPackages: publicProcedure
    .input(
      z.object({
        keyword: z.string().optional(),
        provinces: z.array(z.string()).default([]),
        categories: z.array(z.string()).default([]),
        budgetMin: z.number().optional(),
        budgetMax: z.number().optional(),
        publishedFrom: z
          .string()
          .regex(
            DATE_ONLY_REGEX,
            "Ngày đăng từ phải theo định dạng YYYY-MM-DD.",
          )
          .optional(),
        publishedTo: z
          .string()
          .regex(
            DATE_ONLY_REGEX,
            "Ngày đăng đến phải theo định dạng YYYY-MM-DD.",
          )
          .optional(),
        minMatchScore: z.number().min(0).max(100).default(0),
        sortOrder: z.enum(["asc", "desc"]).default("desc"),
        offset: z.number().min(0).default(0),
        limit: z.number().min(1).max(100).default(20),
      }),
    )
    .query(async ({ input }) => {
      const result = await queryBidWinnerPublicSearch({
        mode: "package_keyword",
        criteria: normalizeSearchCriteria({
          keyword: input.keyword,
          provinces: input.provinces,
          packageCategories: input.categories,
          budgetMin: input.budgetMin ?? null,
          budgetMax: input.budgetMax ?? null,
          publishedFrom: input.publishedFrom ?? "",
          publishedTo: input.publishedTo ?? "",
          minMatchScore: input.minMatchScore,
        }),
        offset: input.offset,
        limit: input.limit,
        sortOrder: input.sortOrder,
      });

      return {
        ...result,
        items: result.items.filter((item) => item.entityType === "package"),
      };
    }),

  getSourceDetails: publicProcedure
    .input(
      z.object({
        entityType: z.enum(["package", "plan", "project"]),
        externalId: z.string().min(1),
        sourceUrl: z.string().url().optional(),
      }),
    )
    .query(async ({ input }) => {
      try {
        return await fetchBidWinnerSourceDetail(input);
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

        throw new TRPCError({
          code: "BAD_GATEWAY",
          message:
            "Không thể lấy chi tiết từ trang nguồn. Vui lòng thử lại sau.",
          cause: error,
        });
      }
    }),

  saveSelectedResults: publicProcedure
    .input(saveSearchResultsInputSchema)
    .mutation(async ({ ctx, input }) =>
      saveSearchResultItems(ctx, input.items),
    ),

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
    .mutation(async ({ ctx, input }) =>
      saveSearchResultItems(
        ctx,
        input.items.map((item) => ({
          ...item,
          entityType: "package" as const,
        })),
      ),
    ),

  saveFilter: requirePermission("workflow:write")
    .input(savedFilterInputSchema)
    .mutation(async ({ ctx, input }) => {
      const normalized = normalizeSavedFilterInput(input);
      const now = new Date().toISOString();

      try {
        const [created] = await ctx.db
          .insert(savedFilters)
          .values(
            stampTenant(ctx, {
              name: normalized.name,
              mode: normalized.mode,
              criteriaJson: normalized.criteria,
              keyword: normalized.criteria.keyword,
              provinces: normalized.criteria.provinces,
              categories: normalized.criteria.packageCategories,
              budgetMin: normalized.criteria.budgetMin,
              budgetMax: normalized.criteria.budgetMax,
              minMatchScore: normalized.criteria.minMatchScore,
              notificationFrequency: normalized.notificationFrequency,
              updatedAt: now,
            }),
          )
          .returning();

        if (!created) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Không lưu được Smart View.",
          });
        }

        return normalizeSavedFilterRow(created);
      } catch (error) {
        if (isSavedFilterSchemaDriftError(error)) {
          throwSavedFilterSchemaDriftError(error);
        }

        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Không thể lưu Smart View. Kiểm tra kết nối database và chạy migration.",
          cause: error,
        });
      }
    }),

  getSavedFilter: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      try {
        const [row] = await ctx.db
          .select()
          .from(savedFilters)
          .where(
            and(
              eq(savedFilters.id, input.id),
              withTenant(ctx, savedFilters.tenantId),
            ),
          )
          .limit(1);

        if (!row) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Smart View không tồn tại.",
          });
        }

        return normalizeSavedFilterRow(row);
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
        .where(withTenant(ctx, savedFilters.tenantId))
        .orderBy(desc(savedFilters.updatedAt), desc(savedFilters.createdAt));

      return rows.map(normalizeSavedFilterRow);
    } catch (error) {
      if (isSavedFilterSchemaDriftError(error)) {
        throwSavedFilterSchemaDriftError(error);
      }

      throw error;
    }
  }),

  updateSavedFilter: requirePermission("workflow:write")
    .input(savedFilterUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const normalized = normalizeSavedFilterInput(input);

      try {
        const [updated] = await ctx.db
          .update(savedFilters)
          .set({
            name: normalized.name,
            mode: normalized.mode,
            criteriaJson: normalized.criteria,
            keyword: normalized.criteria.keyword,
            provinces: normalized.criteria.provinces,
            categories: normalized.criteria.packageCategories,
            budgetMin: normalized.criteria.budgetMin,
            budgetMax: normalized.criteria.budgetMax,
            minMatchScore: normalized.criteria.minMatchScore,
            notificationFrequency: normalized.notificationFrequency,
            updatedAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(savedFilters.id, input.id),
              withTenant(ctx, savedFilters.tenantId),
            ),
          )
          .returning();

        if (!updated) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Smart View không tồn tại.",
          });
        }

        return normalizeSavedFilterRow(updated);
      } catch (error) {
        if (isSavedFilterSchemaDriftError(error)) {
          throwSavedFilterSchemaDriftError(error);
        }

        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Không thể cập nhật Smart View. Kiểm tra kết nối database và chạy migration.",
          cause: error,
        });
      }
    }),

  deleteSavedFilter: requirePermission("workflow:write")
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const deleted = await ctx.db
          .delete(savedFilters)
          .where(
            and(
              eq(savedFilters.id, input.id),
              withTenant(ctx, savedFilters.tenantId),
            ),
          )
          .returning({ id: savedFilters.id });

        if (deleted.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Smart View không tồn tại.",
          });
        }

        return { success: true };
      } catch (error) {
        if (isSavedFilterSchemaDriftError(error)) {
          throwSavedFilterSchemaDriftError(error);
        }

        throw error;
      }
    }),

  deleteSavedFilters: requirePermission("workflow:write")
    .input(
      z.object({ ids: z.array(z.number().int().positive()).min(1).max(50) }),
    )
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.db
        .delete(savedFilters)
        .where(
          and(
            inArray(savedFilters.id, input.ids),
            withTenant(ctx, savedFilters.tenantId),
          ),
        )
        .returning({ id: savedFilters.id });
      return { count: deleted.length };
    }),
});
