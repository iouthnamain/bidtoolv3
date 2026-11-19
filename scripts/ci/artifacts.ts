import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { requireSha } from "./source";

const fileSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9 ._+-]+$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().positive(),
});
const receiptSchema = z.object({
  sourceSha: z.string().regex(/^[a-f0-9]{40}$/),
  version: z.string().min(1),
  kind: z.enum(["windows", "linux", "bundle", "image"]),
  checks: z.array(z.string()).min(1),
  files: z.array(fileSchema).min(1),
});
type Receipt = z.infer<typeof receiptSchema>;

export async function checksum(
  file: string,
  algorithm: "sha256" | "sha512" = "sha256",
) {
  const hash = createHash(algorithm);
  // Images may exceed Buffer's size limit; do not load the archive into memory.
  for await (const chunk of createReadStream(file)) {
    if (!Buffer.isBuffer(chunk))
      throw new Error("Expected binary artifact stream");
    hash.update(chunk);
  }
  return hash.digest(algorithm === "sha512" ? "base64" : "hex");
}

async function requireFile(file: string) {
  if (!(await stat(file)).isFile() || (await stat(file)).size === 0)
    throw new Error(`Missing or empty file: ${file}`);
}

export async function checkDesktop(
  directory: string,
  stage: string,
  platform: "windows" | "linux",
  version: string,
  metadata: string,
) {
  for (const file of ["package.json", ".next/standalone/package.json"]) {
    z.object({ version: z.literal(metadata) }).parse(
      JSON.parse(await readFile(path.join(stage, file), "utf8")),
    );
  }
  for (const file of [
    "electron/main.cjs",
    ".next/standalone/server.js",
    ".next/standalone/node_modules/next/package.json",
  ])
    await requireFile(path.join(stage, file));
  for (const dir of [
    ".next/standalone/.next-electron/static",
    ".next/standalone/public",
  ]) {
    if (!(await readdir(path.join(stage, dir))).length)
      throw new Error(`Empty desktop assets: ${dir}`);
  }
  const envFiles = (await readdir(stage, { recursive: true })).filter((file) =>
    /^\.env(?:\.|$)/.test(path.basename(file)),
  );
  if (envFiles.length)
    throw new Error(`Packaged environment files: ${envFiles.join(", ")}`);
  const names = await readdir(directory);
  const extension = platform === "windows" ? ".exe" : ".AppImage";
  const installers = names.filter((file) => file.endsWith(extension));
  if (installers.length !== 1)
    throw new Error(`Expected exactly one ${extension} installer`);
  const installer = installers[0]!;
  if (!installer.includes(version))
    throw new Error("Installer name does not include release version");
  const yamlName = platform === "windows" ? "latest.yml" : "latest-linux.yml";
  const yaml = await readFile(path.join(directory, yamlName), "utf8");
  const yamlVersion = /^version: ['"]?([^\r\n'"]+)/m.exec(yaml)?.[1];
  if (yamlVersion !== version && yamlVersion !== metadata)
    throw new Error("Updater version mismatch");
  const updaterPath = /^path: ['"]?([^\r\n'"]+)/m.exec(yaml)?.[1];
  const updaterHash = /^sha512: (\S+)/m.exec(yaml)?.[1];
  if (
    updaterPath !== installer ||
    updaterHash !== (await checksum(path.join(directory, installer), "sha512"))
  )
    throw new Error("Updater installer checksum/path mismatch");
  const files = [installer, yamlName];
  if (platform === "windows") files.push(`${installer}.blockmap`);
  for (const file of files) await requireFile(path.join(directory, file));
  return files;
}

export async function checkBundle(archive: string, version: string) {
  const root = `bidtoolv3-onprem-${version}`;
  const listing = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
    .trim()
    .split("\n");
  if (
    listing.some(
      (name) => name.split("/").includes("..") || !name.startsWith(`${root}/`),
    )
  )
    throw new Error("Unsafe bundle path");
  const entries = execFileSync("tar", ["-tvzf", archive], { encoding: "utf8" })
    .trim()
    .split("\n");
  if (entries.some((entry) => !["-", "d"].includes(entry[0] ?? "")))
    throw new Error("Bundle must contain only regular files and directories");
  const directory = await mkdtemp(path.join(tmpdir(), "bidtool-bundle-"));
  try {
    execFileSync("tar", ["-xzf", archive, "-C", directory]);
    for (const file of [
      "compose.production.yml",
      "README.md",
      "scripts/onprem-backup.sh",
      "scripts/onprem-install.sh",
      "scripts/onprem-lib.sh",
      "scripts/onprem-restore.sh",
      "scripts/onprem-update.sh",
      "releases/pins.json",
      "deploy/caddy/Caddyfile",
      "deploy/onprem/.env.customer.example",
    ])
      await requireFile(path.join(directory, root, file));
    const template = await readFile(
      path.join(directory, root, "deploy/onprem/.env.customer.example"),
      "utf8",
    );
    if (
      !template.includes(
        `BIDTOOL_APP_IMAGE=ghcr.io/iouthnamain/bidtoolv3:${version}`,
      )
    )
      throw new Error("Bundle image version mismatch");
    if (
      listing.some(
        (name) =>
          /^\.env(?:\.|$)/.test(path.basename(name)) &&
          !name.endsWith("/.env.customer.example"),
      )
    )
      throw new Error("Bundle contains environment secrets");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function writeReceipt(
  directory: string,
  kind: Receipt["kind"],
  version: string,
  sha: string,
  names: string[],
  checks: string[],
) {
  requireSha(sha);
  const files = await Promise.all(
    names.map(async (name) => ({
      name,
      sha256: await checksum(path.join(directory, name)),
      size: (await stat(path.join(directory, name))).size,
    })),
  );
  const receipt = receiptSchema.parse({
    sourceSha: sha,
    version,
    kind,
    files,
    checks,
  });
  await writeFile(
    path.join(directory, `${kind}-evidence.json`),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
}

export async function verifyReceipt(
  directory: string,
  kind: Receipt["kind"],
  version: string,
  sha: string,
) {
  const receipt = receiptSchema.parse(
    JSON.parse(
      await readFile(path.join(directory, `${kind}-evidence.json`), "utf8"),
    ),
  );
  if (
    receipt.sourceSha !== requireSha(sha) ||
    receipt.version !== version ||
    receipt.kind !== kind
  )
    throw new Error("Artifact source/version/kind mismatch");
  const names = receipt.files.map((file) => file.name);
  if (new Set(names).size !== names.length)
    throw new Error("Duplicate artifact filenames");
  const required =
    kind === "windows"
      ? [".exe", ".exe.blockmap", "latest.yml"]
      : kind === "linux"
        ? [".AppImage", "latest-linux.yml"]
        : kind === "bundle"
          ? [`.tar.gz`]
          : ["runtime-image.tar"];
  if (required.some((suffix) => !names.some((name) => name.endsWith(suffix))))
    throw new Error("Missing required artifact in evidence");
  for (const file of receipt.files) {
    if (
      (await stat(path.join(directory, file.name))).size !== file.size ||
      (await checksum(path.join(directory, file.name))) !== file.sha256
    )
      throw new Error(`Corrupt artifact: ${file.name}`);
  }
  return receipt;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, directory = "release-assets", kind] = process.argv.slice(2);
  const version = process.env.BIDTOOL_APP_VERSION ?? "";
  const sha = process.env.SOURCE_SHA ?? "";
  if (command === "desktop" && (kind === "windows" || kind === "linux")) {
    const files = await checkDesktop(
      directory,
      ".electron-build/app",
      kind,
      version,
      process.env.BIDTOOL_BUILD_METADATA ?? "",
    );
    await writeReceipt(directory, kind, version, sha, files, [
      "staged files/version/no env",
      "installer updater SHA512",
      "native UI and restore NOT verified",
    ]);
  } else if (command === "bundle") {
    const name = `bidtoolv3-onprem-${version}.tar.gz`;
    await checkBundle(path.join(directory, name), version);
    await writeReceipt(
      directory,
      "bundle",
      version,
      sha,
      [name],
      ["archive contents and image version", "restore NOT verified"],
    );
  } else if (command === "image") {
    await writeReceipt(
      directory,
      "image",
      version,
      sha,
      ["runtime-image.tar"],
      [
        "image migrations/restart/HTTP liveness",
        "image version and OCI revision",
        "browser/upgrade/restore NOT verified",
      ],
    );
  } else if (command === "verify") {
    for (const artifactKind of ["windows", "linux", "bundle"] as const)
      await verifyReceipt(directory, artifactKind, version, sha);
    await checkBundle(
      path.join(directory, `bidtoolv3-onprem-${version}.tar.gz`),
      version,
    );
    await verifyReceipt("image", "image", version, sha);
  } else
    throw new Error(
      "Usage: artifacts.ts desktop <dir> windows|linux; bundle|image|verify <dir>",
    );
}
