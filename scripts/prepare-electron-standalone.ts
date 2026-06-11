import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const nextDistDirName = resolveNextDistDir();
const nextDistDir = path.join(rootDir, nextDistDirName);
const standaloneDir = path.join(nextDistDir, "standalone");
const staticSourceDir = path.join(nextDistDir, "static");
const staticTargetDir = path.join(standaloneDir, nextDistDirName, "static");
const publicSourceDir = path.join(rootDir, "public");
const publicTargetDir = path.join(standaloneDir, "public");
const stageDir = path.join(rootDir, ".electron-build", "app");
const stagePackageJsonPath = path.join(stageDir, "package.json");
const rootNodeModulesDir = path.join(rootDir, "node_modules");
const stageNodeModulesDir = path.join(stageDir, "node_modules");
const electronRuntimeDependencies = ["electron-updater"] as const;

type PackageManifest = {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

function resolveNextDistDir() {
  const distArgIndex = process.argv.indexOf("--dist");
  const equalsArg = process.argv.find((arg) => arg.startsWith("--dist="));
  const rawDistDir =
    equalsArg?.slice("--dist=".length) ??
    (distArgIndex >= 0 ? process.argv[distArgIndex + 1] : undefined) ??
    process.env.BIDTOOL_NEXT_DIST_DIR ??
    ".next";
  const distDir = rawDistDir.trim();

  if (!distDir || distDir === "--dist") {
    throw new Error("Missing value for --dist.");
  }
  if (path.isAbsolute(distDir) || distDir.split(/[\\/]/).includes("..")) {
    throw new Error(`Invalid Next output directory '${distDir}'.`);
  }

  return distDir;
}

async function pathExists(target: string) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function copyFresh(source: string, target: string) {
  if (!(await pathExists(source))) {
    return;
  }

  await rm(target, { force: true, recursive: true });
  await cp(source, target, { recursive: true });
}

async function removePackagedEnvFiles(targetDir: string) {
  const entries = await readdir(targetDir);
  await Promise.all(
    entries
      .filter((entry) => entry === ".env" || entry.startsWith(".env."))
      .map((entry) =>
        rm(path.join(targetDir, entry), { force: true, recursive: true }),
      ),
  );
}

function getNodeModulePath(baseDir: string, packageName: string) {
  return path.join(baseDir, ...packageName.split("/"));
}

async function readInstalledPackageManifest(packageName: string) {
  const packageDir = getNodeModulePath(rootNodeModulesDir, packageName);
  if (!(await pathExists(packageDir))) {
    throw new Error(
      `Missing installed dependency '${packageName}'. Run \`bun install\` first.`,
    );
  }

  return JSON.parse(
    await readFile(path.join(packageDir, "package.json"), "utf8"),
  ) as PackageManifest;
}

async function collectRuntimeDependencyClosure(entryNames: readonly string[]) {
  const packageNames = new Set<string>();
  const pending = [...entryNames];

  while (pending.length > 0) {
    const packageName = pending.pop();
    if (!packageName || packageNames.has(packageName)) {
      continue;
    }

    packageNames.add(packageName);
    const manifest = await readInstalledPackageManifest(packageName);
    const dependencies = {
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
    };

    pending.push(...Object.keys(dependencies));
  }

  return [...packageNames].sort();
}

async function copyRuntimeDependencies() {
  const packageNames = await collectRuntimeDependencyClosure(
    electronRuntimeDependencies,
  );

  await rm(stageNodeModulesDir, { force: true, recursive: true });
  await Promise.all(
    packageNames.map(async (packageName) => {
      const source = getNodeModulePath(rootNodeModulesDir, packageName);
      const target = getNodeModulePath(stageNodeModulesDir, packageName);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFresh(source, target);
    }),
  );
}

function resolveDesktopVersion(packageVersion: string | undefined) {
  const buildMetadata = process.env.BIDTOOL_BUILD_METADATA?.trim();
  if (buildMetadata) {
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(buildMetadata)) {
      throw new Error(
        `Invalid desktop build metadata '${buildMetadata}'. Use a semver value like 0.1.0+desktop.win.abc1234.`,
      );
    }
    return buildMetadata.replace(/^v/, "");
  }

  const envVersion = process.env.BIDTOOL_DESKTOP_VERSION?.trim();
  const rawVersion =
    envVersion && envVersion.length > 0
      ? envVersion
      : (packageVersion ?? "0.0.0");
  const version = rawVersion.replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(
      `Invalid desktop version '${rawVersion}'. Use a semver value like 0.1.0 or v0.1.0.`,
    );
  }
  return version;
}

async function updateStandalonePackageVersion(version: string) {
  const standalonePackageJsonPath = path.join(
    stageDir,
    ".next",
    "standalone",
    "package.json",
  );
  const packageJson = JSON.parse(
    await readFile(standalonePackageJsonPath, "utf8"),
  ) as Record<string, unknown>;

  packageJson.version = version;
  await writeFile(
    standalonePackageJsonPath,
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );
}

async function main() {
  if (!(await pathExists(path.join(standaloneDir, "server.js")))) {
    throw new Error(
      `Missing ${nextDistDirName}/standalone/server.js. Run \`bun run build\` first.`,
    );
  }

  await copyFresh(staticSourceDir, staticTargetDir);
  await copyFresh(publicSourceDir, publicTargetDir);
  await rm(stageDir, { force: true, recursive: true });
  await mkdir(stageDir, { recursive: true });
  await cp(path.join(rootDir, "electron"), path.join(stageDir, "electron"), {
    recursive: true,
  });
  await cp(standaloneDir, path.join(stageDir, ".next", "standalone"), {
    recursive: true,
  });
  await removePackagedEnvFiles(path.join(stageDir, ".next", "standalone"));

  const rootPackageJson = JSON.parse(
    await readFile(path.join(rootDir, "package.json"), "utf8"),
  ) as {
    dependencies?: Record<string, string>;
    description?: string;
    devDependencies?: Record<string, string>;
    name?: string;
    version?: string;
  };
  const runtimeDependencies = Object.fromEntries(
    electronRuntimeDependencies.map((name) => {
      const version =
        rootPackageJson.dependencies?.[name] ??
        rootPackageJson.devDependencies?.[name];
      if (!version) {
        throw new Error(`Missing Electron runtime dependency: ${name}`);
      }
      return [name, version];
    }),
  );
  const appVersion = resolveDesktopVersion(rootPackageJson.version);
  await updateStandalonePackageVersion(appVersion);

  await writeFile(
    stagePackageJsonPath,
    `${JSON.stringify(
      {
        author: "BidTool",
        description: rootPackageJson.description,
        main: "electron/main.cjs",
        name: rootPackageJson.name ?? "bidtoolv3",
        dependencies: runtimeDependencies,
        private: true,
        version: appVersion,
      },
      null,
      2,
    )}\n`,
  );
  await copyRuntimeDependencies();

  console.log("Prepared Next standalone assets for Electron.");
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[desktop-prepare] ${message}`);
  process.exit(1);
});
