import { lookup } from "node:dns/promises";
import { existsSync } from "node:fs";
import { isIP } from "node:net";

import type { Browser, Page } from "playwright";

import { extractPriceFromText } from "~/lib/material-price-sources";
import { mergeCatalogPdfUrls } from "~/lib/materials/catalog-pdf";
import { isServerlessRuntime } from "~/server/runtime";

export type ScrapedShopProduct = {
  name: string;
  unit: string | null;
  category: string | null;
  specText: string;
  manufacturer: string | null;
  originCountry: string | null;
  price: number | null;
  priceText: string | null;
  currency: string;
  sourceUrl: string;
  imageUrl: string | null;
  sku: string | null;
  model: string | null;
  availability: string | null;
  shopCategory: string | null;
  catalogPdfUrls: string[];
};

export type ShopScrapeResult = {
  products: ScrapedShopProduct[];
  pagesVisited: string[];
  failedPages: Array<{ url: string; message: string }>;
  durationMs: number;
  stopReason: ShopScrapeStopReason;
};

export const SHOP_SCRAPE_METHODS = ["auto", "json_ld", "dom_cards"] as const;
export type ShopScrapeMethod = (typeof SHOP_SCRAPE_METHODS)[number];
export const SHOP_DETAIL_ENRICHMENT_MODES = ["none", "missing_fields"] as const;
export type ShopDetailEnrichmentMode =
  (typeof SHOP_DETAIL_ENRICHMENT_MODES)[number];
export type ShopScrapeStopReason =
  | "queue_empty"
  | "page_limit"
  | "product_limit";

export type ShopScrapeProgress = {
  status: "starting" | "reading" | "extracting" | "complete";
  currentUrl: string | null;
  currentUrls: string[];
  pagesVisited: string[];
  failedPages: Array<{ url: string; message: string }>;
  productCount: number;
  queueLength: number;
  maxPages: number | null;
  maxProducts: number | null;
  method: ShopScrapeMethod;
  elapsedMs: number;
  products?: ScrapedShopProduct[];
  stopReason?: ShopScrapeStopReason;
  message?: string;
};

type ShopScrapeOptions = {
  url: string;
  maxPages?: number | null;
  maxProducts?: number | null;
  method?: ShopScrapeMethod;
  detailEnrichment?: ShopDetailEnrichmentMode;
  concurrentPages?: number;
  signal?: AbortSignal;
  onProgress?: (progress: ShopScrapeProgress) => void;
};

type ProductCardSnapshot = {
  text: string;
  name: string | null;
  href: string | null;
  imageUrl: string | null;
  category: string | null;
  pdfUrls?: string[];
};

type ShopPageSnapshot = {
  pageUrl: string;
  title: string;
  pageText?: string | null;
  jsonLdTexts: string[];
  cards: ProductCardSnapshot[];
  nextLinks: string[];
  pagePdfUrls?: string[];
};

type BrowserWithProcess = Browser & {
  process?: () => { kill: (signal?: string) => boolean };
};

const DEFAULT_MAX_PAGES = 5;
const DEFAULT_MAX_PRODUCTS = 100;
const DEFAULT_CONCURRENT_PAGES = 2;
const DNS_TIMEOUT_MS = 5_000;
const PAGE_GOTO_TIMEOUT_MS = 15_000;
const PAGE_NETWORK_IDLE_TIMEOUT_MS = 2_000;
const SCRAPE_BASE_TIMEOUT_MS = 15_000;
const SCRAPE_PAGE_TIMEOUT_MS = 8_000;
const SCRAPE_MAX_TIMEOUT_PAGES = 100;
const SCRAPE_ALL_TIMEOUT_MS = 20 * 60_000;
const BROWSER_CLOSE_TIMEOUT_MS = 2_000;
const PUBLIC_HOST_CACHE = new Map<string, Promise<void>>();
let SHARED_BROWSER_PROMISE: Promise<Browser> | null = null;

export async function scrapeShopMaterialsFromUrl({
  url,
  maxPages = DEFAULT_MAX_PAGES,
  maxProducts = DEFAULT_MAX_PRODUCTS,
  method = "auto",
  detailEnrichment = "none",
  concurrentPages = DEFAULT_CONCURRENT_PAGES,
  signal,
  onProgress,
}: ShopScrapeOptions): Promise<ShopScrapeResult> {
  const startedAt = Date.now();
  const startUrl = await assertSafeScrapeUrl(url);
  const expectedHostname = startUrl.hostname.toLowerCase();
  const browser = await getSharedBrowser();
  const context = await browser.newContext({
    locale: "vi-VN",
    viewport: { width: 1366, height: 900 },
    userAgent:
      "Mozilla/5.0 (compatible; BidTool/1.0; +https://localhost) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  });

  await context.route("**/*", async (route) => {
    const request = route.request();
    const resourceType = request.resourceType();
    if (["font", "image", "media"].includes(resourceType)) {
      await route.abort();
      return;
    }

    try {
      const requestUrl = new URL(request.url());
      if (!["http:", "https:"].includes(requestUrl.protocol)) {
        await route.abort();
        return;
      }
      if (requestUrl.hostname.toLowerCase() !== expectedHostname) {
        await route.abort();
        return;
      }
      await route.continue();
    } catch {
      await route.abort();
    }
  });

  try {
    return await withTimeout(
      (async () => {
        const queue = [startUrl.href];
        const queuedPages = new Set(queue);
        const seenPages = new Set<string>();
        const currentUrlsByWorker = new Map<number, string>();
        const products = new Map<string, ScrapedShopProduct>();
        const failedPages: ShopScrapeResult["failedPages"] = [];
        const workerCount = Math.max(1, Math.trunc(concurrentPages));
        let activePageCount = 0;
        let stopReason: ShopScrapeStopReason | null = null;
        let waiters: Array<() => void> = [];
        const productList = () => {
          const values = Array.from(products.values());
          return maxProducts == null ? values : values.slice(0, maxProducts);
        };
        const currentUrls = () =>
          Array.from(currentUrlsByWorker.values()).slice(0, workerCount);
        const reportProgress = (
          status: ShopScrapeProgress["status"],
          stopReason?: ShopScrapeStopReason,
        ) => {
          const activeUrls = currentUrls();
          onProgress?.({
            status,
            currentUrl: activeUrls[0] ?? null,
            currentUrls: activeUrls,
            pagesVisited: Array.from(seenPages),
            failedPages: [...failedPages],
            productCount: products.size,
            queueLength: queue.length,
            maxPages,
            maxProducts,
            method,
            elapsedMs: Date.now() - startedAt,
            products: productList(),
            stopReason,
            message: stopReason
              ? shopScrapeStopReasonMessage(stopReason)
              : undefined,
          });
        };
        const notifyWorkers = () => {
          const pending = waiters;
          waiters = [];
          for (const wake of pending) {
            wake();
          }
        };
        const waitForQueueChange = () =>
          new Promise<void>((resolve) => {
            waiters.push(resolve);
          });
        const scrapeTimeout = scrapeTimeoutMs(maxPages);
        const scrapeDeadline = startedAt + scrapeTimeout;
        const assertWithinScrapeDeadline = () => {
          if (Date.now() >= scrapeDeadline) {
            throw new Error(
              `Scrape shop quá thời gian bảo vệ trước khi đọc hết queue. Đã đọc ${seenPages.size.toLocaleString(
                "vi-VN",
              )} trang, còn ${queue.length.toLocaleString("vi-VN")} URL chờ.`,
            );
          }
        };
        const takePageUrl = async (workerIndex: number) => {
          while (true) {
            throwIfAborted(signal);
            assertWithinScrapeDeadline();
            if (stopReason) {
              return null;
            }
            if (maxPages != null && seenPages.size >= maxPages) {
              stopReason = "page_limit";
              notifyWorkers();
              return null;
            }
            if (maxProducts != null && products.size >= maxProducts) {
              stopReason = "product_limit";
              notifyWorkers();
              return null;
            }

            const pageUrl = queue.shift();
            if (pageUrl) {
              if (seenPages.has(pageUrl)) {
                continue;
              }
              seenPages.add(pageUrl);
              activePageCount += 1;
              currentUrlsByWorker.set(workerIndex, pageUrl);
              return pageUrl;
            }

            if (activePageCount === 0) {
              return null;
            }
            await waitForQueueChange();
          }
        };
        const releasePageUrl = (workerIndex: number) => {
          activePageCount = Math.max(0, activePageCount - 1);
          currentUrlsByWorker.delete(workerIndex);
          notifyWorkers();
        };
        const enqueueNextUrls = async (hrefs: string[]) => {
          if (maxProducts != null && products.size >= maxProducts) {
            stopReason = "product_limit";
            return;
          }

          for (const href of hrefs) {
            if (maxPages != null && queue.length + seenPages.size >= maxPages) {
              break;
            }
            try {
              const nextUrl = await assertSafeScrapeUrl(
                href,
                startUrl.hostname,
              );
              if (
                !seenPages.has(nextUrl.href) &&
                !queuedPages.has(nextUrl.href)
              ) {
                queue.push(nextUrl.href);
                queuedPages.add(nextUrl.href);
              }
            } catch {
              // Ignore pagination links that leave the allowed shop scope.
            }
          }
          notifyWorkers();
        };
        const mergeProducts = (pageProducts: ScrapedShopProduct[]) => {
          for (const product of pageProducts) {
            if (maxProducts != null && products.size >= maxProducts) {
              stopReason = "product_limit";
              break;
            }
            const identity = productIdentity(product);
            products.set(
              identity,
              mergeScrapedProductData(products.get(identity), product),
            );
          }
          if (maxProducts != null && products.size >= maxProducts) {
            stopReason = "product_limit";
            notifyWorkers();
          }
        };
        const scrapeWorker = async (workerIndex: number) => {
          const page = await context.newPage();
          try {
            while (true) {
              const pageUrl = await takePageUrl(workerIndex);
              if (!pageUrl) {
                return;
              }

              reportProgress("reading");
              try {
                const snapshot = await scrapePageSnapshot({
                  page,
                  pageUrl,
                  expectedHostname,
                  scrapeDeadline,
                });
                reportProgress("extracting");
                const pageProducts = extractProductsFromPageSnapshot(
                  snapshot,
                  method,
                );
                const enrichedPageProducts =
                  detailEnrichment === "missing_fields"
                    ? await enrichProductsFromDetailPages({
                        page,
                        products: pageProducts,
                        currentPageUrl: pageUrl,
                        expectedHostname,
                        method,
                        scrapeDeadline,
                        signal,
                        reportProgress: (currentUrl) => {
                          currentUrlsByWorker.set(workerIndex, currentUrl);
                          reportProgress("reading");
                        },
                        onFailedPage: (url, message) =>
                          failedPages.push({ url, message }),
                      })
                    : pageProducts;
                currentUrlsByWorker.set(workerIndex, pageUrl);
                mergeProducts(enrichedPageProducts);

                if (!stopReason) {
                  await enqueueNextUrls(snapshot.nextLinks);
                }
              } catch (error) {
                failedPages.push({
                  url: pageUrl,
                  message:
                    error instanceof Error
                      ? error.message
                      : "Không thể đọc trang shop.",
                });
              } finally {
                releasePageUrl(workerIndex);
                reportProgress("reading");
              }
            }
          } finally {
            await page.close().catch(() => undefined);
          }
        };

        throwIfAborted(signal);
        currentUrlsByWorker.set(0, startUrl.href);
        reportProgress("starting");
        currentUrlsByWorker.delete(0);
        await Promise.all(
          Array.from({ length: workerCount }, (_, index) =>
            scrapeWorker(index),
          ),
        );

        throwIfAborted(signal);
        stopReason ??=
          maxPages != null && seenPages.size >= maxPages
            ? "page_limit"
            : maxProducts != null && products.size >= maxProducts
              ? "product_limit"
              : "queue_empty";
        reportProgress("complete", stopReason);
        return {
          products: productList(),
          pagesVisited: Array.from(seenPages),
          failedPages,
          durationMs: Date.now() - startedAt,
          stopReason,
        };
      })(),
      scrapeTimeoutMs(maxPages),
      "Scrape shop quá thời gian bảo vệ trước khi đọc hết queue.",
    );
  } finally {
    await withTimeout(
      context.close().catch(() => undefined),
      BROWSER_CLOSE_TIMEOUT_MS,
      "Đóng browser context quá thời gian.",
    ).catch(() => undefined);
  }
}

async function scrapePageSnapshot({
  page,
  pageUrl,
  expectedHostname,
  scrapeDeadline,
}: {
  page: Page;
  pageUrl: string;
  expectedHostname: string;
  scrapeDeadline: number;
}) {
  await page.goto(pageUrl, {
    waitUntil: "domcontentloaded",
    timeout: Math.max(
      1_000,
      Math.min(PAGE_GOTO_TIMEOUT_MS, scrapeDeadline - Date.now()),
    ),
  });
  await page
    .waitForLoadState("networkidle", {
      timeout: Math.max(
        500,
        Math.min(PAGE_NETWORK_IDLE_TIMEOUT_MS, scrapeDeadline - Date.now()),
      ),
    })
    .catch(() => undefined);
  await page.waitForTimeout(250).catch(() => undefined);

  await assertSafeScrapeUrl(page.url(), expectedHostname);
  return page.evaluate(collectShopPageSnapshot);
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new Error("Đã hủy job scrape shop.");
  }
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

export function extractProductsFromPageSnapshot(
  snapshot: ShopPageSnapshot,
  method: ShopScrapeMethod = "auto",
): ScrapedShopProduct[] {
  const products: ScrapedShopProduct[] = [];

  if (method === "auto" || method === "json_ld") {
    for (const jsonLdText of snapshot.jsonLdTexts) {
      for (const value of parseJsonLdText(jsonLdText)) {
        for (const product of productsFromJsonLd(value, snapshot.pageUrl)) {
          products.push(product);
        }
      }
    }
  }

  if (method === "auto" || method === "dom_cards") {
    for (const card of snapshot.cards) {
      const product = productFromCardSnapshot(card, snapshot.pageUrl);
      if (product) {
        products.push(product);
      }
    }
  }

  const byIdentity = new Map<string, ScrapedShopProduct>();
  for (const product of products) {
    const existing = byIdentity.get(productIdentity(product));
    if (!existing || scoreProduct(product) > scoreProduct(existing)) {
      byIdentity.set(productIdentity(product), product);
    }
  }

  return Array.from(byIdentity.values());
}

type DetailEnrichmentInput = {
  page: Page;
  products: ScrapedShopProduct[];
  currentPageUrl: string;
  expectedHostname: string;
  method: ShopScrapeMethod;
  scrapeDeadline: number;
  signal?: AbortSignal;
  reportProgress: (currentUrl: string) => void;
  onFailedPage: (url: string, message: string) => void;
};

async function enrichProductsFromDetailPages({
  page,
  products,
  currentPageUrl,
  expectedHostname,
  method,
  scrapeDeadline,
  signal,
  reportProgress,
  onFailedPage,
}: DetailEnrichmentInput) {
  const enrichedProducts: ScrapedShopProduct[] = [];

  for (const product of products) {
    throwIfAborted(signal);
    if (!shouldEnrichFromDetailPage(product, currentPageUrl)) {
      enrichedProducts.push(product);
      continue;
    }

    try {
      const detailUrl = await assertSafeScrapeUrl(
        product.sourceUrl,
        expectedHostname,
      );
      reportProgress(detailUrl.href);
      await page.goto(detailUrl.href, {
        waitUntil: "domcontentloaded",
        timeout: Math.max(
          1_000,
          Math.min(PAGE_GOTO_TIMEOUT_MS, scrapeDeadline - Date.now()),
        ),
      });
      await page
        .waitForLoadState("networkidle", {
          timeout: Math.max(
            500,
            Math.min(PAGE_NETWORK_IDLE_TIMEOUT_MS, scrapeDeadline - Date.now()),
          ),
        })
        .catch(() => undefined);
      await page.waitForTimeout(150).catch(() => undefined);
      await assertSafeScrapeUrl(page.url(), expectedHostname);

      const snapshot = await page.evaluate(collectShopPageSnapshot);
      const detailProducts = extractProductsFromPageSnapshot(snapshot, method);
      const detailProduct =
        findBestDetailProduct(product, detailProducts) ??
        enrichProductWithPageText(product, snapshot.pageText ?? "");
      // PDFs anywhere on a product detail page belong to this product.
      const detailWithPdfs: ScrapedShopProduct = {
        ...detailProduct,
        catalogPdfUrls: mergeCatalogPdfUrls(
          detailProduct.catalogPdfUrls,
          snapshot.pagePdfUrls,
        ),
      };
      enrichedProducts.push(mergeScrapedProductData(product, detailWithPdfs));
    } catch (error) {
      onFailedPage(
        product.sourceUrl,
        error instanceof Error
          ? error.message
          : "Không thể đọc trang chi tiết sản phẩm.",
      );
      enrichedProducts.push(product);
    }
  }

  return enrichedProducts;
}

function shouldEnrichFromDetailPage(
  product: ScrapedShopProduct,
  currentPageUrl: string,
) {
  if (!product.sourceUrl || product.sourceUrl === currentPageUrl) {
    return false;
  }
  return Boolean(
    !product.manufacturer ||
    !product.originCountry ||
    !product.category ||
    !product.unit ||
    !product.specText.trim(),
  );
}

function findBestDetailProduct(
  product: ScrapedShopProduct,
  detailProducts: ScrapedShopProduct[],
) {
  if (detailProducts.length === 0) {
    return null;
  }

  return (
    detailProducts.find(
      (item) =>
        normalizeKey(item.sourceUrl) === normalizeKey(product.sourceUrl),
    ) ??
    detailProducts.find(
      (item) => normalizeKey(item.name) === normalizeKey(product.name),
    ) ??
    detailProducts.sort((a, b) => scoreProduct(b) - scoreProduct(a))[0] ??
    null
  );
}

export function mergeScrapedProductData(
  base: ScrapedShopProduct | undefined,
  incoming: ScrapedShopProduct,
): ScrapedShopProduct {
  if (!base) {
    return incoming;
  }

  const betterSpecText =
    incoming.specText.trim().length > base.specText.trim().length
      ? incoming.specText
      : base.specText;

  return {
    ...base,
    unit: base.unit ?? incoming.unit,
    category: base.category ?? incoming.category,
    specText: betterSpecText,
    manufacturer: base.manufacturer ?? incoming.manufacturer,
    originCountry: base.originCountry ?? incoming.originCountry,
    price: base.price ?? incoming.price,
    priceText: base.priceText ?? incoming.priceText,
    currency: base.currency || incoming.currency,
    sourceUrl: base.sourceUrl || incoming.sourceUrl,
    imageUrl: base.imageUrl ?? incoming.imageUrl,
    sku: base.sku ?? incoming.sku,
    model: base.model ?? incoming.model,
    availability: base.availability ?? incoming.availability,
    shopCategory: base.shopCategory ?? incoming.shopCategory,
    catalogPdfUrls: mergeCatalogPdfUrls(
      base.catalogPdfUrls,
      incoming.catalogPdfUrls,
    ),
  };
}

async function getSharedBrowser() {
  SHARED_BROWSER_PROMISE ??= launchBrowser().catch((error) => {
    SHARED_BROWSER_PROMISE = null;
    throw error;
  });

  return SHARED_BROWSER_PROMISE;
}

const SERVERLESS_CHROMIUM_PACK_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v147.0.0/chromium-v147.0.0-pack.x64.tar";

async function launchBrowser(): Promise<Browser> {
  if (isServerlessRuntime()) {
    return launchServerlessBrowser();
  }

  const { chromium } = await import("playwright");
  const executablePath = findSystemBrowserExecutable();
  const launchOptions = {
    headless: true,
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  };

  if (executablePath) {
    try {
      return registerBrowser(
        await chromium.launch({ ...launchOptions, executablePath }),
      );
    } catch {
      // Fall back to Playwright-managed browsers below.
    }
  }

  try {
    return registerBrowser(await chromium.launch(launchOptions));
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
      ? `Không khởi động được browser scrape. Cài Chrome/Chromium hoặc chạy "bunx playwright install chromium". ${error.message}`
      : "Không khởi động được browser scrape.",
  );
}

function registerBrowser(browser: Browser) {
  browser.on("disconnected", () => {
    SHARED_BROWSER_PROMISE = null;
  });
  return browser;
}

function findSystemBrowserExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter((value): value is string => Boolean(value));

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function assertSafeScrapeUrl(input: string, expectedHostname?: string) {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error("URL shop không hợp lệ.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Chỉ hỗ trợ URL http hoặc https.");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (expectedHostname && hostname !== expectedHostname.toLowerCase()) {
    throw new Error("Chỉ theo pagination trong cùng domain shop.");
  }

  const cached = PUBLIC_HOST_CACHE.get(hostname);
  if (cached) {
    await cached;
    return parsed;
  }

  const promise = assertPublicHostname(hostname);
  PUBLIC_HOST_CACHE.set(hostname, promise);
  try {
    await promise;
  } catch (error) {
    PUBLIC_HOST_CACHE.delete(hostname);
    throw error;
  }
  return parsed;
}

async function assertPublicHostname(hostname: string) {
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw new Error("Không hỗ trợ scrape URL nội bộ.");
  }

  const directIpVersion = isIP(hostname);
  if (directIpVersion !== 0) {
    if (isPrivateIp(hostname)) {
      throw new Error("Không hỗ trợ scrape IP nội bộ.");
    }
    return;
  }

  const addresses = await withTimeout(
    lookup(hostname, { all: true, verbatim: true }),
    DNS_TIMEOUT_MS,
    "Không thể xác thực host shop trong thời gian cho phép.",
  );
  if (
    addresses.length === 0 ||
    addresses.some((item) => isPrivateIp(item.address))
  ) {
    throw new Error("Không hỗ trợ scrape host nội bộ.");
  }
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

function scrapeTimeoutMs(maxPages: number | null) {
  if (maxPages == null) {
    return SCRAPE_ALL_TIMEOUT_MS;
  }

  return (
    SCRAPE_BASE_TIMEOUT_MS +
    Math.min(maxPages, SCRAPE_MAX_TIMEOUT_PAGES) * SCRAPE_PAGE_TIMEOUT_MS
  );
}

function shopScrapeStopReasonMessage(stopReason: ShopScrapeStopReason) {
  switch (stopReason) {
    case "queue_empty":
      return "Đã đọc hết pagination/queue trong cùng domain.";
    case "page_limit":
      return "Dừng vì đã đạt giới hạn trang đã chọn.";
    case "product_limit":
      return "Dừng vì đã đạt giới hạn sản phẩm đã chọn.";
  }
}

function isPrivateIp(address: string) {
  if (address.includes(":")) {
    const normalized = address.toLowerCase();
    const mappedIpv4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
    if (mappedIpv4?.[1]) {
      return isPrivateIpv4(mappedIpv4[1]);
    }

    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    );
  }

  return isPrivateIpv4(address);
}

function isPrivateIpv4(address: string) {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }
  const [a = 0, b = 0, c = 0] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function collectShopPageSnapshot(): ShopPageSnapshot {
  const abs = (value: string | null | undefined) => {
    if (!value) return null;
    try {
      return new URL(value, window.location.href).href;
    } catch {
      return null;
    }
  };
  const text = (element: Element | null | undefined) =>
    element?.textContent?.replace(/\s+/g, " ").trim() ?? null;
  const pricePattern =
    /(?:\d{1,3}(?:[.,]\d{3})+|\d{4,})(?:\s*(?:vnd|vnđ|₫|đ|dong|đồng))?/i;
  const isPdfHref = (href: string | null) => {
    if (!href) return false;
    try {
      return /\.pdf$/i.test(new URL(href).pathname);
    } catch {
      return false;
    }
  };
  // Promo stickers (e.g. WooCommerce "sale"/"trending" labels) often sit
  // before the real product title and must never be used as name/link.
  const badgeClassPattern =
    /(label|badge|ribbon|sticker|onsale|sale[-_]?flash|countdown)/i;
  const isPromoBadgeElement = (element: Element | null | undefined) => {
    let current: Element | null = element ?? null;
    for (let depth = 0; current && depth < 6; depth += 1) {
      const className =
        typeof current.className === "string" ? current.className : "";
      if (badgeClassPattern.test(className)) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  };
  const titleSelectors = [
    "[class*='product-title' i], [class*='product_title' i], [class*='product-name' i], [class*='product_name' i], .woocommerce-loop-product__title",
    "h1, h2, h3, h4",
    "[class*='name' i], [class*='title' i]",
  ];
  const findTitleElement = (root: Element) => {
    for (const selector of titleSelectors) {
      const candidate = Array.from(root.querySelectorAll(selector)).find(
        (element) => !isPromoBadgeElement(element) && text(element),
      );
      if (candidate) {
        return candidate;
      }
    }
    return null;
  };
  const collectPdfUrls = (root: ParentNode, limit: number) => {
    const urls: string[] = [];
    const seen = new Set<string>();
    for (const anchor of Array.from(
      root.querySelectorAll<HTMLAnchorElement>("a[href]"),
    )) {
      const href = abs(anchor.getAttribute("href"));
      if (!href || !isPdfHref(href) || seen.has(href)) continue;
      seen.add(href);
      urls.push(href);
      if (urls.length >= limit) break;
    }
    return urls;
  };
  const likelyNodeSet = new Set<Element>();
  const productAnchors = Array.from(
    document.querySelectorAll<HTMLAnchorElement>("a[href]"),
  ).filter((anchor) => {
    const value = text(anchor) ?? anchor.getAttribute("title")?.trim();
    const href = anchor.getAttribute("href") ?? "";
    if (!value || value.length < 6 || value.length > 260) return false;
    if (/^(xem thêm|chi tiết|mua ngay|add to cart|giỏ hàng)$/i.test(value)) {
      return false;
    }
    return !/^(#|javascript:|mailto:|tel:)/i.test(href);
  });

  for (const anchor of productAnchors) {
    let node: Element | null = anchor;
    for (let depth = 0; node && depth < 7; depth += 1) {
      const value = text(node);
      if (
        value &&
        value.length >= 12 &&
        value.length <= 1400 &&
        pricePattern.test(value) &&
        node.querySelectorAll("a[href]").length <= 8
      ) {
        likelyNodeSet.add(node);
        break;
      }
      node = node.parentElement;
    }
  }

  const fallbackNodes = Array.from(
    document.querySelectorAll("article, li, [class*='product' i]"),
  ).filter((node) => {
    const value = text(node);
    return Boolean(
      value &&
      value.length >= 12 &&
      value.length <= 1400 &&
      pricePattern.test(value) &&
      node.querySelector("a[href]"),
    );
  });

  fallbackNodes.slice(0, 120).forEach((node) => likelyNodeSet.add(node));
  const likelyNodes = Array.from(likelyNodeSet).slice(0, 160);

  const cards = likelyNodes.map((node) => {
    const anchors = Array.from(
      node.querySelectorAll<HTMLAnchorElement>("a[href]"),
    );
    // The card node itself can be the product link (querySelectorAll only
    // matches descendants), so include it or the product URL is lost.
    if (node.matches("a[href]")) {
      anchors.unshift(node as HTMLAnchorElement);
    }
    const anchor =
      anchors.find(
        (item) =>
          !isPromoBadgeElement(item) && item.getAttribute("title")?.trim(),
      ) ??
      anchors.find(
        (item) =>
          !isPromoBadgeElement(item) &&
          text(item) &&
          (text(item)?.length ?? 0) > 5,
      ) ??
      anchors[0];
    const cardRoot =
      node.closest("article, li, [class*='product' i]") ??
      node.parentElement ??
      node;
    const image =
      node.querySelector<HTMLImageElement>("img[src], img[data-src]") ??
      cardRoot.querySelector<HTMLImageElement>("img[src], img[data-src]");
    const titleElement = findTitleElement(node);
    const categoryElement = node.querySelector(
      "[class*='category'], [class*='breadcrumb']",
    );
    const anchorTitle = anchor?.getAttribute("title")?.trim();
    const anchorText = text(anchor);
    const imageSrc =
      image?.getAttribute("src") ?? image?.getAttribute("data-src");

    return {
      text: text(node) ?? "",
      name:
        anchorTitle && anchorTitle.length > 0
          ? anchorTitle
          : (text(titleElement) ?? anchorText),
      href: abs(anchor?.getAttribute("href")),
      imageUrl: abs(imageSrc),
      category: text(categoryElement),
      pdfUrls: collectPdfUrls(cardRoot, 5),
    };
  });

  const paginationAnchors = new Set<HTMLAnchorElement>();
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>(
    "a[rel='next'], a[aria-label*='next' i], a[aria-label*='sau' i], a[aria-label*='tiếp' i], a[href]",
  )) {
    const label = `${anchor.textContent ?? ""} ${anchor.getAttribute("aria-label") ?? ""} ${anchor.getAttribute("rel") ?? ""}`;
    if (/\b(next|sau|tiếp|trang sau)\b|[›»>]/i.test(label)) {
      paginationAnchors.add(anchor);
    }
  }
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>(
    "nav[class*='pagination' i] a[href], [class*='pagination' i] a[href], a.page-numbers[href], a[href*='paged='], a[href*='/page/']",
  )) {
    paginationAnchors.add(anchor);
  }
  const nextLinks = Array.from(paginationAnchors)
    .map((anchor) => abs(anchor.getAttribute("href")))
    .filter((href): href is string => Boolean(href));

  return {
    pageUrl: window.location.href,
    title: document.title,
    pageText: document.body?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    jsonLdTexts: Array.from(
      document.querySelectorAll<HTMLScriptElement>(
        "script[type='application/ld+json']",
      ),
    )
      .map((script) => script.textContent?.trim() ?? "")
      .filter(Boolean),
    cards,
    nextLinks,
    pagePdfUrls: collectPdfUrls(document, 20),
  };
}

function parseJsonLdText(text: string): unknown[] {
  try {
    const value = JSON.parse(text) as unknown;
    return Array.isArray(value) ? value : [value];
  } catch {
    return [];
  }
}

function productsFromJsonLd(
  value: unknown,
  pageUrl: string,
): ScrapedShopProduct[] {
  const results: ScrapedShopProduct[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!isRecord(node)) {
      return;
    }

    const graph = node["@graph"];
    if (Array.isArray(graph)) {
      graph.forEach(visit);
    }

    const itemListElement = node.itemListElement;
    if (Array.isArray(itemListElement)) {
      itemListElement.forEach((item) => {
        if (isRecord(item) && "item" in item) {
          visit(item.item);
        } else {
          visit(item);
        }
      });
    }

    if (!jsonLdTypeIncludes(node, "Product")) {
      return;
    }

    const name = cleanName(stringValue(node.name));
    if (!name) {
      return;
    }
    const offers = firstRecord(node.offers);
    const brand = firstRecord(node.brand);
    const manufacturer = firstRecord(node.manufacturer);
    const rawPrice =
      stringValue(offers?.price) ??
      stringValue(firstRecord(offers?.priceSpecification)?.price);
    const priceResult = rawPrice
      ? extractPriceFromText(
          `${rawPrice} ${stringValue(offers?.priceCurrency) ?? ""}`,
        )
      : extractPriceFromText(JSON.stringify(node).slice(0, 20_000));
    const sourceUrl =
      absoluteUrl(stringValue(node.url) ?? stringValue(offers?.url), pageUrl) ??
      pageUrl;

    results.push({
      name,
      unit: detectUnit(`${name} ${stringValue(node.description) ?? ""}`),
      category: stringValue(node.category),
      specText: stringValue(node.description) ?? "",
      manufacturer:
        stringValue(manufacturer?.name) ??
        stringValue(brand?.name) ??
        stringValue(node.brand),
      originCountry: stringValue(node.countryOfOrigin),
      price: priceResult.price,
      priceText: priceResult.priceText ?? rawPrice,
      currency:
        stringValue(offers?.priceCurrency) ??
        detectCurrency(priceResult.priceText) ??
        "VND",
      sourceUrl,
      imageUrl: absoluteUrl(firstString(node.image), pageUrl),
      sku: stringValue(node.sku),
      model: stringValue(node.model) ?? stringValue(node.mpn),
      availability: stringValue(offers?.availability),
      shopCategory: stringValue(node.category),
      catalogPdfUrls: [],
    });
  };

  visit(value);
  return results;
}

function productFromCardSnapshot(
  card: ProductCardSnapshot,
  pageUrl: string,
): ScrapedShopProduct | null {
  const name = cleanName(card.name);
  if (!name) {
    return null;
  }
  const priceResult = extractPriceFromText(card.text);
  if (!priceResult.price && !priceResult.priceText) {
    return null;
  }
  const labels = extractProductLabels(card.text);

  return {
    name,
    unit: detectUnit(`${name} ${card.text}`),
    category: card.category ?? labels.category,
    specText: cleanDescription(card.text, name),
    manufacturer: labels.manufacturer,
    originCountry: labels.originCountry,
    price: priceResult.price,
    priceText: priceResult.priceText,
    currency: detectCurrency(priceResult.priceText) ?? "VND",
    sourceUrl: card.href ?? pageUrl,
    imageUrl: card.imageUrl,
    sku: labels.sku ?? detectSku(card.text),
    model: labels.model,
    availability: labels.availability ?? detectAvailability(card.text),
    shopCategory: card.category ?? labels.category,
    catalogPdfUrls: mergeCatalogPdfUrls(card.pdfUrls),
  };
}

function productIdentity(product: ScrapedShopProduct) {
  return (
    product.sourceUrl || `${normalizeKey(product.name)}|${product.unit ?? ""}`
  );
}

function scoreProduct(product: ScrapedShopProduct) {
  return [
    product.name,
    product.price,
    product.specText,
    product.manufacturer,
    product.originCountry,
    product.category,
    product.unit,
    product.imageUrl,
    product.sku,
    product.model,
    product.availability,
  ].filter(Boolean).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    return value.find(isRecord) ?? null;
  }
  return isRecord(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function firstString(value: unknown): string | null {
  if (Array.isArray(value)) {
    return value.map(stringValue).find(Boolean) ?? null;
  }
  return stringValue(value);
}

function jsonLdTypeIncludes(record: Record<string, unknown>, typeName: string) {
  const type = record["@type"];
  if (typeof type === "string") {
    return type.toLowerCase() === typeName.toLowerCase();
  }
  return (
    Array.isArray(type) &&
    type.some(
      (item) =>
        typeof item === "string" &&
        item.toLowerCase() === typeName.toLowerCase(),
    )
  );
}

function absoluteUrl(value: string | null | undefined, baseUrl: string) {
  if (!value) {
    return null;
  }
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return null;
  }
}

function cleanName(value: string | null | undefined) {
  const cleaned = value
    ?.replace(/\s+/g, " ")
    .replace(/\b(add to cart|mua ngay|chi tiết|xem thêm)\b/gi, " ")
    .trim();
  if (!cleaned || cleaned.length < 2) {
    return null;
  }
  return cleaned.slice(0, 220);
}

function cleanDescription(text: string, name: string) {
  return text.replace(name, " ").replace(/\s+/g, " ").trim().slice(0, 1000);
}

const labeledValueDefinitions = {
  manufacturer: [
    "ncc",
    "nhà cung cấp",
    "nha cung cap",
    "nhà sản xuất",
    "nha san xuat",
    "hãng",
    "hang",
    "thương hiệu",
    "thuong hieu",
    "brand",
    "manufacturer",
  ],
  originCountry: [
    "xuất xứ",
    "xuat xu",
    "nước sản xuất",
    "nuoc san xuat",
    "origin",
    "country of origin",
  ],
  category: ["nhóm", "nhom", "danh mục", "danh muc", "category"],
  sku: [
    "sku",
    "mã sp",
    "ma sp",
    "mã sản phẩm",
    "ma san pham",
    "mã hàng",
    "ma hang",
  ],
  model: ["model", "mã model", "ma model", "mpn"],
  availability: ["tình trạng", "tinh trang", "trạng thái", "trang thai"],
  specText: [
    "thông số kỹ thuật",
    "thong so ky thuat",
    "thông số",
    "thong so",
    "specs",
  ],
} as const;

const allLabeledValueNames = Object.values(labeledValueDefinitions)
  .flat()
  .map(escapeRegExp)
  .join("|");

function extractProductLabels(text: string) {
  return {
    manufacturer: extractLabeledValue(
      text,
      labeledValueDefinitions.manufacturer,
    ),
    originCountry: extractLabeledValue(
      text,
      labeledValueDefinitions.originCountry,
    ),
    category: extractLabeledValue(text, labeledValueDefinitions.category),
    sku: extractLabeledValue(text, labeledValueDefinitions.sku),
    model: extractLabeledValue(text, labeledValueDefinitions.model),
    availability:
      extractLabeledValue(text, labeledValueDefinitions.availability) ??
      detectAvailability(text),
  };
}

function extractLabeledValue(
  text: string,
  labels: readonly string[],
): string | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  const labelPattern = labels.map(escapeRegExp).join("|");
  const matcher = new RegExp(
    `(?:^|[\\s|•;,])(?:${labelPattern})\\s*[:：\\-]?\\s*(.{1,120}?)(?=\\s+(?:${allLabeledValueNames}|giá|price|bảo hành|bao hanh)\\s*[:：\\-]|[|•;,]|$)`,
    "i",
  );
  const match = matcher.exec(normalized);
  return cleanLabeledValue(match?.[1]);
}

function cleanLabeledValue(value: string | undefined) {
  const cleaned = value
    ?.replace(/\b(còn hàng|hết hàng|in stock|out of stock)\b.*$/i, "")
    .replace(
      /\b(thông số kỹ thuật|thong so ky thuat|thông số|thong so|specs)\b.*$/i,
      "",
    )
    .replace(/\b\d{1,3}(?:[.,]\d{3})+\s*(?:vnd|vnđ|₫|đ|dong|đồng)?\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned.length < 2) {
    return null;
  }
  return cleaned.slice(0, 160);
}

export function enrichProductWithPageText(
  product: ScrapedShopProduct,
  pageText: string,
): ScrapedShopProduct {
  const labels = extractProductLabels(pageText);
  return {
    ...product,
    unit: product.unit ?? detectUnit(`${product.name} ${pageText}`),
    category: product.category ?? labels.category,
    specText:
      product.specText.trim().length > 0
        ? product.specText
        : cleanDescription(pageText, product.name),
    manufacturer: product.manufacturer ?? labels.manufacturer,
    originCountry: product.originCountry ?? labels.originCountry,
    sku: product.sku ?? labels.sku,
    model: product.model ?? labels.model,
    availability: product.availability ?? labels.availability,
    shopCategory: product.shopCategory ?? labels.category,
  };
}

function detectUnit(text: string) {
  const priceUnitMatch =
    /(?:₫|đ|vnd|vnđ|dong|đồng)\s*\/\s*(cái|chiếc|bộ|kg|g|m2|m²|m3|m³|lít|lit|hộp|cuộn|tấm|thùng|chai|bao|máy|con|pcs|set|module|mô đun|thanh|cây|sợi|ống|đôi|cặp)/i.exec(
      text,
    );
  if (priceUnitMatch?.[1]) {
    return priceUnitMatch[1].toLowerCase();
  }

  const match =
    /\b(cái|chiếc|bộ|kg|g|m2|m²|m3|m³|lít|lit|hộp|cuộn|tấm|thùng|chai|bao|máy|con|pcs|set|module|mô đun|thanh|cây|sợi|ống|đôi|cặp)\b/i.exec(
      text,
    );
  return match?.[1]?.toLowerCase() ?? null;
}

function detectCurrency(priceText: string | null | undefined) {
  if (!priceText) {
    return null;
  }
  if (/usd|\$/i.test(priceText)) return "USD";
  if (/eur|€/i.test(priceText)) return "EUR";
  return "VND";
}

function detectSku(text: string) {
  const match =
    /\b(?:sku|mã(?:\s+sp)?|model)\s*[:#-]?\s*([A-Z0-9._/-]{3,})/i.exec(text);
  return match?.[1]?.trim() ?? null;
}

function detectAvailability(text: string) {
  if (/còn hàng|in stock|available/i.test(text)) return "in_stock";
  if (/hết hàng|out of stock|unavailable/i.test(text)) return "out_of_stock";
  return null;
}

function normalizeKey(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
