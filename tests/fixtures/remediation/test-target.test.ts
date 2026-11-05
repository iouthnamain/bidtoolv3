import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import {
  requireMatchingAppDatabase,
  requireTestDatabase,
  testAppTarget,
} from "./test-target";

const testUrl =
  "postgres://bidtool_test:fixture@127.0.0.1:5432/bidtool_test_guard";

test("a missing dedicated variable never falls back to DATABASE_URL", () => {
  expect(() => requireTestDatabase({ DATABASE_URL: testUrl })).toThrow(
    "BIDTOOL_TEST_DATABASE_URL is required",
  );
});

test.each([
  "postgres://bidtool_test@127.0.0.1:5432/bidtoolv3",
  "postgres://bidtool_test@127.0.0.1:5432/customer",
  "postgres://postgres@127.0.0.1:5432/bidtool_test_guard",
  "postgres://bidtool_test@db.example.com:5432/bidtool_test_guard",
  `${testUrl}?host=customer`,
  `${testUrl}#unsafe`,
  "file:///bidtool_test_guard",
  "not a URL",
])("refuses unsafe test target %s before creating a client", (value) => {
  expect(() =>
    requireTestDatabase({ BIDTOOL_TEST_DATABASE_URL: value }),
  ).toThrow();
});

test("normal app settings cannot override the dedicated test connection", () => {
  expect(
    requireTestDatabase({
      BIDTOOL_TEST_DATABASE_URL: testUrl,
      DATABASE_URL: "postgres://dev@127.0.0.1/bidtoolv3",
    }),
  ).toBe(testUrl);
  expect(() =>
    requireMatchingAppDatabase({
      BIDTOOL_TEST_DATABASE_URL: testUrl,
      DATABASE_URL: "postgres://dev@127.0.0.1/bidtoolv3",
    }),
  ).toThrow("does not match");
});

test.each([
  "http://127.0.0.1:3000",
  "https://example.com",
  "http://localhost:4317",
  "http://127.0.0.1:4317/other",
])("refuses unowned app origin %s", (value) => {
  expect(() => testAppTarget({ PLAYWRIGHT_BASE_URL: value })).toThrow(
    "owned test origin",
  );
});

test.each(["3000", "0", "1023", "65536", "NaN"])(
  "refuses unsafe app port %s",
  (port) => {
    expect(() => testAppTarget({ BIDTOOL_TEST_PORT: port })).toThrow(
      "BIDTOOL_TEST_PORT",
    );
  },
);

test("launcher rejects mismatches and occupied ports before invoking migrations", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bidtool-launcher-guard-"));
  const bun = execFileSync("which", ["bun"], { encoding: "utf8" }).trim();
  const log = path.join(dir, "migration-called");
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  try {
    // Any attempt to migrate would call this fake instead of reaching PostgreSQL.
    await writeFile(
      path.join(dir, "bun"),
      `#!/bin/sh\ntouch '${log}'\nexit 99\n`,
      { mode: 0o755 },
    );
    for (const databaseUrl of [testUrl, "postgres://dev@127.0.0.1/bidtoolv3"]) {
      const result = await new Promise<{ code: number | null; stderr: string }>(
        (resolve, reject) => {
          const child = spawn(bun, ["run", "./scripts/test-e2e-app.ts"], {
            env: {
              NODE_ENV: "test",
              PATH: `${dir}:${process.env.PATH ?? ""}`,
              BIDTOOL_TEST_DATABASE_URL: testUrl,
              DATABASE_URL: databaseUrl,
              BIDTOOL_TEST_PORT: String(address.port),
              BIDTOOL_TEST_RUN_ID: "fixture",
            },
            stdio: "pipe",
          });
          let stderr = "";
          child.stdout.resume();
          child.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
          });
          child.once("error", reject);
          child.once("exit", (code) => resolve({ code, stderr }));
        },
      );
      expect(result.code).not.toBe(0);
      expect(result.stderr).toMatch(/occupied|does not match/);
    }
    await expect(readFile(log)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test(".env.local cannot replace an explicit test connection or supply a fallback", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bidtool-env-guard-"));
  const bun = execFileSync("which", ["bun"], { encoding: "utf8" }).trim();
  const modulePath = path.resolve("tests/fixtures/remediation/test-target.ts");
  try {
    await writeFile(
      path.join(dir, ".env.local"),
      "DATABASE_URL=postgres://dev@127.0.0.1/bidtoolv3\n",
    );
    const script = `import { requireTestDatabase } from ${JSON.stringify(modulePath)}; console.log(requireTestDatabase()); console.log(process.env.DATABASE_URL);`;
    const output = execFileSync(bun, ["--eval", script], {
      cwd: dir,
      env: {
        NODE_ENV: "development",
        BIDTOOL_TEST_DATABASE_URL: testUrl,
        PATH: process.env.PATH,
      },
      encoding: "utf8",
    });
    expect(output.trim().split("\n")).toEqual([
      testUrl,
      "postgres://dev@127.0.0.1/bidtoolv3",
    ]);
    expect(() =>
      execFileSync(bun, ["--eval", script], {
        cwd: dir,
        env: { NODE_ENV: "development", PATH: process.env.PATH },
        stdio: "pipe",
      }),
    ).toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
