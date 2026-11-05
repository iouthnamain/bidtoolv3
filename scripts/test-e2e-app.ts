import { spawn, type ChildProcess } from "node:child_process";
import { cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrateTestDatabase } from "../tests/integration/setup";
import {
  requireMatchingAppDatabase,
  testAppTarget,
  testIdentity,
} from "../tests/fixtures/remediation/test-target";

const databaseUrl = requireMatchingAppDatabase();
const { port, origin } = testAppTarget();
const runId = process.env.BIDTOOL_TEST_RUN_ID;
if (!runId)
  throw new Error("Only launch this app through the Playwright configuration.");
const identity = testIdentity(databaseUrl, runId);
const root = fileURLToPath(new URL("../", import.meta.url));
let ready = false;
let appPort = 0;
let child: ChildProcess | undefined;
let sandbox: string | undefined;

// Hold the public port before migrations. Next cannot silently switch the tested port.
const proxy = createServer((incoming, outgoing) => {
  outgoing.setHeader("x-bidtool-test-identity", identity);
  if (!ready) {
    outgoing.writeHead(503).end("Test app starting");
    return;
  }
  if (incoming.url === "/__bidtool_test_ready") {
    outgoing.writeHead(200).end("Owned test app ready");
    return;
  }
  const upstream = request(
    {
      hostname: "127.0.0.1",
      port: appPort,
      path: incoming.url,
      method: incoming.method,
      headers: incoming.headers,
    },
    (response) => {
      outgoing.writeHead(response.statusCode ?? 502, {
        ...response.headers,
        "x-bidtool-test-identity": identity,
      });
      response.pipe(outgoing);
    },
  );
  upstream.on("error", () => outgoing.destroy());
  incoming.on("aborted", () => upstream.destroy());
  outgoing.on("close", () => upstream.destroy());
  incoming.pipe(upstream);
});

let cleanupPromise: Promise<void> | undefined;
function cleanup() {
  cleanupPromise ??= cleanupOwnedResources();
  return cleanupPromise;
}

async function cleanupOwnedResources() {
  ready = false;
  proxy.closeAllConnections();
  proxy.close();
  if (child?.exitCode === null && child.signalCode === null) {
    const exited = new Promise<void>((resolve) =>
      child?.once("exit", () => resolve()),
    );
    child.kill("SIGTERM");
    const timer = setTimeout(() => child?.kill("SIGKILL"), 5000);
    await exited;
    clearTimeout(timer);
  }
  if (sandbox) await rm(sandbox, { recursive: true, force: true });
}
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void cleanup().then(() => process.exit(0));
  });
}

try {
  await new Promise<void>((resolve, reject) => {
    proxy.once("error", () =>
      reject(
        new Error(`Test app port ${port} is occupied; refusing to reuse it.`),
      ),
    );
    proxy.listen(port, "127.0.0.1", resolve);
  });
  await migrateTestDatabase(databaseUrl);
  sandbox = await mkdtemp(path.join(tmpdir(), "bidtool-e2e-"));
  // Copy only app inputs: no .env files, existing data, build outputs, or credentials.
  for (const entry of [
    "src",
    "public",
    "next.config.js",
    "tsconfig.json",
    "postcss.config.js",
    "package.json",
  ]) {
    await cp(path.join(root, entry), path.join(sandbox, entry), {
      recursive: true,
    });
  }
  await symlink(
    path.join(root, "node_modules"),
    path.join(sandbox, "node_modules"),
    "dir",
  );
  child = spawn("node", [path.join(root, "scripts/test-e2e-next.mjs")], {
    cwd: sandbox,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      NODE_ENV: "development",
      DATABASE_URL: databaseUrl,
      BIDTOOL_TEST_DATABASE_URL: databaseUrl,
      BIDTOOL_TEST_RUN_ID: runId,
      APP_BASE_URL: origin,
      ENABLE_DEMO_SEED: "false",
      NEXT_TELEMETRY_DISABLED: "1",
      BIDTOOL_EXCEL_RESEARCH_DIR: path.join(sandbox, "data/excel-research"),
      BIDTOOL_CATALOG_PDF_DIR: path.join(sandbox, "data/catalog-pdfs"),
    },
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  child.once("exit", (code) => {
    ready = false;
    if (!cleanupPromise)
      void cleanup().then(() =>
        process.exit(code === 0 || code === null ? 1 : code),
      );
  });
  child.once("error", (error) => {
    console.error(error);
    void cleanup().then(() => process.exit(1));
  });
  // Only the owned child can report the port it has already bound.
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Owned E2E app did not become ready.")),
      100_000,
    );
    child?.once("message", (message: unknown) => {
      clearTimeout(timer);
      if (
        !message ||
        typeof message !== "object" ||
        !("identity" in message) ||
        message.identity !== identity ||
        !("port" in message) ||
        typeof message.port !== "number" ||
        !Number.isInteger(message.port) ||
        message.port < 1024 ||
        message.port > 65535
      ) {
        reject(new Error("Owned E2E app/database identity mismatch."));
        return;
      }
      appPort = message.port;
      ready = true;
      resolve();
    });
    child?.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("Owned E2E app exited before readiness."));
    });
  });
} catch (error) {
  await cleanup();
  throw error;
}
