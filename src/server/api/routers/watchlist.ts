import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { watchlistItems } from "~/server/db/schema";

export const watchlistRouter = createTRPCRouter({
  addItem: publicProcedure
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
      const [existing] = await ctx.db
        .select()
        .from(watchlistItems)
        .where(
          and(
            eq(watchlistItems.type, input.type),
            eq(watchlistItems.refKey, input.refKey),
          ),
        )
        .limit(1);

      if (existing) {
        return existing;
      }

      const [newItem] = await ctx.db
        .insert(watchlistItems)
        .values({
          type: input.type,
          refKey: input.refKey,
          label: input.label,
        })
        .returning();

      return newItem;
    }),

  removeItem: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.db
        .delete(watchlistItems)
        .where(eq(watchlistItems.id, input.id))
        .returning({ id: watchlistItems.id });

      if (deleted.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Watchlist item khong ton tai.",
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
      const baseQuery = ctx.db.select().from(watchlistItems);

      if (!input?.type) {
        return baseQuery.orderBy(desc(watchlistItems.createdAt));
      }

      return baseQuery
        .where(eq(watchlistItems.type, input.type))
        .orderBy(desc(watchlistItems.createdAt));
    }),

  removeMany: publicProcedure
    .input(
      z.object({ ids: z.array(z.number().int().positive()).min(1).max(100) }),
    )
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.db
        .delete(watchlistItems)
        .where(inArray(watchlistItems.id, input.ids))
        .returning({ id: watchlistItems.id });
      return { count: deleted.length };
    }),
});
