import { existsSync } from "node:fs";

import type { Browser } from "playwright";

import { isServerlessRuntime } from "~/server/runtime";
import {
  buildChromiumHostResolverRule,
  launchManagedChromium,
  type ChromiumNetworkTarget,
} from "~/server/services/playwright-chromium-launch";

const BROWSER_CLOSE_TIMEOUT_MS = 2_000;
const SERVERLESS_CHROMIUM_PACK_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v147.0.0/chromium-v147.0.0-pack.x64.tar";

type BrowserWithProcess = Browser & {
  process?: () => { kill: (signal?: string) => boolean };
};

type ShopBrowserNetworkTarget = ChromiumNetworkTarget;

type SharedBrowser = {
  promise: Promise<Browser>;
  users: number;
  closing?: Promise<void>;
};

const SHARED_BROWSERS = new Map<string, SharedBrowser>();

export async function acquireShopScraperBrowser(
  target: ShopBrowserNetworkTarget,
) {
  const key = browserTargetKey(target);
  let entry = SHARED_BROWSERS.get(key);
  if (!entry) {
    entry = { promise: launchBrowser(target), users: 0 };
    SHARED_BROWSERS.set(key, entry);
  }
  const shared = entry;
  shared.users += 1;

  try {
    const browser = await shared.promise;
    let released = false;
    return {
      browser,
      async release() {
        if (released) return;
        released = true;
        shared.users -= 1;
        if (shared.users !== 0) return;
        // Never retain an idle pinned browser or close another scrape's lease.
        if (SHARED_BROWSERS.get(key) === shared) SHARED_BROWSERS.delete(key);
        await closeSharedBrowser(shared);
      },
    };
  } catch (error) {
    shared.users -= 1;
    if (SHARED_BROWSERS.get(key) === shared) {
      SHARED_BROWSERS.delete(key);
    }
    throw error;
  }
}

export async function closeShopScraperBrowser() {
  const browsers = [...SHARED_BROWSERS.values()];
  SHARED_BROWSERS.clear();
  await Promise.all(browsers.map(closeSharedBrowser));
}

function closeSharedBrowser(shared: SharedBrowser) {
  return (shared.closing ??= (async () => {
    const browser = await shared.promise.catch(() => null);
    if (!browser) return;

    const browserClosed = await withTimeout(
      browser.close().then(() => true),
      BROWSER_CLOSE_TIMEOUT_MS,
      "Đóng browser quá thời gian.",
    ).catch(() => false);
    if (!browserClosed) {
      (browser as BrowserWithProcess).process?.()?.kill("SIGKILL");
    }
  })());
}

async function launchBrowser(
  target: ShopBrowserNetworkTarget,
): Promise<Browser> {
  if (isServerlessRuntime()) {
    return launchServerlessBrowser(target);
  }

  try {
    return registerBrowser(
      await launchManagedChromium(findSystemBrowserExecutable(), target),
    );
  } catch (error) {
    throw browserLaunchError(error);
  }
}

async function launchServerlessBrowser(
  target: ShopBrowserNetworkTarget,
): Promise<Browser> {
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
        args: [
          ...chromium.args,
          "--disable-dev-shm-usage",
          "--no-sandbox",
          ...[buildChromiumHostResolverRule(target)].filter(
            (rule): rule is string => Boolean(rule),
          ),
        ],
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
    for (const [key, shared] of SHARED_BROWSERS) {
      void shared.promise.then(
        (candidate) => {
          if (candidate === browser && SHARED_BROWSERS.get(key) === shared) {
            SHARED_BROWSERS.delete(key);
          }
        },
        () => undefined,
      );
    }
  });
  return browser;
}

function browserTargetKey(target: ShopBrowserNetworkTarget) {
  return `${target.hostname.toLowerCase()}\u0000${target.address}`;
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

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
) {
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
