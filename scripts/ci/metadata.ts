import { readFile, writeFile, mkdir } from "node:fs/promises";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import {
  parseReleaseManifest,
  parseReleasePins,
  getSchemaVersionFromJournal,
} from "../../src/lib/release-manifest";
import { requireSha } from "./source";
import { verifyReceipt } from "./artifacts";

export function verifiedDeployment(
  input: unknown,
  sha: string,
  version: string,
) {
  const deployment = z
    .object({
      id: z.string().regex(/^dpl_[a-zA-Z0-9]+$/),
      url: z.string().regex(/^[a-zA-Z0-9.-]+$/),
      readyState: z.literal("READY"),
      meta: z.object({
        bidtoolSourceSha: z.literal(requireSha(sha)),
        bidtoolVersion: z.literal(version),
      }),
    })
    .parse(input);
  return {
    buildId: deployment.id,
    deploymentUrl: `https://${deployment.url}`,
    buildMetadata: `${version}+web.${sha.slice(0, 7)}`,
  };
}

async function main() {
  const sha = requireSha(process.env.SOURCE_SHA ?? "");
  const version = process.env.BIDTOOL_APP_VERSION ?? "0.1.0";
  const mode = process.argv[2];
  const json = async (file: string): Promise<unknown> =>
    JSON.parse(await readFile(file, "utf8")) as unknown;
  parseReleasePins(await json("releases/pins.json"));
  const journal = z
    .object({ entries: z.array(z.object({ idx: z.number() })) })
    .parse(await json("drizzle/meta/_journal.json"));

  let web = {
    buildId: "dpl_ci",
    deploymentUrl: "https://example.com",
    buildMetadata: `${version}+web.${sha.slice(0, 7)}`,
  };
  let image = "ghcr.io/example/bidtoolv3:0.1.0";
  let digest = `sha256:${"a".repeat(64)}`;
  let desktop = {
    win: {
      url: "https://example.com/app.exe",
      version: `${version}+desktop.win.${sha.slice(0, 7)}`,
    },
    linux: {
      url: "https://example.com/app.AppImage",
      version: `${version}+desktop.linux.${sha.slice(0, 7)}`,
    },
  };
  if (mode === "release") {
    web = verifiedDeployment(
      await json("dist-release/web-deployment.json"),
      sha,
      version,
    );
    image = z
      .string()
      .regex(/^ghcr\.io\/[a-z0-9._/-]+:[0-9]+\.[0-9]+\.[0-9]+$/)
      .parse(process.env.ONPREM_IMAGE);
    digest = z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .parse(process.env.ONPREM_DIGEST);
    const repository = z
      .string()
      .regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/)
      .parse(process.env.GITHUB_REPOSITORY);
    const base = `https://github.com/${repository}/releases/download/v${version}`;
    const win = await verifyReceipt("release-assets", "windows", version, sha);
    const linux = await verifyReceipt("release-assets", "linux", version, sha);
    desktop = {
      win: {
        ...desktop.win,
        url: `${base}/${encodeURIComponent(win.files.find((f) => f.name.endsWith(".exe"))!.name)}`,
      },
      linux: {
        ...desktop.linux,
        url: `${base}/${encodeURIComponent(linux.files.find((f) => f.name.endsWith(".AppImage"))!.name)}`,
      },
    };
  } else if (mode !== "fixture")
    throw new Error("Usage: metadata.ts fixture|release");
  const manifest = parseReleaseManifest({
    version,
    commitSha: sha,
    releasedAt: new Date().toISOString(),
    channel: "stable",
    schemaVersion: getSchemaVersionFromJournal(journal),
    changelog: `BidTool v3 ${version}`,
    artifacts: {
      web,
      onprem: {
        image,
        digest,
        buildMetadata: `${version}+onprem.${sha.slice(0, 7)}`,
      },
      desktop,
    },
    migrations: {
      forwardOnly: true,
      notes:
        "Artifact rollback does not roll back the database. Use forward schema fixes.",
    },
  });
  await mkdir("dist-release", { recursive: true });
  if (mode === "fixture") {
    await writeFile(
      "dist-release/manifest-input.json",
      JSON.stringify({ version, commitSha: sha, ...manifest.artifacts }),
    );
  }
  await writeFile(
    "dist-release/manifest.json",
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
