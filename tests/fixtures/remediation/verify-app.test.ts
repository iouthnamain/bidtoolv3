import { expect, test, vi } from "vitest";
import { createHttpFixture } from "./http";
import { testIdentity } from "./test-target";
import verifyTestApp from "./verify-app";

const databaseUrl =
  "postgres://bidtool_test@127.0.0.1:5432/bidtool_test_identity";

test.each([true, false])(
  "app/database identity must match before fixtures run (match=%s)",
  async (matches) => {
    const fixture = await createHttpFixture((_request, response) => {
      response.setHeader(
        "x-bidtool-test-identity",
        testIdentity(
          matches ? databaseUrl : `${databaseUrl}_other`,
          "owned-run",
        ),
      );
      response.end("ready");
    });
    try {
      vi.stubEnv("BIDTOOL_TEST_DATABASE_URL", databaseUrl);
      vi.stubEnv("BIDTOOL_TEST_RUN_ID", "owned-run");
      vi.stubEnv("BIDTOOL_TEST_PORT", new URL(fixture.origin).port);
      vi.stubEnv("PLAYWRIGHT_BASE_URL", fixture.origin);
      if (matches) await expect(verifyTestApp()).resolves.toBeUndefined();
      else await expect(verifyTestApp()).rejects.toThrow("identity mismatch");
    } finally {
      vi.unstubAllEnvs();
      await fixture.cleanup();
    }
  },
);
