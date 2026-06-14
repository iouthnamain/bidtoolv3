import { eq } from "drizzle-orm";

import { env } from "~/env";
import { db } from "~/server/db";
import { appSettings } from "~/server/db/schema";

export const SETTING_KEYS = {
  openrouterApiKey: "openrouter_api_key",
  openrouterDefaultModel: "openrouter_default_model",
} as const;

export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o-mini";

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
  return dbModel?.trim() || DEFAULT_OPENROUTER_MODEL;
}

export async function getOpenRouterConfig() {
  const envKey = env.OPENROUTER_API_KEY?.trim();
  const dbKey = await getSetting(SETTING_KEYS.openrouterApiKey);
  const apiKey = envKey || dbKey || null;
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
