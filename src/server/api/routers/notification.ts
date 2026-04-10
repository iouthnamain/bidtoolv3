import { z } from "zod";
import { desc, eq } from "drizzle-orm";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { notifications } from "~/server/db/schema";

export const notificationRouter = createTRPCRouter({
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
});
