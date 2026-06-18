import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  createTRPCRouter,
  publicProcedure,
  requirePermission,
} from "~/server/api/trpc";
import {
  getAllOperationalSettingConfigs,
  OPERATIONAL_SETTINGS,
  OperationalSettingError,
  resetOperationalSetting,
  setOperationalSetting,
  type OperationalSettingKey,
} from "~/server/services/app-settings";

const operationalSettingKeys = Object.keys(
  OPERATIONAL_SETTINGS,
) as [OperationalSettingKey, ...OperationalSettingKey[]];

const settingKeySchema = z.enum(operationalSettingKeys);

function toTrpcError(error: unknown): TRPCError {
  if (error instanceof OperationalSettingError) {
    return new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  const message =
    error instanceof Error ? error.message : "Không lưu được cấu hình.";
  return new TRPCError({ code: "BAD_REQUEST", message });
}

export const appConfigRouter = createTRPCRouter({
  getConfig: publicProcedure.query(async () => {
    return getAllOperationalSettingConfigs();
  }),

  setSetting: requirePermission("settings:manage")
    .input(
      z.object({
        key: settingKeySchema,
        value: z.string().trim().min(1).max(2000),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        await setOperationalSetting(input.key, input.value);
      } catch (error) {
        throw toTrpcError(error);
      }
      return getAllOperationalSettingConfigs();
    }),

  resetSetting: requirePermission("settings:manage")
    .input(
      z.object({
        key: settingKeySchema,
      }),
    )
    .mutation(async ({ input }) => {
      try {
        await resetOperationalSetting(input.key);
      } catch (error) {
        throw toTrpcError(error);
      }
      return getAllOperationalSettingConfigs();
    }),
});
