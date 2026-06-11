import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  parseReleaseManifest,
  type ReleaseManifest,
} from "../src/lib/release-manifest";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const journalPath = path.join(rootDir, "drizzle/meta/_journal.json");

type GenerateManifestInput = {
  version: string;
  commitSha: string;
  changelog?: string;
  web: ReleaseManifest["artifacts"]["web"];
  onprem: ReleaseManifest["artifacts"]["onprem"];
  desktop: ReleaseManifest["artifacts"]["desktop"];
};

function readArg(name: string): string | undefined {
  const equalsArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) {
    return equalsArg.slice(name.length + 1);
  }

  const index = process.argv.indexOf(name);
  if (index >= 0) {
    return process.argv[index + 1];
  }

  return undefined;
}

async function loadInput(): Promise<GenerateManifestInput> {
  const inputPath = readArg("--input");
  if (inputPath) {
    const raw = JSON.parse(await readFile(inputPath, "utf8")) as unknown;
    return raw as GenerateManifestInput;
  }

  const stdin = await readFile("/dev/stdin", "utf8");
  if (stdin.trim()) {
    return JSON.parse(stdin) as GenerateManifestInput;
  }

  throw new Error("Missing manifest input. Pass --input <file> or pipe JSON on stdin.");
}

async function main() {
  const input = await loadInput();
  const outputPath =
    readArg("--output") ??
    path.join(rootDir, "dist-release/manifest.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
    entries: Array<{ idx: number }>;
  };
  const lastEntry = journal.entries.at(-1);

  const manifest = parseReleaseManifest({
    version: input.version,
    releasedAt: new Date().toISOString(),
    channel: "stable",
    schemaVersion: lastEntry?.idx ?? 0,
    changelog: input.changelog ?? `BidTool v3 ${input.version}`,
    artifacts: {
      web: input.web,
      onprem: input.onprem,
      desktop: input.desktop,
    },
    migrations: {
      forwardOnly: true,
      notes:
        "Database migrations are forward-only. Roll back app artifacts with rollback.yml; fix schema issues with a forward hotfix release.",
    },
  });

  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(outputPath);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[generate-release-manifest] ${message}`);
  process.exit(1);
});
