import type { Browser } from "playwright";

const LINUX_LAUNCH_ARGS = ["--disable-dev-shm-usage", "--no-sandbox"] as const;

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

  if (systemExecutablePath) {
    try {
      return await chromium.launch({
        ...launchOptions,
        executablePath: systemExecutablePath,
      });
    } catch {
      // Fall back to Playwright-managed Chromium below.
    }
  }

  return chromium.launch({
    ...launchOptions,
    executablePath: chromium.executablePath(),
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
