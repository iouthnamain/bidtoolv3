import {
  requireTestDatabase,
  testAppTarget,
  testIdentity,
} from "./test-target";

export default async function verifyTestApp() {
  const databaseUrl = requireTestDatabase();
  const { origin } = testAppTarget();
  const runId = process.env.BIDTOOL_TEST_RUN_ID;
  if (!runId) throw new Error("Missing owned E2E app run identity.");
  const response = await fetch(`${origin}/__bidtool_test_ready`, {
    signal: AbortSignal.timeout(5000),
    redirect: "error",
  });
  await response.body?.cancel();
  if (
    !response.ok ||
    response.headers.get("x-bidtool-test-identity") !==
      testIdentity(databaseUrl, runId)
  ) {
    throw new Error(
      "E2E app/database identity mismatch; refusing fixture writes.",
    );
  }
}
