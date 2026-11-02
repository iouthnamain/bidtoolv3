import { randomUUID } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import {
  requireTestDatabase,
  testAppTarget,
} from "./tests/fixtures/remediation/test-target";

const databaseUrl = requireTestDatabase();
const { origin } = testAppTarget();
process.env.BIDTOOL_TEST_RUN_ID ??= randomUUID();

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/fixtures/remediation/verify-app.ts",
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: origin,
    trace: "on-first-retry",
  },
  webServer: {
    command: "bun run ./scripts/test-e2e-app.ts",
    env: { DATABASE_URL: databaseUrl, BIDTOOL_TEST_DATABASE_URL: databaseUrl },
    url: `${origin}/__bidtool_test_ready`,
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.PLAYWRIGHT_CHANNEL,
      },
    },
  ],
});
