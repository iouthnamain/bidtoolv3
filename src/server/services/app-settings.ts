import { eq } from "drizzle-orm";

import { env } from "~/env";
import { db } from "~/server/db";
import { hasDatabaseUrl } from "~/server/runtime";
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
  // operational settings (env overrides DB; DB overrides schema default)
  bidwinnerBaseUrl: "bidwinner_base_url",
  bidwinnerTimeoutMs: "bidwinner_timeout_ms",
  enableDemoSeed: "enable_demo_seed",
  scrapeMaxConcurrentJobs: "scrape_max_concurrent_jobs",
  scrapeMaxConcurrentPages: "scrape_max_concurrent_pages",
  importMaxConcurrentJobs: "import_max_concurrent_jobs",
  enrichmentMaxConcurrentJobs: "enrichment_max_concurrent_jobs",
  scrapeJobTtlDays: "scrape_job_ttl_days",
  aiMatchAutoThreshold: "ai_match_auto_threshold",
  aiMatchCandidateThreshold: "ai_match_candidate_threshold",
  excelResearchMaxConcurrentJobs: "excel_research_max_concurrent_jobs",
  excelResearchBatchSize: "excel_research_batch_size",
  excelResearchRowConcurrency: "excel_research_row_concurrency",
  excelResearchJobTtlDays: "excel_research_job_ttl_days",
  searxngBaseUrl: "searxng_base_url",
  enrichmentItemConcurrency: "enrichment_item_concurrency",
  excelResearchDir: "bidtool_excel_research_dir",
  materialProfileExportDir: "bidtool_material_profile_export_dir",
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
  // Avoid touching the DB proxy when no database is configured (e.g. unit
  // tests or serverless cold paths without DATABASE_URL). Env/default values
  // still resolve correctly through the callers.
  if (!hasDatabaseUrl()) {
    return null;
  }

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
  const baseUrlSource = envUrl
    ? ("env" as const)
    : dbUrl
      ? ("database" as const)
      : ("none" as const);

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

/* -------------------------------------------------------------------------- */
/* Operational settings                                                       */
/*                                                                            */
/* These mirror the env-override pattern used for AI keys above: an explicit  */
/* environment variable always wins and locks the UI field (canEdit=false);   */
/* otherwise the value stored in `appSettings` (DB) is used; otherwise the     */
/* schema default from `src/env.js` applies.                                   */
/*                                                                            */
/* IMPORTANT: we read `process.env.X` directly (not `env.X`) so that the       */
/* schema defaults in env.js do NOT count as an "env override". Only a value   */
/* the operator actually set in the environment locks the field.              */
/* -------------------------------------------------------------------------- */

export type SettingSource = "env" | "database" | "none";

export type OperationalSettingType = "number" | "url" | "boolean" | "path";

export type OperationalSettingKey =
  | "bidwinnerBaseUrl"
  | "bidwinnerTimeoutMs"
  | "enableDemoSeed"
  | "scrapeMaxConcurrentJobs"
  | "scrapeMaxConcurrentPages"
  | "importMaxConcurrentJobs"
  | "enrichmentMaxConcurrentJobs"
  | "scrapeJobTtlDays"
  | "aiMatchAutoThreshold"
  | "aiMatchCandidateThreshold"
  | "excelResearchMaxConcurrentJobs"
  | "excelResearchBatchSize"
  | "excelResearchRowConcurrency"
  | "excelResearchJobTtlDays"
  | "searxngBaseUrl"
  | "enrichmentItemConcurrency"
  | "excelResearchDir"
  | "materialProfileExportDir";

type OperationalSettingDefinition = {
  /** Key into SETTING_KEYS / appSettings table. */
  settingKey: string;
  /** The backing environment variable name (used for locking + helper text). */
  envVar: string;
  type: OperationalSettingType;
  /** Default value when neither env nor DB provide one. `null` = unset/optional. */
  defaultValue: string | number | boolean | null;
  /** Numeric bounds (inclusive) for type === "number". */
  min?: number;
  max?: number;
  /** Whether the number must be an integer. */
  integer?: boolean;
};

export const OPERATIONAL_SETTINGS: Record<
  OperationalSettingKey,
  OperationalSettingDefinition
> = {
  bidwinnerBaseUrl: {
    settingKey: SETTING_KEYS.bidwinnerBaseUrl,
    envVar: "BIDWINNER_BASE_URL",
    type: "url",
    defaultValue: "https://bidwinner.info",
  },
  bidwinnerTimeoutMs: {
    settingKey: SETTING_KEYS.bidwinnerTimeoutMs,
    envVar: "BIDWINNER_TIMEOUT_MS",
    type: "number",
    defaultValue: 15000,
    min: 1000,
    max: 120000,
    integer: true,
  },
  enableDemoSeed: {
    settingKey: SETTING_KEYS.enableDemoSeed,
    envVar: "ENABLE_DEMO_SEED",
    type: "boolean",
    defaultValue: false,
  },
  scrapeMaxConcurrentJobs: {
    settingKey: SETTING_KEYS.scrapeMaxConcurrentJobs,
    envVar: "SCRAPE_MAX_CONCURRENT_JOBS",
    type: "number",
    defaultValue: 2,
    min: 1,
    max: 16,
    integer: true,
  },
  scrapeMaxConcurrentPages: {
    settingKey: SETTING_KEYS.scrapeMaxConcurrentPages,
    envVar: "SCRAPE_MAX_CONCURRENT_PAGES",
    type: "number",
    defaultValue: 2,
    min: 1,
    max: 16,
    integer: true,
  },
  importMaxConcurrentJobs: {
    settingKey: SETTING_KEYS.importMaxConcurrentJobs,
    envVar: "IMPORT_MAX_CONCURRENT_JOBS",
    type: "number",
    defaultValue: 2,
    min: 1,
    max: 16,
    integer: true,
  },
  enrichmentMaxConcurrentJobs: {
    settingKey: SETTING_KEYS.enrichmentMaxConcurrentJobs,
    envVar: "ENRICHMENT_MAX_CONCURRENT_JOBS",
    type: "number",
    defaultValue: 1,
    min: 1,
    max: 16,
    integer: true,
  },
  scrapeJobTtlDays: {
    settingKey: SETTING_KEYS.scrapeJobTtlDays,
    envVar: "SCRAPE_JOB_TTL_DAYS",
    type: "number",
    defaultValue: 7,
    min: 1,
    max: 365,
    integer: true,
  },
  aiMatchAutoThreshold: {
    settingKey: SETTING_KEYS.aiMatchAutoThreshold,
    envVar: "AI_MATCH_AUTO_THRESHOLD",
    type: "number",
    defaultValue: 0.85,
    min: 0,
    max: 1,
  },
  aiMatchCandidateThreshold: {
    settingKey: SETTING_KEYS.aiMatchCandidateThreshold,
    envVar: "AI_MATCH_CANDIDATE_THRESHOLD",
    type: "number",
    defaultValue: 0.4,
    min: 0,
    max: 1,
  },
  excelResearchMaxConcurrentJobs: {
    settingKey: SETTING_KEYS.excelResearchMaxConcurrentJobs,
    envVar: "EXCEL_RESEARCH_MAX_CONCURRENT_JOBS",
    type: "number",
    defaultValue: 1,
    min: 1,
    max: 16,
    integer: true,
  },
  excelResearchBatchSize: {
    settingKey: SETTING_KEYS.excelResearchBatchSize,
    envVar: "EXCEL_RESEARCH_BATCH_SIZE",
    type: "number",
    defaultValue: 10,
    min: 1,
    max: 200,
    integer: true,
  },
  excelResearchRowConcurrency: {
    settingKey: SETTING_KEYS.excelResearchRowConcurrency,
    envVar: "EXCEL_RESEARCH_ROW_CONCURRENCY",
    type: "number",
    defaultValue: 3,
    min: 1,
    max: 8,
    integer: true,
  },
  excelResearchJobTtlDays: {
    settingKey: SETTING_KEYS.excelResearchJobTtlDays,
    envVar: "EXCEL_RESEARCH_JOB_TTL_DAYS",
    type: "number",
    defaultValue: 7,
    min: 1,
    max: 365,
    integer: true,
  },
  searxngBaseUrl: {
    settingKey: SETTING_KEYS.searxngBaseUrl,
    envVar: "SEARXNG_BASE_URL",
    type: "url",
    defaultValue: null,
  },
  enrichmentItemConcurrency: {
    settingKey: SETTING_KEYS.enrichmentItemConcurrency,
    envVar: "ENRICHMENT_ITEM_CONCURRENCY",
    type: "number",
    defaultValue: 2,
    min: 1,
    max: 8,
    integer: true,
  },
  excelResearchDir: {
    settingKey: SETTING_KEYS.excelResearchDir,
    envVar: "BIDTOOL_EXCEL_RESEARCH_DIR",
    type: "path",
    defaultValue: null,
  },
  materialProfileExportDir: {
    settingKey: SETTING_KEYS.materialProfileExportDir,
    envVar: "BIDTOOL_MATERIAL_PROFILE_EXPORT_DIR",
    type: "path",
    defaultValue: null,
  },
};

function rawEnvValue(envVar: string): string | undefined {
  const value = process.env[envVar];
  const trimmed = typeof value === "string" ? value.trim() : undefined;
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export class OperationalSettingError extends Error {}

/**
 * Validate + coerce a raw string against a setting definition, mirroring the
 * zod rules in `src/env.js`. Throws `OperationalSettingError` (Vietnamese) on
 * invalid input.
 */
export function validateOperationalSettingValue(
  key: OperationalSettingKey,
  rawValue: string,
): string {
  const def = OPERATIONAL_SETTINGS[key];
  const trimmed = rawValue.trim();

  if (!trimmed) {
    throw new OperationalSettingError("Giá trị không được để trống.");
  }

  switch (def.type) {
    case "number": {
      const num = Number(trimmed);
      if (!Number.isFinite(num)) {
        throw new OperationalSettingError("Giá trị phải là số hợp lệ.");
      }
      if (def.integer && !Number.isInteger(num)) {
        throw new OperationalSettingError("Giá trị phải là số nguyên.");
      }
      if (def.min !== undefined && num < def.min) {
        throw new OperationalSettingError(
          `Giá trị phải lớn hơn hoặc bằng ${def.min}.`,
        );
      }
      if (def.max !== undefined && num > def.max) {
        throw new OperationalSettingError(
          `Giá trị phải nhỏ hơn hoặc bằng ${def.max}.`,
        );
      }
      return String(num);
    }
    case "boolean": {
      if (trimmed !== "true" && trimmed !== "false") {
        throw new OperationalSettingError(
          'Giá trị phải là "true" hoặc "false".',
        );
      }
      return trimmed;
    }
    case "url": {
      try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new OperationalSettingError(
            "Dùng URL bắt đầu bằng http:// hoặc https://.",
          );
        }
      } catch (error) {
        if (error instanceof OperationalSettingError) {
          throw error;
        }
        throw new OperationalSettingError(
          "Nhập URL hợp lệ, ví dụ https://bidwinner.info.",
        );
      }
      return trimmed;
    }
    case "path":
      return trimmed;
  }
}

/**
 * Resolve the effective value for an operational setting following the
 * precedence env > database > schema default. Returns the raw string (or null
 * when there is no value and no default).
 */
export async function resolveOperationalSetting(
  key: OperationalSettingKey,
): Promise<string | null> {
  const def = OPERATIONAL_SETTINGS[key];

  const envValue = rawEnvValue(def.envVar);
  if (envValue !== undefined) {
    return envValue;
  }

  const dbValue = await getSetting(def.settingKey);
  const trimmedDb = dbValue?.trim();
  if (trimmedDb) {
    return trimmedDb;
  }

  return def.defaultValue === null ? null : String(def.defaultValue);
}

export async function resolveOperationalNumber(
  key: OperationalSettingKey,
): Promise<number> {
  const value = await resolveOperationalSetting(key);
  const def = OPERATIONAL_SETTINGS[key];
  const parsed = value === null ? NaN : Number(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  // Fall back to the schema default if a stored value is somehow invalid.
  return typeof def.defaultValue === "number" ? def.defaultValue : NaN;
}

export async function resolveOperationalBoolean(
  key: OperationalSettingKey,
): Promise<boolean> {
  const value = await resolveOperationalSetting(key);
  return value === "true";
}

export type OperationalSettingConfig = {
  key: OperationalSettingKey;
  envVar: string;
  type: OperationalSettingType;
  value: string | null;
  defaultValue: string | null;
  source: SettingSource;
  canEdit: boolean;
  min: number | null;
  max: number | null;
  integer: boolean;
};

export async function getOperationalSettingConfig(
  key: OperationalSettingKey,
): Promise<OperationalSettingConfig> {
  const def = OPERATIONAL_SETTINGS[key];
  const envValue = rawEnvValue(def.envVar);
  const trimmedDbValue = (await getSetting(def.settingKey))?.trim();
  const dbValue =
    trimmedDbValue && trimmedDbValue.length > 0 ? trimmedDbValue : null;

  const value =
    envValue ??
    dbValue ??
    (def.defaultValue === null ? null : String(def.defaultValue));

  const source: SettingSource = envValue
    ? "env"
    : dbValue
      ? "database"
      : "none";

  return {
    key,
    envVar: def.envVar,
    type: def.type,
    value,
    defaultValue: def.defaultValue === null ? null : String(def.defaultValue),
    source,
    canEdit: !envValue,
    min: def.min ?? null,
    max: def.max ?? null,
    integer: def.integer ?? false,
  };
}

export async function getAllOperationalSettingConfigs(): Promise<
  Record<OperationalSettingKey, OperationalSettingConfig>
> {
  const keys = Object.keys(OPERATIONAL_SETTINGS) as OperationalSettingKey[];
  const entries = await Promise.all(
    keys.map(
      async (key) => [key, await getOperationalSettingConfig(key)] as const,
    ),
  );
  return Object.fromEntries(entries) as Record<
    OperationalSettingKey,
    OperationalSettingConfig
  >;
}

export async function setOperationalSetting(
  key: OperationalSettingKey,
  rawValue: string,
): Promise<OperationalSettingConfig> {
  const def = OPERATIONAL_SETTINGS[key];
  if (rawEnvValue(def.envVar) !== undefined) {
    throw new OperationalSettingError(
      `Giá trị này đang bị khóa bởi biến môi trường ${def.envVar}.`,
    );
  }

  const normalized = validateOperationalSettingValue(key, rawValue);
  await setSetting(def.settingKey, normalized);
  return getOperationalSettingConfig(key);
}

export async function resetOperationalSetting(
  key: OperationalSettingKey,
): Promise<OperationalSettingConfig> {
  const def = OPERATIONAL_SETTINGS[key];
  if (rawEnvValue(def.envVar) !== undefined) {
    throw new OperationalSettingError(
      `Giá trị này đang bị khóa bởi biến môi trường ${def.envVar}.`,
    );
  }

  await deleteSetting(def.settingKey);
  return getOperationalSettingConfig(key);
}

/* -------------------------------------------------------------------------- */
/* Named convenience resolvers for runtime consumers                          */
/* -------------------------------------------------------------------------- */

export async function resolveBidwinnerBaseUrl(): Promise<string> {
  return (
    (await resolveOperationalSetting("bidwinnerBaseUrl")) ??
    "https://bidwinner.info"
  );
}

export async function resolveBidwinnerTimeoutMs(): Promise<number> {
  return resolveOperationalNumber("bidwinnerTimeoutMs");
}

export async function resolveScrapeMaxConcurrentJobs(): Promise<number> {
  return resolveOperationalNumber("scrapeMaxConcurrentJobs");
}

export async function resolveScrapeMaxConcurrentPages(): Promise<number> {
  return resolveOperationalNumber("scrapeMaxConcurrentPages");
}

export async function resolveImportMaxConcurrentJobs(): Promise<number> {
  return resolveOperationalNumber("importMaxConcurrentJobs");
}

export async function resolveEnrichmentMaxConcurrentJobs(): Promise<number> {
  return resolveOperationalNumber("enrichmentMaxConcurrentJobs");
}

export async function resolveScrapeJobTtlDays(): Promise<number> {
  return resolveOperationalNumber("scrapeJobTtlDays");
}

export async function resolveAiMatchAutoThreshold(): Promise<number> {
  return resolveOperationalNumber("aiMatchAutoThreshold");
}

export async function resolveAiMatchCandidateThreshold(): Promise<number> {
  return resolveOperationalNumber("aiMatchCandidateThreshold");
}

export async function resolveExcelResearchMaxConcurrentJobs(): Promise<number> {
  return resolveOperationalNumber("excelResearchMaxConcurrentJobs");
}

export async function resolveExcelResearchBatchSize(): Promise<number> {
  return resolveOperationalNumber("excelResearchBatchSize");
}

export async function resolveExcelResearchRowConcurrency(): Promise<number> {
  return resolveOperationalNumber("excelResearchRowConcurrency");
}

export async function resolveEnrichmentItemConcurrency(): Promise<number> {
  return resolveOperationalNumber("enrichmentItemConcurrency");
}

export async function resolveExcelResearchJobTtlDays(): Promise<number> {
  return resolveOperationalNumber("excelResearchJobTtlDays");
}

export async function resolveSearxngBaseUrl(): Promise<string | null> {
  return resolveOperationalSetting("searxngBaseUrl");
}

export async function resolveExcelResearchDir(): Promise<string | null> {
  return resolveOperationalSetting("excelResearchDir");
}

export async function resolveMaterialProfileExportDir(): Promise<
  string | null
> {
  return resolveOperationalSetting("materialProfileExportDir");
}
