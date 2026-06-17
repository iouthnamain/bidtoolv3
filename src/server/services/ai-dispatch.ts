import "server-only";

import { createGeminiChatCompletion, type GeminiChatMessage } from "~/server/services/gemini";
import { createOpenAICompatibleChatCompletion, type OpenAICompatibleChatMessage } from "~/server/services/openai-compatible";
import { createOpenRouterChatCompletion, type OpenRouterChatMessage } from "~/server/services/openrouter";
import type { ResolvedAiProvider } from "~/server/services/app-settings";

export type AiChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AiChatCompletionResult = {
  content: string;
  model: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

/**
 * Unified chat completion dispatcher.
 * Routes to the correct provider based on the resolved config from resolveAiProvider().
 */
export async function callAiProvider(
  resolved: ResolvedAiProvider,
  messages: AiChatMessage[],
  options?: {
    signal?: AbortSignal;
    responseFormat?: "json_object" | "text";
  },
): Promise<AiChatCompletionResult> {
  if (resolved.provider === "gemini") {
    return createGeminiChatCompletion({
      apiKey: resolved.apiKey,
      model: resolved.model,
      messages: messages as GeminiChatMessage[],
      signal: options?.signal,
      responseFormat: options?.responseFormat,
    });
  }

  if (resolved.provider === "openai_compatible") {
    return createOpenAICompatibleChatCompletion({
      apiKey: resolved.apiKey,
      baseUrl: resolved.baseUrl,
      model: resolved.model,
      messages: messages as OpenAICompatibleChatMessage[],
      signal: options?.signal,
      responseFormat: options?.responseFormat,
    });
  }

  // openrouter
  return createOpenRouterChatCompletion({
    apiKey: resolved.apiKey,
    model: resolved.model,
    messages: messages as OpenRouterChatMessage[],
    signal: options?.signal,
    responseFormat: options?.responseFormat,
  });
}
