import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { getVersionStatus } from "~/server/services/version-info";

export const versionRouter = createTRPCRouter({
  getStatus: publicProcedure.query(async () => {
    return getVersionStatus();
  }),
});
