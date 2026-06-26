import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import {
  createTRPCRouter,
  publicProcedure,
  requirePermission,
} from "~/server/api/trpc";
import { stampTenant, withTenant } from "~/server/api/tenant-scope";
import { watchlistItems } from "~/server/db/schema";

export const watchlistRouter = createTRPCRouter({
  addItem: requirePermission("watchlist:write")
    .input(
      z.object({
        type: z.enum([
          "package",
          "plan",
          "project",
          "inviter",
          "competitor",
          "commodity",
        ]),
        refKey: z.string().min(1),
        label: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Look for an existing item within the caller's tenant scope only, so a
      // customer never returns (and thus reveals) another tenant's row.
      const [existing] = await ctx.db
        .select()
        .from(watchlistItems)
        .where(
          and(
            eq(watchlistItems.type, input.type),
            eq(watchlistItems.refKey, input.refKey),
            withTenant(ctx, watchlistItems.tenantId),
          ),
        )
        .limit(1);

      if (existing) {
        return existing;
      }

      const [newItem] = await ctx.db
        .insert(watchlistItems)
        .values(
          stampTenant(ctx, {
            type: input.type,
            refKey: input.refKey,
            label: input.label,
          }),
        )
        .returning();

      return newItem;
    }),

  removeItem: requirePermission("watchlist:write")
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      // Scope the delete by tenant so a customer cannot remove another tenant's
      // item; out-of-scope ids simply match nothing and yield NOT_FOUND.
      const deleted = await ctx.db
        .delete(watchlistItems)
        .where(
          and(
            eq(watchlistItems.id, input.id),
            withTenant(ctx, watchlistItems.tenantId),
          ),
        )
        .returning({ id: watchlistItems.id });

      if (deleted.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Mục danh sách theo dõi không tồn tại.",
        });
      }

      return { success: true };
    }),

  listItems: publicProcedure
    .input(
      z
        .object({
          type: z
            .enum([
              "package",
              "plan",
              "project",
              "inviter",
              "competitor",
              "commodity",
            ])
            .optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(watchlistItems)
        .where(
          and(
            input?.type ? eq(watchlistItems.type, input.type) : undefined,
            withTenant(ctx, watchlistItems.tenantId),
          ),
        )
        .orderBy(desc(watchlistItems.createdAt));
    }),

  removeMany: requirePermission("watchlist:write")
    .input(
      z.object({ ids: z.array(z.number().int().positive()).min(1).max(100) }),
    )
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.db
        .delete(watchlistItems)
        .where(
          and(
            inArray(watchlistItems.id, input.ids),
            withTenant(ctx, watchlistItems.tenantId),
          ),
        )
        .returning({ id: watchlistItems.id });
      return { count: deleted.length };
    }),
});
