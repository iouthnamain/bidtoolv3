import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import {
  DEFAULT_OPENROUTER_MODEL,
  deleteSetting,
  getOpenRouterConfig,
  resolveOpenRouterApiKey,
  resolveOpenRouterDefaultModel,
  setSetting,
  SETTING_KEYS,
} from "~/server/services/app-settings";
import {
  createOpenRouterChatCompletion,
  testOpenRouterConnection,
  type OpenRouterChatMessage,
} from "~/server/services/openrouter";

const chatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().min(1).max(32_000),
});

const chatInputSchema = z.object({
  messages: z.array(chatMessageSchema).min(1).max(50),
  model: z.string().min(1).max(200).optional(),
});

function requireOpenRouterApiKey(apiKey: string | null): string {
  if (!apiKey) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Chưa cấu hình OpenRouter API key. Vào Cài đặt → OpenRouter để nhập key.",
    });
  }

  return apiKey;
}

export const aiRouter = createTRPCRouter({
  getConfig: publicProcedure.query(async () => {
    return getOpenRouterConfig();
  }),

  setOpenRouterApiKey: publicProcedure
    .input(
      z.object({
        apiKey: z.string().trim().min(1).max(500),
      }),
    )
    .mutation(async ({ input }) => {
      const config = await getOpenRouterConfig();
      if (!config.canEdit) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "API key đang bị khóa bởi biến môi trường OPENROUTER_API_KEY.",
        });
      }

      await setSetting(SETTING_KEYS.openrouterApiKey, input.apiKey.trim());
      return getOpenRouterConfig();
    }),

  clearOpenRouterApiKey: publicProcedure.mutation(async () => {
    const config = await getOpenRouterConfig();
    if (!config.canEdit) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "API key đang bị khóa bởi biến môi trường OPENROUTER_API_KEY.",
      });
    }

    await deleteSetting(SETTING_KEYS.openrouterApiKey);
    return getOpenRouterConfig();
  }),

  setDefaultModel: publicProcedure
    .input(
      z.object({
        model: z.string().trim().min(1).max(200),
      }),
    )
    .mutation(async ({ input }) => {
      const config = await getOpenRouterConfig();
      if (!config.canEdit && process.env.OPENROUTER_DEFAULT_MODEL?.trim()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Model mặc định đang bị khóa bởi biến môi trường OPENROUTER_DEFAULT_MODEL.",
        });
      }

      await setSetting(
        SETTING_KEYS.openrouterDefaultModel,
        input.model.trim(),
      );
      return getOpenRouterConfig();
    }),

  testConnection: publicProcedure
    .input(
      z
        .object({
          apiKey: z.string().trim().min(1).max(500).optional(),
          model: z.string().trim().min(1).max(200).optional(),
        })
        .optional(),
    )
    .mutation(async ({ input }) => {
      const inputApiKey = input?.apiKey?.trim();
      const apiKey =
        inputApiKey && inputApiKey.length > 0
          ? inputApiKey
          : await resolveOpenRouterApiKey();
      const inputModel = input?.model?.trim();
      const resolvedModel = await resolveOpenRouterDefaultModel();
      const model = inputModel ?? resolvedModel ?? DEFAULT_OPENROUTER_MODEL;

      try {
        return await testOpenRouterConnection({
          apiKey: requireOpenRouterApiKey(apiKey),
          model,
        });
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : "Không kết nối được tới OpenRouter.";
        throw new TRPCError({
          code: "BAD_REQUEST",
          message,
        });
      }
    }),

  chat: publicProcedure.input(chatInputSchema).mutation(async ({ input }) => {
    const apiKey = requireOpenRouterApiKey(await resolveOpenRouterApiKey());
    const inputModel = input.model?.trim();
    const model = inputModel ?? (await resolveOpenRouterDefaultModel());

    try {
      const result = await createOpenRouterChatCompletion({
        apiKey,
        model,
        messages: input.messages as OpenRouterChatMessage[],
      });

      return {
        role: "assistant" as const,
        content: result.content,
        model: result.model,
        usage: result.usage,
      };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Không gửi được tin nhắn.";
      throw new TRPCError({
        code: "BAD_REQUEST",
        message,
      });
    }
  }),
});
