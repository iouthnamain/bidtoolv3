import { readFileSync } from "node:fs";
import os from "node:os";

const UBUNTU_LIKE_IDS = new Set(["ubuntu", "pop", "neon", "tuxedo"]);

function readOsRelease(): { id: string; versionId: string } {
  try {
    const contents = readFileSync("/etc/os-release", "utf8");
    let id = "";
    let versionId = "";
    for (const line of contents.split("\n")) {
      if (line.startsWith("ID=")) {
        id = line.slice(3).replace(/^"|"$/g, "");
      }
      if (line.startsWith("VERSION_ID=")) {
        versionId = line.slice(11).replace(/^"|"$/g, "");
      }
    }
    return { id, versionId };
  } catch {
    return { id: "", versionId: "" };
  }
}

/**
 * Playwright only ships browser builds for specific distro tags. Newer Ubuntu
 * releases (26.04+) map to an unsupported tag unless overridden. Fall back to
 * the latest supported Ubuntu build, which works on newer releases in practice.
 */
export function resolvePlaywrightHostPlatformOverride(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const configured = env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE?.trim();
  if (configured) {
    return configured;
  }

  if (process.platform !== "linux") {
    return undefined;
  }

  const { id, versionId } = readOsRelease();
  if (!UBUNTU_LIKE_IDS.has(id)) {
    return undefined;
  }

  const major = Number.parseInt(versionId, 10);
  if (!Number.isFinite(major) || major < 26) {
    return undefined;
  }

  const arch = os.arch() === "arm64" ? "arm64" : "x64";
  return `ubuntu24.04-${arch}`;
}

export function applyPlaywrightPlatformEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const override = resolvePlaywrightHostPlatformOverride(baseEnv);
  if (!override) {
    return { ...baseEnv };
  }

  return {
    ...baseEnv,
    PLAYWRIGHT_HOST_PLATFORM_OVERRIDE: override,
  };
}

export function ensurePlaywrightPlatformEnvInProcess(): string | undefined {
  const override = resolvePlaywrightHostPlatformOverride();
  if (!override) {
    return undefined;
  }

  process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE ??= override;
  return override;
}
