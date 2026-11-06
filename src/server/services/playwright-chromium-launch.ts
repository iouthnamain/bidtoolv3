import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { isIP } from "node:net";
import type { Browser } from "playwright";
import { isPublicIpAddress } from "~/server/services/public-content-client";
import { applyPlaywrightPlatformEnv } from "~/server/services/playwright-platform-env";

const LINUX_LAUNCH_ARGS = ["--disable-dev-shm-usage", "--no-sandbox"] as const;

export type ChromiumNetworkTarget = {
  hostname: string;
  address: string;
};

let chromiumInstallPromise: Promise<void> | null = null;

async function runPlaywrightChromiumInstall(): Promise<void> {
  const bunExecutable = process.execPath;

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      bunExecutable,
      ["x", "playwright", "install", "chromium", "--force"],
      {
        env: applyPlaywrightPlatformEnv(),
        stdio: "inherit",
      },
    );

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `playwright install chromium --force exited with code ${code ?? 1}`,
        ),
      );
    });
  });
}

/**
 * Ensure Playwright's Chromium binary exists on disk. Downloads it on demand
 * when the cache folder is present but the executable is missing (common on
 * fresh Ubuntu servers after an interrupted install).
 */
export async function ensurePlaywrightChromiumDownloaded(): Promise<string> {
  const { ensurePlaywrightPlatformEnvInProcess } =
    await import("~/server/services/playwright-platform-env");
  ensurePlaywrightPlatformEnvInProcess();

  const { chromium } = await import("playwright");
  const executablePath = chromium.executablePath();

  if (existsSync(executablePath)) {
    return executablePath;
  }

  chromiumInstallPromise ??= runPlaywrightChromiumInstall().finally(() => {
    chromiumInstallPromise = null;
  });

  await chromiumInstallPromise;

  if (!existsSync(executablePath)) {
    throw new Error(
      `Playwright Chromium is still missing at ${executablePath}. Run "bun x playwright install chromium --force" from the repo root.`,
    );
  }

  return executablePath;
}

/**
 * Launch Playwright-managed Chromium for server-side rendering/scraping.
 *
 * Playwright's default headless launch prefers the separate
 * chrome-headless-shell binary, which is often missing after partial installs
 * on Linux servers. Point at the full Chromium build instead.
 */
export async function launchManagedChromium(
  systemExecutablePath?: string | null,
  networkTarget?: ChromiumNetworkTarget,
): Promise<Browser> {
  const { chromium } = await import("playwright");
  const resolverArgs = networkTarget
    ? [buildChromiumHostResolverRule(networkTarget)].filter(
        (rule): rule is string => Boolean(rule),
      )
    : [];
  const launchOptions = {
    headless: true as const,
    args: [...LINUX_LAUNCH_ARGS, ...resolverArgs],
  };

  if (systemExecutablePath && existsSync(systemExecutablePath)) {
    try {
      return await chromium.launch({
        ...launchOptions,
        executablePath: systemExecutablePath,
      });
    } catch {
      // Fall back to Playwright-managed Chromium below.
    }
  }

  const executablePath = await ensurePlaywrightChromiumDownloaded();

  return chromium.launch({
    ...launchOptions,
    executablePath,
  });
}

export function buildChromiumHostResolverRule(target: ChromiumNetworkTarget) {
  const hostname = target.hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (isIP(hostname) !== 0) return null;
  if (
    !hostname ||
    !/^[a-z0-9.-]+$/.test(hostname) ||
    !isPublicIpAddress(target.address)
  ) {
    throw new Error("Không thể ghim browser tới đích không công khai.");
  }

  const address = target.address.includes(":")
    ? `[${target.address}]`
    : target.address;
  // Chromium keeps the URL's hostname for HTTP Host and HTTPS SNI/certificate
  // checks; this rule changes only the connection address selected for it.
  return `--host-resolver-rules=MAP ${hostname} ${address}`;
}

export async function verifyManagedChromiumLaunch(): Promise<boolean> {
  try {
    const browser = await launchManagedChromium();
    await browser.close();
    return true;
  } catch {
    return false;
  }
}
