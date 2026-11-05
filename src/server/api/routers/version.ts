import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  createTRPCRouter,
  publicProcedure,
  requirePermission,
} from "~/server/api/trpc";
import { applyOnPremUpdate } from "~/server/services/onprem-update";
import { getVersionStatus } from "~/server/services/version-info";

export const versionRouter = createTRPCRouter({
  getStatus: publicProcedure.query(async () => {
    return getVersionStatus();
  }),

  applyOnPremUpdate: requirePermission("onprem:admin")
    .input(
      z.object({
        version: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await applyOnPremUpdate(input.version ?? "");
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Không thể áp dụng cập nhật.";
        throw new TRPCError({
          code: "NOT_IMPLEMENTED",
          message,
        });
      }
    }),
});
