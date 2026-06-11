import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

import {
  bumpSemverCore,
  formatReleaseTag,
  normalizeReleaseVersion,
  parseReleasePins,
  pickLatestSemver,
  type SemverBump,
} from "../src/lib/release-manifest";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const pinsPath = path.join(rootDir, "releases/pins.json");
const packageJsonPath = path.join(rootDir, "package.json");

type ReleaseCommand = "status" | "patch" | "minor" | "major" | "release";

type CliOptions = {
  allowDirty: boolean;
  branch: string;
  bumpPackage: boolean;
  dryRun: boolean;
  explicitVersion: string | null;
  fetch: boolean;
  pushBranch: boolean;
  yes: boolean;
};

type PackageJson = {
  version?: string;
};

type GitStatus = {
  branch: string;
  clean: boolean;
  dirtyFiles: string[];
  ahead: number;
  behind: number;
};

function printUsage() {
  console.log(`BidTool release CLI

Usage:
  bun run release [command] [options]

Commands:
  status                 Show current and next versions (default)
  patch                  Tag and push the next patch release
  minor                  Tag and push the next minor release
  major                  Tag and push the next major release
  release [version]      Tag an explicit version (defaults to next patch)

Options:
  --branch <name>        Expected git branch (default: main)
  --dry-run              Print actions without tagging or pushing
  --yes, -y              Skip confirmation prompt
  --allow-dirty          Allow a dirty working tree
  --no-fetch             Skip git fetch before release
  --no-push-branch       Push tag only, not the current branch
  --bump-package         Update package.json version before tagging
  --help, -h             Show this help

Examples:
  bun run release
  bun run release patch
  bun run release release 0.2.0
  bun run release status
`);
}

function parseArgs(argv: string[]) {
  const options: CliOptions = {
    allowDirty: false,
    branch: "main",
    bumpPackage: false,
    dryRun: false,
    explicitVersion: null,
    fetch: true,
    pushBranch: true,
    yes: false,
  };

  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    switch (arg) {
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--yes":
      case "-y":
        options.yes = true;
        break;
      case "--allow-dirty":
        options.allowDirty = true;
        break;
      case "--no-fetch":
        options.fetch = false;
        break;
      case "--no-push-branch":
        options.pushBranch = false;
        break;
      case "--bump-package":
        options.bumpPackage = true;
        break;
      case "--branch":
        options.branch = argv[index + 1] ?? "";
        index += 1;
        break;
      default:
        if (arg.startsWith("--branch=")) {
          options.branch = arg.slice("--branch=".length);
          break;
        }
        positional.push(arg);
    }
  }

  if (!options.branch.trim()) {
    throw new Error("Missing value for --branch.");
  }

  let command: ReleaseCommand = "status";
  if (positional[0]) {
    if (
      positional[0] === "status" ||
      positional[0] === "patch" ||
      positional[0] === "minor" ||
      positional[0] === "major" ||
      positional[0] === "release"
    ) {
      command = positional[0];
      if (command === "release" && positional[1]) {
        options.explicitVersion = normalizeReleaseVersion(positional[1]);
      }
    } else {
      command = "release";
      options.explicitVersion = normalizeReleaseVersion(positional[0]);
    }
  }

  return { command, options };
}

async function runGit(args: string[]): Promise<string> {
  const { code, stderr, stdout } = await new Promise<{
    code: number;
    stderr: string;
    stdout: string;
  }>((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: rootDir,
      env: process.env,
      shell: false,
      stdio: "pipe",
    });

    let childStdout = "";
    let childStderr = "";

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      childStdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      childStderr += chunk;
    });

    child.once("error", reject);
    child.once("close", (exitCode) => {
      resolve({
        code: exitCode ?? 1,
        stderr: childStderr,
        stdout: childStdout,
      });
    });
  });

  if (code !== 0) {
    const message =
      [stderr, stdout].map((value) => value.trim()).find(Boolean) ??
      `exit code ${code}`;
    throw new Error(`git ${args.join(" ")} failed: ${message}`);
  }

  return stdout;
}

async function loadPackageVersion(): Promise<string | null> {
  const packageJson = JSON.parse(
    await readFile(packageJsonPath, "utf8"),
  ) as PackageJson;
  return packageJson.version?.trim() ?? null;
}

async function loadPinnedVersion(): Promise<string | null> {
  try {
    const pins = parseReleasePins(
      JSON.parse(await readFile(pinsPath, "utf8")) as unknown,
    );
    return pins.current?.trim() ?? null;
  } catch {
    return null;
  }
}

async function loadGitTagVersions(): Promise<string[]> {
  const output = await runGit(["tag", "--list", "v*", "--sort=-v:refname"]);
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((tag) => normalizeReleaseVersion(tag));
}

async function resolveLatestReleasedVersion(): Promise<string | null> {
  const [pinnedVersion, tagVersions, packageVersion] = await Promise.all([
    loadPinnedVersion(),
    loadGitTagVersions(),
    loadPackageVersion(),
  ]);
  return pickLatestSemver(
    [pinnedVersion, packageVersion, ...tagVersions].filter(
      (value): value is string => !!value,
    ),
  );
}

async function loadGitStatus(): Promise<GitStatus> {
  const branch = (await runGit(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  const status = (await runGit(["status", "--porcelain"])).trim();
  const dirtyFiles = status
    ? status.split("\n").map((line) => line.slice(3).trim())
    : [];
  const upstream = (await runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])).trim();
  let ahead = 0;
  let behind = 0;
  if (upstream && !upstream.includes("HEAD")) {
    const counts = (await runGit(["rev-list", "--left-right", "--count", "HEAD...@{u}"])).trim();
    const [behindCount, aheadCount] = counts.split(/\s+/).map(Number);
    ahead = aheadCount ?? 0;
    behind = behindCount ?? 0;
  }
  return {
    ahead,
    behind,
    branch,
    clean: dirtyFiles.length === 0,
    dirtyFiles,
  };
}

async function tagExists(tag: string): Promise<boolean> {
  try {
    await runGit(["rev-parse", "--verify", `refs/tags/${tag}`]);
    return true;
  } catch {
    return false;
  }
}

async function remoteTagExists(tag: string): Promise<boolean> {
  try {
    const output = await runGit(["ls-remote", "--tags", "origin", tag]);
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

async function syncPackageVersion(version: string, dryRun: boolean) {
  const packageJson = JSON.parse(
    await readFile(packageJsonPath, "utf8"),
  ) as PackageJson;
  if (packageJson.version === version) {
    return false;
  }
  if (dryRun) {
    console.log(`[release] Would update package.json version to ${version}`);
    return true;
  }
  packageJson.version = version;
  await writeFile(
    packageJsonPath,
    `${JSON.stringify(packageJson, null, 2)}\n`,
    "utf8",
  );
  console.log(`[release] Updated package.json version to ${version}`);
  return true;
}

async function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = (await rl.question(`${message} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function printStatus() {
  const [latestReleased, packageVersion, gitStatus, tagVersions] =
    await Promise.all([
      resolveLatestReleasedVersion(),
      loadPackageVersion(),
      loadGitStatus(),
      loadGitTagVersions(),
    ]);
  const baseVersion = latestReleased ?? packageVersion ?? "0.0.0";
  const nextPatch = bumpSemverCore(baseVersion, "patch");
  const nextMinor = bumpSemverCore(baseVersion, "minor");
  const nextMajor = bumpSemverCore(baseVersion, "major");

  console.log("BidTool release status");
  console.log(`  Branch:            ${gitStatus.branch}`);
  console.log(
    `  Working tree:      ${gitStatus.clean ? "clean" : `dirty (${gitStatus.dirtyFiles.length} files)`}`,
  );
  if (gitStatus.ahead > 0 || gitStatus.behind > 0) {
    console.log(`  Upstream delta:      ahead ${gitStatus.ahead}, behind ${gitStatus.behind}`);
  }
  console.log(`  Latest released:   ${latestReleased ?? "none"}`);
  console.log(`  package.json:      ${packageVersion ?? "unknown"}`);
  console.log(`  Latest git tag:    ${tagVersions[0] ?? "none"}`);
  console.log("");
  console.log("Suggested next versions");
  console.log(`  patch -> v${nextPatch}`);
  console.log(`  minor -> v${nextMinor}`);
  console.log(`  major -> v${nextMajor}`);
  console.log("");
  console.log("Quick commands");
  console.log("  bun run release patch");
  console.log("  bun run release minor");
  console.log("  bun run release major");
}

function resolveTargetVersion(
  latestReleased: string | null,
  bump: SemverBump | null,
  explicitVersion: string | null,
): string {
  if (explicitVersion) {
    return normalizeReleaseVersion(explicitVersion);
  }
  const baseVersion = latestReleased ?? "0.0.0";
  return bumpSemverCore(baseVersion, bump ?? "patch");
}

async function performRelease(
  bump: SemverBump | null,
  options: CliOptions,
) {
  if (options.fetch && !options.dryRun) {
    console.log("[release] Fetching origin...");
    await runGit(["fetch", "origin", "--tags", "--prune"]);
  }

  const [latestReleased, gitStatus] = await Promise.all([
    resolveLatestReleasedVersion(),
    loadGitStatus(),
  ]);
  const version = resolveTargetVersion(
    latestReleased,
    bump,
    options.explicitVersion,
  );
  const tag = formatReleaseTag(version);

  if (gitStatus.branch !== options.branch) {
    throw new Error(
      `Expected branch '${options.branch}' but currently on '${gitStatus.branch}'.`,
    );
  }
  if (!gitStatus.clean && !options.allowDirty) {
    throw new Error(
      "Working tree is dirty. Commit or stash changes first, or pass --allow-dirty.",
    );
  }
  if (gitStatus.behind > 0) {
    throw new Error(
      `Branch is behind upstream by ${gitStatus.behind} commit(s). Run git pull first.`,
    );
  }

  if (await tagExists(tag)) {
    throw new Error(`Tag '${tag}' already exists locally.`);
  }
  if (!options.dryRun && (await remoteTagExists(tag))) {
    throw new Error(`Tag '${tag}' already exists on origin.`);
  }

  console.log("");
  console.log(`Next release: ${tag}`);
  console.log(`Base version: ${latestReleased ?? "none"}`);
  console.log(`Commit:       ${(await runGit(["rev-parse", "--short", "HEAD"])).trim()}`);
  console.log("");

  if (!options.yes && !options.dryRun) {
    const approved = await confirm(`Create and push ${tag}?`);
    if (!approved) {
      console.log("[release] Cancelled.");
      return;
    }
  }

  if (options.bumpPackage) {
    await syncPackageVersion(version, options.dryRun);
  }

  if (options.dryRun) {
    console.log(`[release] Would create tag ${tag}`);
    if (options.pushBranch) {
      console.log("[release] Would push current branch to origin");
    }
    console.log(`[release] Would push tag ${tag} to origin`);
    console.log("[release] This triggers .github/workflows/release.yml");
    return;
  }

  await runGit(["tag", "-a", tag, "-m", `BidTool v3 ${tag}`]);
  console.log(`[release] Created tag ${tag}`);

  if (options.pushBranch) {
    await runGit(["push", "origin", gitStatus.branch]);
    console.log(`[release] Pushed branch ${gitStatus.branch}`);
  }

  await runGit(["push", "origin", tag]);
  console.log(`[release] Pushed tag ${tag}`);
  console.log("[release] GitHub Actions release workflow should start shortly.");
  console.log(`[release] On-prem update command: BIDTOOL_IMAGE_TAG=${version} bun run onprem:update`);
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  switch (command) {
    case "status":
      await printStatus();
      return;
    case "patch":
      await performRelease("patch", options);
      return;
    case "minor":
      await performRelease("minor", options);
      return;
    case "major":
      await performRelease("major", options);
      return;
    case "release":
      await performRelease(null, options);
      return;
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[release] ${message}`);
  process.exit(1);
});
