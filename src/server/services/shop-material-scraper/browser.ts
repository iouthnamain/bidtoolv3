import { existsSync } from "node:fs";

import type { Browser } from "playwright";

import { isServerlessRuntime } from "~/server/runtime";
import { launchManagedChromium } from "~/server/services/playwright-chromium-launch";

const BROWSER_CLOSE_TIMEOUT_MS = 2_000;
const SERVERLESS_CHROMIUM_PACK_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v147.0.0/chromium-v147.0.0-pack.x64.tar";

type BrowserWithProcess = Browser & {
  process?: () => { kill: (signal?: string) => boolean };
};

let SHARED_BROWSER_PROMISE: Promise<Browser> | null = null;

export async function getSharedBrowser() {
  SHARED_BROWSER_PROMISE ??= launchBrowser().catch((error) => {
    SHARED_BROWSER_PROMISE = null;
    throw error;
  });

  return SHARED_BROWSER_PROMISE;
}

export async function closeShopScraperBrowser() {
  const browserPromise = SHARED_BROWSER_PROMISE;
  SHARED_BROWSER_PROMISE = null;
  if (!browserPromise) {
    return;
  }

  const browser = await browserPromise.catch(() => null);
  if (!browser) {
    return;
  }

  const browserClosed = await withTimeout(
    browser.close().then(() => true),
    BROWSER_CLOSE_TIMEOUT_MS,
    "Đóng browser quá thời gian.",
  ).catch(() => false);
  if (!browserClosed) {
    (browser as BrowserWithProcess).process?.()?.kill("SIGKILL");
  }
}

async function launchBrowser(): Promise<Browser> {
  if (isServerlessRuntime()) {
    return launchServerlessBrowser();
  }

  try {
    return registerBrowser(
      await launchManagedChromium(findSystemBrowserExecutable()),
    );
  } catch (error) {
    throw browserLaunchError(error);
  }
}

async function launchServerlessBrowser(): Promise<Browser> {
  const [{ chromium: playwrightChromium }, sparticuzChromium] =
    await Promise.all([
      import("playwright-core"),
      import("@sparticuz/chromium-min"),
    ]);
  const chromium = sparticuzChromium.default;
  const chromiumPackUrl =
    process.env.CHROMIUM_REMOTE_EXEC_PATH?.trim() ??
    SERVERLESS_CHROMIUM_PACK_URL;

  try {
    const executablePath = await chromium.executablePath(chromiumPackUrl);
    return registerBrowser(
      await playwrightChromium.launch({
        args: [...chromium.args, "--disable-dev-shm-usage", "--no-sandbox"],
        executablePath,
        headless: true,
      }),
    );
  } catch (error) {
    throw browserLaunchError(error);
  }
}

function browserLaunchError(error: unknown) {
  return new Error(
    error instanceof Error
      ? `Không khởi động được browser scrape. Chạy "bun x playwright install chromium --force" từ thư mục repo (hoặc "bun run dev:update"). Trên Ubuntu có thể cần: sudo env "PATH=$PATH" bun x playwright install-deps chromium. ${error.message}`
      : "Không khởi động được browser scrape.",
  );
}

function registerBrowser(browser: Browser) {
  browser.on("disconnected", () => {
    SHARED_BROWSER_PROMISE = null;
  });
  return browser;
}

function windowsBrowserCandidates(): string[] {
  const roots = [
    process.env.PROGRAMFILES,
    process.env["PROGRAMFILES(X86)"],
    process.env.LOCALAPPDATA,
  ].filter((value): value is string => Boolean(value));

  const relativePaths = [
    "Google\\Chrome\\Application\\chrome.exe",
    "Google\\Chrome Beta\\Application\\chrome.exe",
    "Chromium\\Application\\chrome.exe",
    "Microsoft\\Edge\\Application\\msedge.exe",
  ];

  const candidates: string[] = [];
  for (const root of roots) {
    for (const relativePath of relativePaths) {
      candidates.push(`${root}\\${relativePath}`);
    }
  }

  candidates.push(
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  );

  return candidates;
}

function findSystemBrowserExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ...windowsBrowserCandidates(),
  ].filter((value): value is string => Boolean(value));

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}
