import { createServer } from "node:http";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");

function readArg(name: string, fallback: string): string {
  const equalsArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) {
    return equalsArg.slice(name.length + 1);
  }

  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1]!;
  }

  return fallback;
}

async function pathExists(target: string) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function resolveFile(root: string, requestPath: string) {
  const normalized = requestPath.replace(/^\/+/, "");
  const candidate = path.join(root, normalized);
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (!resolvedCandidate.startsWith(resolvedRoot)) {
    return null;
  }
  if (!(await pathExists(resolvedCandidate))) {
    return null;
  }
  return readFile(resolvedCandidate);
}

async function main() {
  const host = readArg("--host", "127.0.0.1");
  const port = Number(readArg("--port", "3000"));
  const releaseDir = path.resolve(
    rootDir,
    readArg("--dir", "release-mock"),
  );

  if (!(await pathExists(releaseDir))) {
    throw new Error(
      `Release directory '${releaseDir}' does not exist. Build mock desktop artifacts first.`,
    );
  }

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", `http://${host}:${port}`);
      const body = await resolveFile(releaseDir, url.pathname);
      if (!body) {
        response.statusCode = 404;
        response.end("Not found");
        return;
      }

      if (url.pathname.endsWith(".yml") || url.pathname.endsWith(".yaml")) {
        response.setHeader("content-type", "text/yaml; charset=utf-8");
      } else if (url.pathname.endsWith(".json")) {
        response.setHeader("content-type", "application/json; charset=utf-8");
      }

      response.statusCode = 200;
      response.end(body);
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  console.log(
    `[mock-update-server] Serving ${releaseDir} at http://${host}:${port}`,
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[mock-update-server] ${message}`);
  process.exit(1);
});
