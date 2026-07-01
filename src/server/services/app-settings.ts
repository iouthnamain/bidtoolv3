import { eq } from "drizzle-orm";

import { env } from "~/env";
import { db } from "~/server/db";
import { hasDatabaseUrl } from "~/server/runtime";
import { appSettings } from "~/server/db/schema";
import {
  DEFAULT_SEARCH_BOOST_DOMAINS,
  DEFAULT_SEARCH_PENALTY_DOMAINS,
  DEFAULT_SEARXNG_ENGINES,
  normalizeDomainList,
  normalizeEngineList,
} from "~/server/services/search-domain-policy";

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
  searxngApiKey: "searxng_api_key",
  searxngEngines: "searxng_engines",
  searxngLanguage: "searxng_language",
  searxngSafeSearch: "searxng_safe_search",
  searxngTimeRange: "searxng_time_range",
  searxngRequestTimeoutMs: "searxng_request_timeout_ms",
  searxngHtmlFallback: "searxng_html_fallback",
  searchBoostDomains: "search_boost_domains",
  searchPenaltyDomains: "search_penalty_domains",
  searchBlockDomains: "search_block_domains",
  searchEnableSiteVnVariants: "search_enable_site_vn_variants",
  searchEnableNegativeMarketplaceVariants:
    "search_enable_negative_marketplace_variants",
  searchMaterialJobMaxQueries: "search_material_job_max_queries",
  searchInteractiveMaxQueries: "search_interactive_max_queries",
  searchExcelResearchMaxQueries: "search_excel_research_max_queries",
  searchResultLimitPerQuery: "search_result_limit_per_query",
  searchAuditRetentionDays: "search_audit_retention_days",
  enrichmentItemConcurrency: "enrichment_item_concurrency",
  enrichmentWebConcurrency: "enrichment_web_concurrency",
  enrichmentAiConcurrency: "enrichment_ai_concurrency",
  enrichmentAiTimeoutMs: "enrichment_ai_timeout_ms",
  enrichmentSearchCacheTtlMs: "enrichment_search_cache_ttl_ms",
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

export type OperationalSettingType =
  | "number"
  | "url"
  | "boolean"
  | "path"
  | "string"
  | "list"
  | "secret";

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
  | "searxngEngines"
  | "searxngLanguage"
  | "searxngSafeSearch"
  | "searxngTimeRange"
  | "searxngRequestTimeoutMs"
  | "searxngHtmlFallback"
  | "searchBoostDomains"
  | "searchPenaltyDomains"
  | "searchBlockDomains"
  | "searchEnableSiteVnVariants"
  | "searchEnableNegativeMarketplaceVariants"
  | "searchMaterialJobMaxQueries"
  | "searchInteractiveMaxQueries"
  | "searchExcelResearchMaxQueries"
  | "searchResultLimitPerQuery"
  | "searchAuditRetentionDays"
  | "enrichmentItemConcurrency"
  | "enrichmentWebConcurrency"
  | "enrichmentAiConcurrency"
  | "enrichmentAiTimeoutMs"
  | "enrichmentSearchCacheTtlMs"
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

export type SearxngSearchConfig = {
  baseUrl: string | null;
  apiKey: string | null;
  engines: string[];
  language: string;
  safeSearch: 0 | 1 | 2;
  timeRange: "" | "day" | "week" | "month" | "year";
  requestTimeoutMs: number;
  htmlFallback: boolean;
  resultLimitPerQuery: number;
};

export type SearchDomainPolicy = {
  boostDomains: string[];
  penaltyDomains: string[];
  blockDomains: string[];
};

export type SearchQueryControls = {
  enableSiteVnVariants: boolean;
  enableNegativeMarketplaceVariants: boolean;
  materialJobMaxQueries: number;
  interactiveMaxQueries: number;
  excelResearchMaxQueries: number;
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
  searxngEngines: {
    settingKey: SETTING_KEYS.searxngEngines,
    envVar: "SEARXNG_ENGINES",
    type: "list",
    defaultValue: DEFAULT_SEARXNG_ENGINES.join(","),
  },
  searxngLanguage: {
    settingKey: SETTING_KEYS.searxngLanguage,
    envVar: "SEARXNG_LANGUAGE",
    type: "string",
    defaultValue: "vi-VN",
  },
  searxngSafeSearch: {
    settingKey: SETTING_KEYS.searxngSafeSearch,
    envVar: "SEARXNG_SAFE_SEARCH",
    type: "number",
    defaultValue: 0,
    min: 0,
    max: 2,
    integer: true,
  },
  searxngTimeRange: {
    settingKey: SETTING_KEYS.searxngTimeRange,
    envVar: "SEARXNG_TIME_RANGE",
    type: "string",
    defaultValue: "",
  },
  searxngRequestTimeoutMs: {
    settingKey: SETTING_KEYS.searxngRequestTimeoutMs,
    envVar: "SEARXNG_REQUEST_TIMEOUT_MS",
    type: "number",
    defaultValue: 12000,
    min: 3000,
    max: 60000,
    integer: true,
  },
  searxngHtmlFallback: {
    settingKey: SETTING_KEYS.searxngHtmlFallback,
    envVar: "SEARXNG_HTML_FALLBACK",
    type: "boolean",
    defaultValue: true,
  },
  searchBoostDomains: {
    settingKey: SETTING_KEYS.searchBoostDomains,
    envVar: "SEARCH_BOOST_DOMAINS",
    type: "list",
    defaultValue: DEFAULT_SEARCH_BOOST_DOMAINS.join(","),
  },
  searchPenaltyDomains: {
    settingKey: SETTING_KEYS.searchPenaltyDomains,
    envVar: "SEARCH_PENALTY_DOMAINS",
    type: "list",
    defaultValue: DEFAULT_SEARCH_PENALTY_DOMAINS.join(","),
  },
  searchBlockDomains: {
    settingKey: SETTING_KEYS.searchBlockDomains,
    envVar: "SEARCH_BLOCK_DOMAINS",
    type: "list",
    defaultValue: "",
  },
  searchEnableSiteVnVariants: {
    settingKey: SETTING_KEYS.searchEnableSiteVnVariants,
    envVar: "SEARCH_ENABLE_SITE_VN_VARIANTS",
    type: "boolean",
    defaultValue: true,
  },
  searchEnableNegativeMarketplaceVariants: {
    settingKey: SETTING_KEYS.searchEnableNegativeMarketplaceVariants,
    envVar: "SEARCH_ENABLE_NEGATIVE_MARKETPLACE_VARIANTS",
    type: "boolean",
    defaultValue: true,
  },
  searchMaterialJobMaxQueries: {
    settingKey: SETTING_KEYS.searchMaterialJobMaxQueries,
    envVar: "SEARCH_MATERIAL_JOB_MAX_QUERIES",
    type: "number",
    defaultValue: 4,
    min: 1,
    max: 10,
    integer: true,
  },
  searchInteractiveMaxQueries: {
    settingKey: SETTING_KEYS.searchInteractiveMaxQueries,
    envVar: "SEARCH_INTERACTIVE_MAX_QUERIES",
    type: "number",
    defaultValue: 6,
    min: 1,
    max: 10,
    integer: true,
  },
  searchExcelResearchMaxQueries: {
    settingKey: SETTING_KEYS.searchExcelResearchMaxQueries,
    envVar: "SEARCH_EXCEL_RESEARCH_MAX_QUERIES",
    type: "number",
    defaultValue: 6,
    min: 1,
    max: 10,
    integer: true,
  },
  searchResultLimitPerQuery: {
    settingKey: SETTING_KEYS.searchResultLimitPerQuery,
    envVar: "SEARCH_RESULT_LIMIT_PER_QUERY",
    type: "number",
    defaultValue: 8,
    min: 1,
    max: 50,
    integer: true,
  },
  searchAuditRetentionDays: {
    settingKey: SETTING_KEYS.searchAuditRetentionDays,
    envVar: "SEARCH_AUDIT_RETENTION_DAYS",
    type: "number",
    defaultValue: 30,
    min: 1,
    max: 90,
    integer: true,
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
  enrichmentWebConcurrency: {
    settingKey: SETTING_KEYS.enrichmentWebConcurrency,
    envVar: "ENRICHMENT_WEB_CONCURRENCY",
    type: "number",
    defaultValue: 12,
    min: 1,
    max: 64,
    integer: true,
  },
  enrichmentAiConcurrency: {
    settingKey: SETTING_KEYS.enrichmentAiConcurrency,
    envVar: "ENRICHMENT_AI_CONCURRENCY",
    type: "number",
    defaultValue: 6,
    min: 1,
    max: 32,
    integer: true,
  },
  enrichmentAiTimeoutMs: {
    settingKey: SETTING_KEYS.enrichmentAiTimeoutMs,
    envVar: "ENRICHMENT_AI_TIMEOUT_MS",
    type: "number",
    defaultValue: 60000,
    min: 5000,
    max: 300000,
    integer: true,
  },
  enrichmentSearchCacheTtlMs: {
    settingKey: SETTING_KEYS.enrichmentSearchCacheTtlMs,
    envVar: "ENRICHMENT_SEARCH_CACHE_TTL_MS",
    type: "number",
    defaultValue: 300000,
    min: 0,
    max: 3600000,
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

function allowsEmptyOperationalSetting(key: OperationalSettingKey) {
  return (
    key === "searxngBaseUrl" ||
    key === "searxngTimeRange" ||
    key === "searchBoostDomains" ||
    key === "searchPenaltyDomains" ||
    key === "searchBlockDomains"
  );
}

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
    if (allowsEmptyOperationalSetting(key)) {
      return "";
    }
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
    case "string": {
      if (key === "searxngLanguage") {
        if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(trimmed)) {
          throw new OperationalSettingError(
            "Ngôn ngữ phải có dạng vi, vi-VN, en hoặc en-US.",
          );
        }
      }
      if (key === "searxngTimeRange") {
        if (!["day", "week", "month", "year"].includes(trimmed)) {
          throw new OperationalSettingError(
            "Khoảng thời gian phải là day, week, month hoặc year.",
          );
        }
      }
      return trimmed;
    }
    case "list": {
      if (key === "searxngEngines") {
        const engines = normalizeEngineList(trimmed);
        if (engines.length === 0) {
          throw new OperationalSettingError(
            "Nhập ít nhất một engine hợp lệ, ví dụ google,bing,duckduckgo.",
          );
        }
        return engines.join(",");
      }

      const domains = normalizeDomainList(trimmed);
      if (domains.length === 0) {
        throw new OperationalSettingError(
          "Nhập ít nhất một domain hợp lệ hoặc đặt lại mặc định.",
        );
      }
      return domains.join(",");
    }
    case "secret":
      return trimmed;
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

  if (process.env.NODE_ENV === "test") {
    return def.defaultValue === null ? null : String(def.defaultValue);
  }

  const dbValue = await getSetting(def.settingKey);
  const trimmedDb = dbValue?.trim() ?? null;
  if (trimmedDb || (dbValue !== null && allowsEmptyOperationalSetting(key))) {
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
  if (process.env.NODE_ENV === "test") {
    const defaultValue =
      def.defaultValue === null ? null : String(def.defaultValue);
    const value = envValue ?? defaultValue;
    return {
      key,
      envVar: def.envVar,
      type: def.type,
      value,
      defaultValue,
      source: envValue ? "env" : "none",
      canEdit: !envValue,
      min: def.min ?? null,
      max: def.max ?? null,
      integer: def.integer ?? false,
    };
  }

  const rawDbValue = await getSetting(def.settingKey);
  const trimmedDbValue = rawDbValue?.trim() ?? null;
  const hasDbValue =
    Boolean(trimmedDbValue) ||
    (rawDbValue !== null && allowsEmptyOperationalSetting(key));
  const dbValue = hasDbValue ? trimmedDbValue : null;

  const value =
    envValue ??
    dbValue ??
    (def.defaultValue === null ? null : String(def.defaultValue));

  const source: SettingSource = envValue
    ? "env"
    : hasDbValue
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

export async function resolveEnrichmentWebConcurrency(): Promise<number> {
  return resolveOperationalNumber("enrichmentWebConcurrency");
}

export async function resolveEnrichmentAiConcurrency(): Promise<number> {
  return resolveOperationalNumber("enrichmentAiConcurrency");
}

export async function resolveEnrichmentAiTimeoutMs(): Promise<number> {
  return resolveOperationalNumber("enrichmentAiTimeoutMs");
}

export async function resolveEnrichmentSearchCacheTtlMs(): Promise<number> {
  return resolveOperationalNumber("enrichmentSearchCacheTtlMs");
}

export async function resolveExcelResearchJobTtlDays(): Promise<number> {
  return resolveOperationalNumber("excelResearchJobTtlDays");
}

export async function resolveSearxngBaseUrl(): Promise<string | null> {
  return resolveOperationalSetting("searxngBaseUrl");
}

export async function resolveSearxngApiKey(): Promise<string | null> {
  const envKey = env.SEARXNG_API_KEY?.trim();
  if (envKey) {
    return envKey;
  }
  if (process.env.NODE_ENV === "test") {
    return null;
  }
  const stored = await getSetting("searxng_api_key");
  const trimmed = stored?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export async function getSearxngApiKeyConfig() {
  const envKey = env.SEARXNG_API_KEY?.trim();
  if (process.env.NODE_ENV === "test") {
    return {
      configured: Boolean(envKey),
      source: envKey ? ("env" as const) : ("none" as const),
      canEdit: !envKey,
      keySuffix: envKey ? envKey.slice(-4) : null,
    };
  }
  const dbKey = await getSetting(SETTING_KEYS.searxngApiKey);
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

function parseOperationalList(value: string | null): string[] {
  if (!value?.trim()) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function clampSafeSearch(value: number): 0 | 1 | 2 {
  if (value === 1) return 1;
  if (value === 2) return 2;
  return 0;
}

function parseTimeRange(
  value: string | null,
): "" | "day" | "week" | "month" | "year" {
  if (
    value === "day" ||
    value === "week" ||
    value === "month" ||
    value === "year"
  ) {
    return value;
  }
  return "";
}

export async function resolveSearxngSearchConfig(): Promise<SearxngSearchConfig> {
  const engines = normalizeEngineList(
    (await resolveOperationalSetting("searxngEngines")) ??
      DEFAULT_SEARXNG_ENGINES.join(","),
  );

  return {
    baseUrl: await resolveSearxngBaseUrl(),
    apiKey: await resolveSearxngApiKey(),
    engines: engines.length > 0 ? engines : DEFAULT_SEARXNG_ENGINES,
    language: (await resolveOperationalSetting("searxngLanguage")) ?? "vi-VN",
    safeSearch: clampSafeSearch(
      await resolveOperationalNumber("searxngSafeSearch"),
    ),
    timeRange: parseTimeRange(
      await resolveOperationalSetting("searxngTimeRange"),
    ),
    requestTimeoutMs: await resolveOperationalNumber("searxngRequestTimeoutMs"),
    htmlFallback: await resolveOperationalBoolean("searxngHtmlFallback"),
    resultLimitPerQuery: await resolveOperationalNumber(
      "searchResultLimitPerQuery",
    ),
  };
}

export async function resolveSearchDomainPolicy(): Promise<SearchDomainPolicy> {
  return {
    boostDomains: normalizeDomainList(
      parseOperationalList(
        await resolveOperationalSetting("searchBoostDomains"),
      ),
    ),
    penaltyDomains: normalizeDomainList(
      parseOperationalList(
        await resolveOperationalSetting("searchPenaltyDomains"),
      ),
    ),
    blockDomains: normalizeDomainList(
      parseOperationalList(
        await resolveOperationalSetting("searchBlockDomains"),
      ),
    ),
  };
}

export async function resolveSearchQueryControls(): Promise<SearchQueryControls> {
  return {
    enableSiteVnVariants: await resolveOperationalBoolean(
      "searchEnableSiteVnVariants",
    ),
    enableNegativeMarketplaceVariants: await resolveOperationalBoolean(
      "searchEnableNegativeMarketplaceVariants",
    ),
    materialJobMaxQueries: await resolveOperationalNumber(
      "searchMaterialJobMaxQueries",
    ),
    interactiveMaxQueries: await resolveOperationalNumber(
      "searchInteractiveMaxQueries",
    ),
    excelResearchMaxQueries: await resolveOperationalNumber(
      "searchExcelResearchMaxQueries",
    ),
  };
}

export async function resolveSearchAuditRetentionDays(): Promise<number> {
  return resolveOperationalNumber("searchAuditRetentionDays");
}

export async function resolveExcelResearchDir(): Promise<string | null> {
  return resolveOperationalSetting("excelResearchDir");
}

export async function resolveMaterialProfileExportDir(): Promise<
  string | null
> {
  return resolveOperationalSetting("materialProfileExportDir");
}
