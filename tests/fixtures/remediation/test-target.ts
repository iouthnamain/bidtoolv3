import { createHash } from "node:crypto";

// Dedicated loopback database and role only; never read DATABASE_URL as a fallback.
export function requireTestDatabase(
  env: Record<string, string | undefined> = process.env,
) {
  const value = env.BIDTOOL_TEST_DATABASE_URL;
  if (!value) {
    throw new Error(
      "BIDTOOL_TEST_DATABASE_URL is required. Create a disposable PostgreSQL 16 database named bidtool_test_<suffix> with role bidtool_test on loopback.",
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("BIDTOOL_TEST_DATABASE_URL must be a PostgreSQL URL.");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username !== "bidtool_test" ||
    !/^\/bidtool_test_[a-z0-9_]+$/.test(url.pathname) ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Unsafe test database: require loopback, role bidtool_test, name bidtool_test_<suffix>, and no URL query/fragment.",
    );
  }
  return url.href;
}

export function testAppTarget(
  env: Record<string, string | undefined> = process.env,
) {
  const port = Number(env.BIDTOOL_TEST_PORT ?? "4317");
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 3000) {
    throw new Error("BIDTOOL_TEST_PORT must be 1024–65535 and cannot be 3000.");
  }
  const origin = `http://127.0.0.1:${port}`;
  if (env.PLAYWRIGHT_BASE_URL && env.PLAYWRIGHT_BASE_URL !== origin) {
    throw new Error(
      `PLAYWRIGHT_BASE_URL must equal the owned test origin ${origin}.`,
    );
  }
  return { port, origin };
}

export function requireMatchingAppDatabase(
  env: Record<string, string | undefined> = process.env,
) {
  const databaseUrl = requireTestDatabase(env);
  if (env.DATABASE_URL !== databaseUrl) {
    throw new Error(
      "App DATABASE_URL does not match BIDTOOL_TEST_DATABASE_URL.",
    );
  }
  return databaseUrl;
}

export function testIdentity(databaseUrl: string, runId: string) {
  return createHash("sha256").update(`${databaseUrl}\n${runId}`).digest("hex");
}
