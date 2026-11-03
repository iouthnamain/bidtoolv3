import { defineConfig } from "vitest/config";
import unitConfig from "../../vitest.config";
import { requireTestDatabase } from "../fixtures/remediation/test-target";

const databaseUrl = requireTestDatabase();

export default defineConfig({
  ...unitConfig,
  test: {
    ...unitConfig.test,
    include: ["tests/integration/**/*.test.ts"],
    exclude: [],
    globalSetup: ["./tests/integration/setup.ts"],
    env: {
      ...unitConfig.test?.env,
      DATABASE_URL: databaseUrl,
      BIDTOOL_TEST_DATABASE_URL: databaseUrl,
    },
  },
});
