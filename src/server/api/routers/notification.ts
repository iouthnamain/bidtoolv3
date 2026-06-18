import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { withTenant } from "~/server/api/tenant-scope";
import { notifications } from "~/server/db/schema";

export const notificationRouter = createTRPCRouter({
  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    try {
      const result = await ctx.db
        .select({ value: sql<number>`count(*)::int`.as("value") })
        .from(notifications)
        .where(
          and(
            eq(notifications.isRead, false),
            withTenant(ctx, notifications.tenantId),
          ),
        );

      return result[0]?.value ?? 0;
    } catch {
      return 0;
    }
  }),

  list: protectedProcedure
    .input(
      z
        .object({
          unreadOnly: z.boolean().default(false),
          limit: z.number().min(1).max(100).default(20),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const unreadOnly = input?.unreadOnly ?? false;
      const limit = input?.limit ?? 20;

      try {
        return await ctx.db
          .select()
          .from(notifications)
          .where(
            and(
              unreadOnly ? eq(notifications.isRead, false) : undefined,
              withTenant(ctx, notifications.tenantId),
            ),
          )
          .orderBy(desc(notifications.createdAt))
          .limit(limit);
      } catch {
        return [];
      }
    }),

  markAsRead: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.db
        .update(notifications)
        .set({ isRead: true })
        .where(
          and(
            eq(notifications.id, input.id),
            withTenant(ctx, notifications.tenantId),
          ),
        )
        .returning({ id: notifications.id });

      return { success: updated.length > 0 };
    }),

  markAllAsRead: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .update(notifications)
      .set({ isRead: true })
      .where(
        and(
          eq(notifications.isRead, false),
          withTenant(ctx, notifications.tenantId),
        ),
      );
    return { success: true };
  }),

  markSelectedAsRead: protectedProcedure
    .input(
      z.object({ ids: z.array(z.number().int().positive()).min(1).max(100) }),
    )
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.db
        .update(notifications)
        .set({ isRead: true })
        .where(
          and(
            inArray(notifications.id, input.ids),
            withTenant(ctx, notifications.tenantId),
          ),
        )
        .returning({ id: notifications.id });
      return { count: updated.length };
    }),

  deleteMany: protectedProcedure
    .input(
      z.object({ ids: z.array(z.number().int().positive()).min(1).max(100) }),
    )
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.db
        .delete(notifications)
        .where(
          and(
            inArray(notifications.id, input.ids),
            withTenant(ctx, notifications.tenantId),
          ),
        )
        .returning({ id: notifications.id });
      return { count: deleted.length };
    }),
});
