import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, requirePermission } from "~/server/api/trpc";
import {
  deleteSetting,
  getAllOperationalSettingConfigs,
  getSearxngApiKeyConfig,
  OPERATIONAL_SETTINGS,
  OperationalSettingError,
  resetOperationalSetting,
  resolveSearchDomainPolicy,
  resolveSearxngSearchConfig,
  SETTING_KEYS,
  setOperationalSetting,
  setSetting,
  type OperationalSettingKey,
} from "~/server/services/app-settings";
import {
  cleanupSearchAuditLogs,
  getSearchAuditSummary,
  listSearchAuditLogs,
} from "~/server/services/search-audit";
import {
  rankSearchResults,
  searchQueryWithFallback,
} from "~/server/services/material-web-search";

const searchSettingKeys = [
  "searxngBaseUrl",
  "searxngEngines",
  "searxngLanguage",
  "searxngSafeSearch",
  "searxngTimeRange",
  "searxngRequestTimeoutMs",
  "searxngHtmlFallback",
  "searchBoostDomains",
  "searchPenaltyDomains",
  "searchBlockDomains",
  "searchEnableSiteVnVariants",
  "searchEnableNegativeMarketplaceVariants",
  "searchMaterialJobMaxQueries",
  "searchInteractiveMaxQueries",
  "searchExcelResearchMaxQueries",
  "searchResultLimitPerQuery",
  "searchAuditRetentionDays",
  "enrichmentWebConcurrency",
  "enrichmentSearchCacheTtlMs",
] as const satisfies readonly OperationalSettingKey[];

const searchSettingKeySchema = z.enum(searchSettingKeys);
const auditStatusSchema = z.enum(["success", "no_results", "error", "skipped"]);
const auditFeatureSchema = z.enum([
  "material_enrichment",
  "excel_research",
  "interactive",
  "profile_search",
  "test",
]);

function toTrpcError(error: unknown): TRPCError {
  if (error instanceof OperationalSettingError) {
    return new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  const message =
    error instanceof Error
      ? error.message
      : "Không lưu được cấu hình tìm kiếm.";
  return new TRPCError({ code: "BAD_REQUEST", message });
}

async function getSearchConfig() {
  const allSettings = await getAllOperationalSettingConfigs();
  const settings = Object.fromEntries(
    searchSettingKeys.map((key) => [key, allSettings[key]]),
  ) as Pick<typeof allSettings, (typeof searchSettingKeys)[number]>;

  return {
    settings,
    searxngApiKey: await getSearxngApiKeyConfig(),
  };
}

export const searchConfigRouter = createTRPCRouter({
  getConfig: requirePermission("settings:manage").query(() =>
    getSearchConfig(),
  ),

  setSetting: requirePermission("settings:manage")
    .input(
      z.object({
        key: searchSettingKeySchema,
        value: z.string().trim().max(12000),
      }),
    )
    .mutation(async ({ input }) => {
      if (!OPERATIONAL_SETTINGS[input.key]) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cấu hình tìm kiếm không hợp lệ.",
        });
      }
      try {
        await setOperationalSetting(input.key, input.value);
      } catch (error) {
        throw toTrpcError(error);
      }
      return getSearchConfig();
    }),

  resetSetting: requirePermission("settings:manage")
    .input(z.object({ key: searchSettingKeySchema }))
    .mutation(async ({ input }) => {
      try {
        await resetOperationalSetting(input.key);
      } catch (error) {
        throw toTrpcError(error);
      }
      return getSearchConfig();
    }),

  setSearxngApiKey: requirePermission("settings:manage")
    .input(z.object({ apiKey: z.string().trim().min(1).max(1000) }))
    .mutation(async ({ input }) => {
      const config = await getSearxngApiKeyConfig();
      if (!config.canEdit) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Token SearXNG đang bị khóa bởi SEARXNG_API_KEY.",
        });
      }
      await setSetting(SETTING_KEYS.searxngApiKey, input.apiKey.trim());
      return getSearchConfig();
    }),

  clearSearxngApiKey: requirePermission("settings:manage").mutation(
    async () => {
      const config = await getSearxngApiKeyConfig();
      if (!config.canEdit) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Token SearXNG đang bị khóa bởi SEARXNG_API_KEY.",
        });
      }
      await deleteSetting(SETTING_KEYS.searxngApiKey);
      return getSearchConfig();
    },
  ),

  testSearxngSearch: requirePermission("settings:manage")
    .input(
      z.object({
        query: z.string().trim().min(2).max(300),
        limit: z.number().int().min(1).max(10).default(5),
      }),
    )
    .mutation(async ({ input }) => {
      const startedAt = Date.now();
      const [config, policy] = await Promise.all([
        resolveSearxngSearchConfig(),
        resolveSearchDomainPolicy(),
      ]);
      const response = await searchQueryWithFallback(input.query, undefined, {
        feature: "test",
      });
      const ranked = rankSearchResults(
        response.results,
        { name: input.query, sourceUrl: null },
        response.domainPolicy ?? policy,
      ).slice(0, input.limit);
      const status =
        ranked.length > 0
          ? "success"
          : config.baseUrl
            ? "no_results"
            : "skipped";

      return {
        ok: ranked.length > 0,
        status,
        durationMs: Date.now() - startedAt,
        warnings: response.warnings,
        results: ranked.map((result) => ({
          title: result.title,
          url: result.url,
          domain: result.domain,
          snippet: result.snippet,
          rankScore: result.rankScore,
          rankReasons: result.rankReasons ?? [],
        })),
        effectiveConfig: {
          baseUrlConfigured: Boolean(config.baseUrl),
          engines: config.engines,
          language: config.language,
          safeSearch: config.safeSearch,
          timeRange: config.timeRange,
          boostDomainCount: policy.boostDomains.length,
          penaltyDomainCount: policy.penaltyDomains.length,
          blockDomainCount: policy.blockDomains.length,
        },
      };
    }),

  listSearchAuditLogs: requirePermission("settings:manage")
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(25),
        status: auditStatusSchema.optional(),
        feature: auditFeatureSchema.optional(),
      }),
    )
    .query(({ input }) => listSearchAuditLogs(input)),

  getSearchAuditSummary: requirePermission("settings:manage").query(() =>
    getSearchAuditSummary(),
  ),

  cleanupSearchAuditLogs: requirePermission("settings:manage").mutation(() =>
    cleanupSearchAuditLogs(),
  ),
});
