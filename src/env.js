import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    NODE_ENV: z.enum(["development", "test", "production"]),
    DATABASE_URL: z.string().url(),
    BIDWINNER_BASE_URL: z.string().url().default("https://bidwinner.info"),
    BIDWINNER_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
    PRODUCT_WEB_SEARCH_PROVIDER: z
      .enum(["auto", "searxng", "tavily"])
      .default("auto"),
    SEARXNG_BASE_URL: z.string().url().optional(),
    SEARXNG_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
    SEARXNG_MAX_RESULTS: z.coerce.number().int().min(1).max(20).default(8),
    SEARXNG_LANGUAGE: z.string().min(2).default("vi-VN"),
    SEARXNG_ENGINES: z.string().optional(),
    TAVILY_API_KEY: z.string().optional(),
    TAVILY_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
    TAVILY_MAX_RESULTS: z.coerce.number().int().min(1).max(20).default(8),
    ENABLE_DEMO_SEED: z.enum(["true", "false"]).optional().default("false"),
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
    BIDWINNER_BASE_URL: process.env.BIDWINNER_BASE_URL,
    BIDWINNER_TIMEOUT_MS: process.env.BIDWINNER_TIMEOUT_MS,
    PRODUCT_WEB_SEARCH_PROVIDER: process.env.PRODUCT_WEB_SEARCH_PROVIDER,
    SEARXNG_BASE_URL: process.env.SEARXNG_BASE_URL,
    SEARXNG_TIMEOUT_MS: process.env.SEARXNG_TIMEOUT_MS,
    SEARXNG_MAX_RESULTS: process.env.SEARXNG_MAX_RESULTS,
    SEARXNG_LANGUAGE: process.env.SEARXNG_LANGUAGE,
    SEARXNG_ENGINES: process.env.SEARXNG_ENGINES,
    TAVILY_API_KEY: process.env.TAVILY_API_KEY,
    TAVILY_TIMEOUT_MS: process.env.TAVILY_TIMEOUT_MS,
    TAVILY_MAX_RESULTS: process.env.TAVILY_MAX_RESULTS,
    ENABLE_DEMO_SEED: process.env.ENABLE_DEMO_SEED,
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
