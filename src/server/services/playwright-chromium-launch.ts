import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import type { Browser } from "playwright";
import { applyPlaywrightPlatformEnv } from "~/server/services/playwright-platform-env";

const LINUX_LAUNCH_ARGS = ["--disable-dev-shm-usage", "--no-sandbox"] as const;

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
): Promise<Browser> {
  const { chromium } = await import("playwright");
  const launchOptions = {
    headless: true as const,
    args: [...LINUX_LAUNCH_ARGS],
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

export async function verifyManagedChromiumLaunch(): Promise<boolean> {
  try {
    const browser = await launchManagedChromium();
    await browser.close();
    return true;
  } catch {
    return false;
  }
}
