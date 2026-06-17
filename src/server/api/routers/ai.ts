import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import {
  DEFAULT_OPENROUTER_MODEL,
  deleteSetting,
  getActiveProvider,
  getOpenRouterConfig,
  getGeminiConfig,
  getOpenaiCompatibleConfig,
  resolveAiProvider,
  resolveOpenRouterApiKey,
  resolveOpenRouterDefaultModel,
  setActiveProvider,
  setSetting,
  SETTING_KEYS,
  type AiFeature,
  type AiProvider,
} from "~/server/services/app-settings";
import { callAiProvider } from "~/server/services/ai-dispatch";
import {
  testOpenRouterConnection,
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
    const [openRouter, gemini, openaiCompatible] = await Promise.all([
      getOpenRouterConfig(),
      getGeminiConfig(),
      getOpenaiCompatibleConfig(),
    ]);
    return { openRouter, gemini, openaiCompatible };
  }),

  getActiveProviders: publicProcedure.query(async () => {
    const [chat, enrichment] = await Promise.all([
      getActiveProvider("chat"),
      getActiveProvider("enrichment"),
    ]);
    return { chat, enrichment };
  }),

  setActiveProvider: publicProcedure
    .input(
      z.object({
        feature: z.enum(["chat", "enrichment"]),
        provider: z.enum(["openrouter", "gemini", "openai_compatible"]),
      }),
    )
    .mutation(async ({ input }) => {
      // Make sure the chosen provider actually has a key configured.
      const [openRouter, gemini, openaiCompatible] = await Promise.all([
        getOpenRouterConfig(),
        getGeminiConfig(),
        getOpenaiCompatibleConfig(),
      ]);

      const configured: Record<AiProvider, boolean> = {
        openrouter: openRouter.configured,
        gemini: gemini.configured,
        openai_compatible: openaiCompatible.configured,
      };

      if (!configured[input.provider as AiProvider]) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Provider chưa được cấu hình API key. Nhập key trước khi chọn.",
        });
      }

      await setActiveProvider(
        input.feature as AiFeature,
        input.provider as AiProvider,
      );

      const [chat, enrichment] = await Promise.all([
        getActiveProvider("chat"),
        getActiveProvider("enrichment"),
      ]);
      return { chat, enrichment };
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

  setGeminiApiKey: publicProcedure
    .input(
      z.object({
        apiKey: z.string().trim().min(1).max(500),
      }),
    )
    .mutation(async ({ input }) => {
      const config = await getGeminiConfig();
      if (!config.canEdit) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "API key đang bị khóa bởi biến môi trường GEMINI_API_KEY.",
        });
      }

      await setSetting(SETTING_KEYS.geminiApiKey, input.apiKey.trim());
      return getGeminiConfig();
    }),

  clearGeminiApiKey: publicProcedure.mutation(async () => {
    const config = await getGeminiConfig();
    if (!config.canEdit) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "API key đang bị khóa bởi biến môi trường GEMINI_API_KEY.",
      });
    }

    await deleteSetting(SETTING_KEYS.geminiApiKey);
    return getGeminiConfig();
  }),

  setOpenaiCompatibleApiKey: publicProcedure
    .input(
      z.object({
        apiKey: z.string().trim().min(1).max(500),
      }),
    )
    .mutation(async ({ input }) => {
      const config = await getOpenaiCompatibleConfig();
      if (!config.canEdit) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "API key đang bị khóa bởi biến môi trường OPENAI_COMPATIBLE_API_KEY.",
        });
      }

      await setSetting(SETTING_KEYS.openaiCompatibleApiKey, input.apiKey.trim());
      return getOpenaiCompatibleConfig();
    }),

  clearOpenaiCompatibleApiKey: publicProcedure.mutation(async () => {
    const config = await getOpenaiCompatibleConfig();
    if (!config.canEdit) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "API key đang bị khóa bởi biến môi trường OPENAI_COMPATIBLE_API_KEY.",
      });
    }

    await deleteSetting(SETTING_KEYS.openaiCompatibleApiKey);
    return getOpenaiCompatibleConfig();
  }),

  setOpenaiCompatibleBaseUrl: publicProcedure
    .input(
      z.object({
        baseUrl: z.string().trim().url().max(500),
      }),
    )
    .mutation(async ({ input }) => {
      const config = await getOpenaiCompatibleConfig();
      if (!config.canEditBaseUrl) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Base URL đang bị khóa bởi biến môi trường OPENAI_COMPATIBLE_BASE_URL.",
        });
      }

      await setSetting(SETTING_KEYS.openaiCompatibleBaseUrl, input.baseUrl.trim());
      return getOpenaiCompatibleConfig();
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
    try {
      const provider = await resolveAiProvider("chat", input.model);
      const result = await callAiProvider(provider, input.messages);

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
