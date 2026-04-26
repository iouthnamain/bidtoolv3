import { excelWorkspaceRouter } from "~/server/api/routers/excel-workspace";
import { insightRouter } from "~/server/api/routers/insight";
import { maintenanceRouter } from "~/server/api/routers/maintenance";
import { materialRouter } from "~/server/api/routers/material";
import { notificationRouter } from "~/server/api/routers/notification";
import { searchRouter } from "~/server/api/routers/search";
import { watchlistRouter } from "~/server/api/routers/watchlist";
import { workflowRouter } from "~/server/api/routers/workflow";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  excelWorkspace: excelWorkspaceRouter,
  insight: insightRouter,
  maintenance: maintenanceRouter,
  material: materialRouter,
  notification: notificationRouter,
  search: searchRouter,
  watchlist: watchlistRouter,
  workflow: workflowRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.post.all();
 *       ^? Post[]
 */
export const createCaller = createCallerFactory(appRouter);
