import { execFileSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  checkBundle,
  checkDesktop,
  checksum,
  verifyReceipt,
  writeReceipt,
} from "../scripts/ci/artifacts";

import { verifiedDeployment } from "../scripts/ci/metadata";

const directories: string[] = [];
const sha = "a".repeat(40);
afterEach(async () => {
  for (const dir of directories.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "bidtool-artifact-"));
  directories.push(directory);
  return directory;
}

test("artifact evidence rejects source/version mismatches, missing files and corrupt bytes", async () => {
  const directory = await fixture();
  const file = "app-1.2.3.AppImage";
  await writeFile(path.join(directory, file), "verified bytes");
  await writeFile(path.join(directory, "latest-linux.yml"), "fixture");
  await writeReceipt(
    directory,
    "linux",
    "1.2.3",
    sha,
    [file, "latest-linux.yml"],
    ["fixture only"],
  );
  await expect(
    verifyReceipt(directory, "linux", "1.2.3", sha),
  ).resolves.toMatchObject({ sourceSha: sha });
  await expect(
    verifyReceipt(directory, "linux", "1.2.3", "b".repeat(40)),
  ).rejects.toThrow("mismatch");
  await expect(verifyReceipt(directory, "linux", "2.0.0", sha)).rejects.toThrow(
    "mismatch",
  );
  await writeFile(path.join(directory, file), "corrupt bytes!");
  await expect(verifyReceipt(directory, "linux", "1.2.3", sha)).rejects.toThrow(
    "Corrupt",
  );
  await rm(path.join(directory, file));
  await expect(
    verifyReceipt(directory, "linux", "1.2.3", sha),
  ).rejects.toThrow();
});

test("receipts cannot omit required installers or traverse paths", async () => {
  const directory = await fixture();
  await writeFile(path.join(directory, "latest.yml"), "fixture");
  await writeReceipt(
    directory,
    "windows",
    "1.2.3",
    sha,
    ["latest.yml"],
    ["fixture only"],
  );
  await expect(
    verifyReceipt(directory, "windows", "1.2.3", sha),
  ).rejects.toThrow("Missing required");
  const receipt = JSON.parse(
    await readFile(path.join(directory, "windows-evidence.json"), "utf8"),
  );
  receipt.files[0].name = "../secret";
  await writeFile(
    path.join(directory, "windows-evidence.json"),
    JSON.stringify(receipt),
  );
  await expect(
    verifyReceipt(directory, "windows", "1.2.3", sha),
  ).rejects.toThrow();
});

test.each(["windows", "linux"] as const)(
  "desktop %s verifies versions, required files, env exclusion and real updater checksum",
  async (platform) => {
    const directory = await fixture();
    const stage = path.join(directory, "stage");
    const metadata = `1.2.3+desktop.${platform === "windows" ? "win" : "linux"}.aaaaaaa`;
    for (const file of [
      "package.json",
      ".next/standalone/package.json",
      "electron/main.cjs",
      ".next/standalone/server.js",
      ".next/standalone/node_modules/next/package.json",
      ".next/standalone/.next-electron/static/test.js",
      ".next/standalone/public/icon.png",
    ]) {
      await mkdir(path.dirname(path.join(stage, file)), { recursive: true });
      await writeFile(
        path.join(stage, file),
        file.endsWith("package.json")
          ? JSON.stringify({ version: metadata })
          : "fixture",
      );
    }
    const installer = `BidTool v3-1.2.3.${platform === "windows" ? "exe" : "AppImage"}`;
    const yaml = platform === "windows" ? "latest.yml" : "latest-linux.yml";
    await writeFile(path.join(directory, installer), "installer fixture");
    await writeFile(path.join(directory, `${installer}.blockmap`), "blockmap");
    await writeFile(
      path.join(directory, yaml),
      `version: 1.2.3\npath: ${installer}\nsha512: ${await checksum(path.join(directory, installer), "sha512")}\n`,
    );
    await expect(
      checkDesktop(directory, stage, platform, "1.2.3", metadata),
    ).resolves.toContain(installer);
    await expect(
      checkDesktop(directory, stage, platform, "1.2.3", "wrong"),
    ).rejects.toThrow();
    await writeFile(path.join(stage, ".env.production"), "SECRET=fixture");
    await expect(
      checkDesktop(directory, stage, platform, "1.2.3", metadata),
    ).rejects.toThrow("environment");
    await rm(path.join(stage, ".env.production"));
    await writeFile(path.join(directory, installer), "corrupt installer");
    await expect(
      checkDesktop(directory, stage, platform, "1.2.3", metadata),
    ).rejects.toThrow("checksum");
  },
);

test("real on-prem bundle has the expected helper set, image version and no secret env", async () => {
  const directory = await fixture();
  // Run the real packager against copied inputs; never replace local release outputs.
  for (const file of [
    "scripts/onprem-package-release.sh",
    "compose.production.yml",
    "deploy/caddy",
    "deploy/onprem/.env.customer.example",
    "README.md",
    "scripts/onprem-backup.sh",
    "scripts/onprem-install.sh",
    "scripts/onprem-lib.sh",
    "scripts/onprem-restore.sh",
    "scripts/onprem-update.sh",
    "releases",
  ]) {
    await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await cp(file, path.join(directory, file), { recursive: true });
  }
  execFileSync("sh", [
    path.join(directory, "scripts/onprem-package-release.sh"),
    "9.8.7",
  ]);
  const archive = path.join(
    directory,
    "dist-onprem/bidtoolv3-onprem-9.8.7.tar.gz",
  );
  try {
    await expect(checkBundle(archive, "9.8.7")).resolves.toBeUndefined();
    await expect(checkBundle(archive, "9.8.6")).rejects.toThrow("path");
    const root = "bidtoolv3-onprem-9.8.7";
    execFileSync("tar", ["-xzf", archive, "-C", directory]);
    await rm(path.join(directory, root, "scripts/onprem-lib.sh"));
    const broken = path.join(directory, "broken.tar.gz");
    execFileSync("tar", ["-czf", broken, "-C", directory, root]);
    await expect(checkBundle(broken, "9.8.7")).rejects.toThrow();
  } finally {
    await rm(archive, { force: true });
  }
});

test("web publication metadata requires a ready deployment bound to the exact source and version", () => {
  const input = {
    id: "dpl_fixture",
    url: "app-fixture.vercel.app",
    readyState: "READY",
    meta: { bidtoolSourceSha: sha, bidtoolVersion: "1.2.3" },
  };
  expect(verifiedDeployment(input, sha, "1.2.3")).toEqual({
    buildId: "dpl_fixture",
    deploymentUrl: "https://app-fixture.vercel.app",
    buildMetadata: "1.2.3+web.aaaaaaa",
  });
  for (const bad of [
    { ...input, id: "skipped" },
    { ...input, readyState: "ERROR" },
    { ...input, meta: { ...input.meta, bidtoolSourceSha: "b".repeat(40) } },
    { ...input, meta: { ...input.meta, bidtoolVersion: "2.0.0" } },
  ]) {
    expect(() => verifiedDeployment(bad, sha, "1.2.3")).toThrow();
  }
});

test("existing manifest generator retains full source SHA and rejects a short identity", async () => {
  const directory = await fixture();
  const inputFile = path.join(directory, "input.json");
  const outputFile = path.join(directory, "manifest.json");
  const input = {
    version: "1.2.3",
    commitSha: sha,
    web: {
      buildId: "dpl_fixture",
      deploymentUrl: "https://example.com",
      buildMetadata: "1.2.3+web.aaaaaaa",
    },
    onprem: {
      image: "ghcr.io/example/app:1.2.3",
      digest: `sha256:${"a".repeat(64)}`,
      buildMetadata: "1.2.3+onprem.aaaaaaa",
    },
    desktop: {
      linux: {
        url: "https://example.com/app.AppImage",
        version: "1.2.3+desktop.linux.aaaaaaa",
      },
    },
  };
  await writeFile(inputFile, JSON.stringify(input));
  execFileSync("bun", [
    "scripts/generate-release-manifest.ts",
    "--input",
    inputFile,
    "--output",
    outputFile,
  ]);
  expect(JSON.parse(await readFile(outputFile, "utf8")).commitSha).toBe(sha);
  await writeFile(
    inputFile,
    JSON.stringify({ ...input, commitSha: "aaaaaaa" }),
  );
  expect(() =>
    execFileSync(
      "bun",
      [
        "scripts/generate-release-manifest.ts",
        "--input",
        inputFile,
        "--output",
        outputFile,
      ],
      { stdio: "pipe" },
    ),
  ).toThrow();
});
