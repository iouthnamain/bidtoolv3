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
