import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  parseReleaseManifest,
  parseReleasePins,
  type ReleasePinEntry,
} from "../src/lib/release-manifest";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const defaultPinsPath = path.join(rootDir, "releases/pins.json");

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

function buildPinEntry(
  manifestUrl: string,
  manifest: ReturnType<typeof parseReleaseManifest>,
): ReleasePinEntry {
  return {
    releasedAt: manifest.releasedAt,
    manifestUrl,
    web: manifest.artifacts.web,
    onprem: manifest.artifacts.onprem,
    desktop: manifest.artifacts.desktop,
  };
}

async function main() {
  const manifestPath =
    readArg("--manifest") ??
    path.join(rootDir, "dist-release/manifest.json");
  const pinsPath = readArg("--pins") ?? defaultPinsPath;
  const manifestUrl = readArg("--manifest-url");
  if (!manifestUrl) {
    throw new Error("Missing required --manifest-url.");
  }

  const manifest = parseReleaseManifest(
    JSON.parse(await readFile(manifestPath, "utf8")) as unknown,
  );
  const pins = parseReleasePins(
    JSON.parse(await readFile(pinsPath, "utf8")) as unknown,
  );

  pins.current = manifest.version;
  pins.releases[manifest.version] = buildPinEntry(manifestUrl, manifest);

  await writeFile(pinsPath, `${JSON.stringify(pins, null, 2)}\n`, "utf8");
  console.log(pinsPath);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[update-release-pins] ${message}`);
  process.exit(1);
});
