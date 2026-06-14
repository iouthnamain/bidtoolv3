import { catalogDocumentRouter } from "~/server/api/routers/catalog-document";
import { aiRouter } from "~/server/api/routers/ai";
import { excelResearchRouter } from "~/server/api/routers/excel-research";
import { materialEnrichmentRouter } from "~/server/api/routers/material-enrichment";
import { materialRouter } from "~/server/api/routers/material";
import { notificationRouter } from "~/server/api/routers/notification";
import { searchRouter } from "~/server/api/routers/search";
import { versionRouter } from "~/server/api/routers/version";
import { watchlistRouter } from "~/server/api/routers/watchlist";
import { workflowRouter } from "~/server/api/routers/workflow";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  ai: aiRouter,
  catalogDocument: catalogDocumentRouter,
  excelResearch: excelResearchRouter,
  material: materialRouter,
  materialEnrichment: materialEnrichmentRouter,
  notification: notificationRouter,
  search: searchRouter,
  version: versionRouter,
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
