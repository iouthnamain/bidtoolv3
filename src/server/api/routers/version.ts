import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { isUpdateAvailable } from "~/lib/release-manifest";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { applyOnPremUpdate } from "~/server/services/onprem-update";
import { getVersionStatus } from "~/server/services/version-info";

export const versionRouter = createTRPCRouter({
  getStatus: publicProcedure.query(async () => {
    return getVersionStatus();
  }),

  applyOnPremUpdate: publicProcedure
    .input(
      z.object({
        version: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const status = await getVersionStatus();

      if (status.surface !== "onprem") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Chỉ môi trường on-prem mới có thể áp dụng cập nhật từ cài đặt.",
        });
      }

      const targetVersion = input.version ?? status.latest;
      if (!targetVersion) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Không xác định được phiên bản cập nhật.",
        });
      }

      if (!isUpdateAvailable(status.current, targetVersion)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Phiên bản hiện tại đã ở mức mới nhất hoặc mới hơn bản mục tiêu.",
        });
      }

      try {
        return await applyOnPremUpdate(targetVersion);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Không thể áp dụng cập nhật.";
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message,
        });
      }
    }),
});
