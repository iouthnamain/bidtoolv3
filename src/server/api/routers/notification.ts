import { z } from "zod";
import { count, desc, eq, inArray } from "drizzle-orm";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { notifications } from "~/server/db/schema";

export const notificationRouter = createTRPCRouter({
  unreadCount: publicProcedure.query(async ({ ctx }) => {
    const result = await ctx.db
      .select({ value: count() })
      .from(notifications)
      .where(eq(notifications.isRead, false));

    return result[0]?.value ?? 0;
  }),

  list: publicProcedure
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

      return ctx.db
        .select()
        .from(notifications)
        .where(unreadOnly ? eq(notifications.isRead, false) : undefined)
        .orderBy(desc(notifications.createdAt))
        .limit(limit);
    }),

  markAsRead: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.db
        .update(notifications)
        .set({ isRead: true })
        .where(eq(notifications.id, input.id))
        .returning({ id: notifications.id });

      return { success: updated.length > 0 };
    }),

  markAllAsRead: publicProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.isRead, false));
    return { success: true };
  }),

  markSelectedAsRead: publicProcedure
    .input(
      z.object({ ids: z.array(z.number().int().positive()).min(1).max(100) }),
    )
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.db
        .update(notifications)
        .set({ isRead: true })
        .where(inArray(notifications.id, input.ids))
        .returning({ id: notifications.id });
      return { count: updated.length };
    }),

  deleteMany: publicProcedure
    .input(
      z.object({ ids: z.array(z.number().int().positive()).min(1).max(100) }),
    )
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.db
        .delete(notifications)
        .where(inArray(notifications.id, input.ids))
        .returning({ id: notifications.id });
      return { count: deleted.length };
    }),
});
