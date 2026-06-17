import { eq } from "drizzle-orm";

import { env } from "~/env";
import { db } from "~/server/db";
import { appSettings } from "~/server/db/schema";

export const SETTING_KEYS = {
  openrouterApiKey: "openrouter_api_key",
  openrouterDefaultModel: "openrouter_default_model",
  geminiApiKey: "gemini_api_key",
  geminiDefaultModel: "gemini_default_model",
  openaiCompatibleApiKey: "openai_compatible_api_key",
  openaiCompatibleBaseUrl: "openai_compatible_base_url",
  openaiCompatibleDefaultModel: "openai_compatible_default_model",
  // which provider is used for each feature
  activeProviderChat: "active_provider_chat",
  activeProviderEnrichment: "active_provider_enrichment",
} as const;

export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o-mini";
export const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";

export type AiProvider = "openrouter" | "gemini" | "openai_compatible";
export const AI_PROVIDERS: AiProvider[] = [
  "openrouter",
  "gemini",
  "openai_compatible",
];

export type AiFeature = "chat" | "enrichment";

function isAiProvider(value: unknown): value is AiProvider {
  return (
    value === "openrouter" ||
    value === "gemini" ||
    value === "openai_compatible"
  );
}

export async function getActiveProvider(
  feature: AiFeature,
): Promise<AiProvider> {
  const key =
    feature === "chat"
      ? SETTING_KEYS.activeProviderChat
      : SETTING_KEYS.activeProviderEnrichment;
  const stored = await getSetting(key);
  return isAiProvider(stored) ? stored : "openrouter";
}

export async function setActiveProvider(
  feature: AiFeature,
  provider: AiProvider,
): Promise<void> {
  const key =
    feature === "chat"
      ? SETTING_KEYS.activeProviderChat
      : SETTING_KEYS.activeProviderEnrichment;
  await setSetting(key, provider);
}

export type ResolvedAiProvider =
  | { provider: "openrouter"; apiKey: string; model: string }
  | { provider: "gemini"; apiKey: string; model: string }
  | {
      provider: "openai_compatible";
      apiKey: string;
      baseUrl: string;
      model: string;
    };

export async function resolveAiProvider(
  feature: AiFeature,
  overrideModel?: string,
): Promise<ResolvedAiProvider> {
  const active = await getActiveProvider(feature);

  if (active === "gemini") {
    const apiKey = await resolveGeminiApiKey();
    if (!apiKey) {
      throw new Error(
        "Gemini API key chưa được cấu hình. Vào Cài đặt → AI Providers.",
      );
    }
    const model =
      overrideModel ??
      (await getSetting(SETTING_KEYS.geminiDefaultModel)) ??
      DEFAULT_GEMINI_MODEL;
    return { provider: "gemini", apiKey, model };
  }

  if (active === "openai_compatible") {
    const apiKey = await resolveOpenaiCompatibleApiKey();
    if (!apiKey) {
      throw new Error(
        "OpenAI Compatible API key chưa được cấu hình. Vào Cài đặt → AI Providers.",
      );
    }
    const baseUrl = await resolveOpenaiCompatibleBaseUrl();
    if (!baseUrl) {
      throw new Error(
        "OpenAI Compatible Base URL chưa được cấu hình. Vào Cài đặt → AI Providers.",
      );
    }
    const model =
      overrideModel ??
      (await getSetting(SETTING_KEYS.openaiCompatibleDefaultModel)) ??
      "gpt-4o-mini";
    return { provider: "openai_compatible", apiKey, baseUrl, model };
  }

  // default: openrouter
  const apiKey = await resolveOpenRouterApiKey();
  if (!apiKey) {
    throw new Error(
      "OpenRouter API key chưa được cấu hình. Vào Cài đặt → AI Providers.",
    );
  }
  const model = overrideModel ?? (await resolveOpenRouterDefaultModel());
  return { provider: "openrouter", apiKey, model };
}

export async function getSetting(key: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1);

  return row?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  const updatedAt = new Date().toISOString();

  await db
    .insert(appSettings)
    .values({ key, value, updatedAt })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt },
    });
}

export async function deleteSetting(key: string) {
  await db.delete(appSettings).where(eq(appSettings.key, key));
}

export async function resolveOpenRouterApiKey(): Promise<string | null> {
  const envKey = env.OPENROUTER_API_KEY?.trim();
  if (envKey) {
    return envKey;
  }

  return await getSetting(SETTING_KEYS.openrouterApiKey);
}

export async function resolveOpenRouterDefaultModel(): Promise<string> {
  const envModel = env.OPENROUTER_DEFAULT_MODEL?.trim();
  if (envModel) {
    return envModel;
  }

  const dbModel = await getSetting(SETTING_KEYS.openrouterDefaultModel);
  const trimmed = dbModel?.trim();
  if (!trimmed) {
    return DEFAULT_OPENROUTER_MODEL;
  }
  return trimmed;
}

export async function getOpenRouterConfig() {
  const envKey = env.OPENROUTER_API_KEY?.trim();
  const dbKey = await getSetting(SETTING_KEYS.openrouterApiKey);
  const apiKey = envKey ?? dbKey ?? null;
  const defaultModel = await resolveOpenRouterDefaultModel();
  const source = envKey
    ? ("env" as const)
    : dbKey
      ? ("database" as const)
      : ("none" as const);

  return {
    configured: Boolean(apiKey),
    source,
    canEdit: !envKey,
    defaultModel,
    keySuffix: apiKey ? apiKey.slice(-4) : null,
  };
}

export async function resolveGeminiApiKey(): Promise<string | null> {
  const envKey = env.GEMINI_API_KEY?.trim();
  if (envKey) return envKey;
  return await getSetting(SETTING_KEYS.geminiApiKey);
}

export async function getGeminiConfig() {
  const envKey = env.GEMINI_API_KEY?.trim();
  const dbKey = await getSetting(SETTING_KEYS.geminiApiKey);
  const apiKey = envKey ?? dbKey ?? null;
  const source = envKey
    ? ("env" as const)
    : dbKey
      ? ("database" as const)
      : ("none" as const);

  return {
    configured: Boolean(apiKey),
    source,
    canEdit: !envKey,
    keySuffix: apiKey ? apiKey.slice(-4) : null,
  };
}

export async function resolveOpenaiCompatibleApiKey(): Promise<string | null> {
  const envKey = env.OPENAI_COMPATIBLE_API_KEY?.trim();
  if (envKey) return envKey;
  return await getSetting(SETTING_KEYS.openaiCompatibleApiKey);
}

export async function resolveOpenaiCompatibleBaseUrl(): Promise<string | null> {
  const envUrl = env.OPENAI_COMPATIBLE_BASE_URL?.trim();
  if (envUrl) return envUrl;
  return await getSetting(SETTING_KEYS.openaiCompatibleBaseUrl);
}

export async function getOpenaiCompatibleConfig() {
  const envKey = env.OPENAI_COMPATIBLE_API_KEY?.trim();
  const dbKey = await getSetting(SETTING_KEYS.openaiCompatibleApiKey);
  const apiKey = envKey ?? dbKey ?? null;
  
  const envUrl = env.OPENAI_COMPATIBLE_BASE_URL?.trim();
  const dbUrl = await getSetting(SETTING_KEYS.openaiCompatibleBaseUrl);
  const baseUrl = envUrl ?? dbUrl ?? null;
  const baseUrlSource = envUrl ? ("env" as const) : dbUrl ? ("database" as const) : ("none" as const);

  const source = envKey
    ? ("env" as const)
    : dbKey
      ? ("database" as const)
      : ("none" as const);

  return {
    configured: Boolean(apiKey),
    source,
    canEdit: !envKey,
    keySuffix: apiKey ? apiKey.slice(-4) : null,
    baseUrl,
    baseUrlSource,
    canEditBaseUrl: !envUrl,
  };
}

