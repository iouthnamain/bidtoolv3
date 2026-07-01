import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    NODE_ENV: z.enum(["development", "test", "production"]),
    DATABASE_URL: z.string().optional(),
    APP_BASE_URL: z.string().url().optional(),
    BIDWINNER_BASE_URL: z.string().url().default("https://bidwinner.info"),
    BIDWINNER_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
    ENABLE_DEMO_SEED: z.enum(["true", "false"]).optional().default("false"),
    BIDTOOL_APP_VERSION: z.string().optional(),
    BIDTOOL_BUILD_METADATA: z.string().optional(),
    BIDTOOL_DEPLOYMENT_SURFACE: z
      .enum(["web", "onprem", "desktop-bundled"])
      .optional(),
    BIDTOOL_MANIFEST_URL: z.string().url().optional(),
    BIDTOOL_MANIFEST_PATH: z.string().optional(),
    BIDTOOL_PINS_URL: z.string().url().optional(),
    BIDTOOL_PINS_BRANCH: z.string().optional(),
    BIDTOOL_GITHUB_REPO: z.string().optional(),
    BIDTOOL_PACKAGE_VERSION: z.string().default("0.1.0"),
    SCRAPE_MAX_CONCURRENT_JOBS: z.coerce.number().int().positive().default(2),
    SCRAPE_MAX_CONCURRENT_PAGES: z.coerce.number().int().positive().default(2),
    IMPORT_MAX_CONCURRENT_JOBS: z.coerce.number().int().positive().default(2),
    ENRICHMENT_MAX_CONCURRENT_JOBS: z.coerce
      .number()
      .int()
      .positive()
      .default(1),
    SCRAPE_JOB_TTL_DAYS: z.coerce.number().int().positive().default(7),
    AI_MATCH_AUTO_THRESHOLD: z.coerce.number().min(0).max(1).default(0.85),
    AI_MATCH_CANDIDATE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.4),
    OPENROUTER_API_KEY: z.string().optional(),
    OPENROUTER_DEFAULT_MODEL: z.string().optional(),
    GEMINI_API_KEY: z.string().optional(),
    OPENAI_COMPATIBLE_API_KEY: z.string().optional(),
    OPENAI_COMPATIBLE_BASE_URL: z.string().url().optional(),
    EXCEL_RESEARCH_MAX_CONCURRENT_JOBS: z.coerce
      .number()
      .int()
      .positive()
      .default(1),
    EXCEL_RESEARCH_BATCH_SIZE: z.coerce.number().int().positive().default(10),
    EXCEL_RESEARCH_JOB_TTL_DAYS: z.coerce
      .number()
      .int()
      .positive()
      .default(7),
    SEARXNG_BASE_URL: z.string().url().optional(),
    SEARXNG_API_KEY: z.string().optional(),
    SEARXNG_ENGINES: z.string().optional(),
    SEARXNG_LANGUAGE: z.string().optional(),
    SEARXNG_SAFE_SEARCH: z.coerce.number().int().min(0).max(2).optional(),
    SEARXNG_TIME_RANGE: z.enum(["day", "week", "month", "year"]).optional(),
    SEARXNG_REQUEST_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(3000)
      .max(60000)
      .optional(),
    SEARXNG_HTML_FALLBACK: z.enum(["true", "false"]).optional(),
    SEARCH_BOOST_DOMAINS: z.string().optional(),
    SEARCH_PENALTY_DOMAINS: z.string().optional(),
    SEARCH_BLOCK_DOMAINS: z.string().optional(),
    SEARCH_ENABLE_SITE_VN_VARIANTS: z.enum(["true", "false"]).optional(),
    SEARCH_ENABLE_NEGATIVE_MARKETPLACE_VARIANTS: z
      .enum(["true", "false"])
      .optional(),
    SEARCH_MATERIAL_JOB_MAX_QUERIES: z.coerce
      .number()
      .int()
      .min(1)
      .max(10)
      .optional(),
    SEARCH_INTERACTIVE_MAX_QUERIES: z.coerce
      .number()
      .int()
      .min(1)
      .max(10)
      .optional(),
    SEARCH_EXCEL_RESEARCH_MAX_QUERIES: z.coerce
      .number()
      .int()
      .min(1)
      .max(10)
      .optional(),
    SEARCH_RESULT_LIMIT_PER_QUERY: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .optional(),
    SEARCH_AUDIT_RETENTION_DAYS: z.coerce
      .number()
      .int()
      .min(1)
      .max(90)
      .optional(),
    BIDTOOL_EXCEL_RESEARCH_DIR: z.string().optional(),
    BETTER_AUTH_SECRET: z.string().optional(),
    BETTER_AUTH_URL: z.string().url().optional(),
    AUTH_ENABLED: z.enum(["true", "false"]).default("false"),
    AUTH_BOOTSTRAP_TOKEN: z.string().optional(),
    AUTH_DESKTOP_AUTO_ADMIN: z.enum(["true", "false"]).default("true"),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    // NEXT_PUBLIC_CLIENTVAR: z.string(),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    APP_BASE_URL: process.env.APP_BASE_URL,
    BIDWINNER_BASE_URL: process.env.BIDWINNER_BASE_URL,
    BIDWINNER_TIMEOUT_MS: process.env.BIDWINNER_TIMEOUT_MS,
    ENABLE_DEMO_SEED: process.env.ENABLE_DEMO_SEED,
    BIDTOOL_APP_VERSION: process.env.BIDTOOL_APP_VERSION,
    BIDTOOL_BUILD_METADATA: process.env.BIDTOOL_BUILD_METADATA,
    BIDTOOL_DEPLOYMENT_SURFACE: process.env.BIDTOOL_DEPLOYMENT_SURFACE,
    BIDTOOL_MANIFEST_URL: process.env.BIDTOOL_MANIFEST_URL,
    BIDTOOL_MANIFEST_PATH: process.env.BIDTOOL_MANIFEST_PATH,
    BIDTOOL_PINS_URL: process.env.BIDTOOL_PINS_URL,
    BIDTOOL_PINS_BRANCH: process.env.BIDTOOL_PINS_BRANCH,
    BIDTOOL_GITHUB_REPO: process.env.BIDTOOL_GITHUB_REPO,
    BIDTOOL_PACKAGE_VERSION: process.env.BIDTOOL_PACKAGE_VERSION,
    SCRAPE_MAX_CONCURRENT_JOBS: process.env.SCRAPE_MAX_CONCURRENT_JOBS,
    SCRAPE_MAX_CONCURRENT_PAGES: process.env.SCRAPE_MAX_CONCURRENT_PAGES,
    IMPORT_MAX_CONCURRENT_JOBS: process.env.IMPORT_MAX_CONCURRENT_JOBS,
    ENRICHMENT_MAX_CONCURRENT_JOBS: process.env.ENRICHMENT_MAX_CONCURRENT_JOBS,
    SCRAPE_JOB_TTL_DAYS: process.env.SCRAPE_JOB_TTL_DAYS,
    AI_MATCH_AUTO_THRESHOLD: process.env.AI_MATCH_AUTO_THRESHOLD,
    AI_MATCH_CANDIDATE_THRESHOLD: process.env.AI_MATCH_CANDIDATE_THRESHOLD,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_DEFAULT_MODEL: process.env.OPENROUTER_DEFAULT_MODEL,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    OPENAI_COMPATIBLE_API_KEY: process.env.OPENAI_COMPATIBLE_API_KEY,
    OPENAI_COMPATIBLE_BASE_URL: process.env.OPENAI_COMPATIBLE_BASE_URL,
    EXCEL_RESEARCH_MAX_CONCURRENT_JOBS:
      process.env.EXCEL_RESEARCH_MAX_CONCURRENT_JOBS,
    EXCEL_RESEARCH_BATCH_SIZE: process.env.EXCEL_RESEARCH_BATCH_SIZE,
    EXCEL_RESEARCH_JOB_TTL_DAYS: process.env.EXCEL_RESEARCH_JOB_TTL_DAYS,
    SEARXNG_BASE_URL: process.env.SEARXNG_BASE_URL,
    SEARXNG_API_KEY: process.env.SEARXNG_API_KEY,
    SEARXNG_ENGINES: process.env.SEARXNG_ENGINES,
    SEARXNG_LANGUAGE: process.env.SEARXNG_LANGUAGE,
    SEARXNG_SAFE_SEARCH: process.env.SEARXNG_SAFE_SEARCH,
    SEARXNG_TIME_RANGE: process.env.SEARXNG_TIME_RANGE,
    SEARXNG_REQUEST_TIMEOUT_MS: process.env.SEARXNG_REQUEST_TIMEOUT_MS,
    SEARXNG_HTML_FALLBACK: process.env.SEARXNG_HTML_FALLBACK,
    SEARCH_BOOST_DOMAINS: process.env.SEARCH_BOOST_DOMAINS,
    SEARCH_PENALTY_DOMAINS: process.env.SEARCH_PENALTY_DOMAINS,
    SEARCH_BLOCK_DOMAINS: process.env.SEARCH_BLOCK_DOMAINS,
    SEARCH_ENABLE_SITE_VN_VARIANTS: process.env.SEARCH_ENABLE_SITE_VN_VARIANTS,
    SEARCH_ENABLE_NEGATIVE_MARKETPLACE_VARIANTS:
      process.env.SEARCH_ENABLE_NEGATIVE_MARKETPLACE_VARIANTS,
    SEARCH_MATERIAL_JOB_MAX_QUERIES:
      process.env.SEARCH_MATERIAL_JOB_MAX_QUERIES,
    SEARCH_INTERACTIVE_MAX_QUERIES: process.env.SEARCH_INTERACTIVE_MAX_QUERIES,
    SEARCH_EXCEL_RESEARCH_MAX_QUERIES:
      process.env.SEARCH_EXCEL_RESEARCH_MAX_QUERIES,
    SEARCH_RESULT_LIMIT_PER_QUERY: process.env.SEARCH_RESULT_LIMIT_PER_QUERY,
    SEARCH_AUDIT_RETENTION_DAYS: process.env.SEARCH_AUDIT_RETENTION_DAYS,
    BIDTOOL_EXCEL_RESEARCH_DIR: process.env.BIDTOOL_EXCEL_RESEARCH_DIR,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    AUTH_ENABLED: process.env.AUTH_ENABLED,
    AUTH_BOOTSTRAP_TOKEN: process.env.AUTH_BOOTSTRAP_TOKEN,
    AUTH_DESKTOP_AUTO_ADMIN: process.env.AUTH_DESKTOP_AUTO_ADMIN,
    // NEXT_PUBLIC_CLIENTVAR: process.env.NEXT_PUBLIC_CLIENTVAR,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});
