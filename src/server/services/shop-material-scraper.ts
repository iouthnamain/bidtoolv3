import { lookup } from "node:dns/promises";
import { existsSync } from "node:fs";
import { isIP } from "node:net";

import type { Browser, Page } from "playwright";

import { extractPriceFromText } from "~/lib/material-price-sources";
import { mergeCatalogPdfUrls } from "~/lib/materials/catalog-pdf";
import {
  chooseScrapedProductName,
  resolveProductNameFromCandidates,
  sanitizeScrapedProductList,
  sanitizeScrapedProductName,
  SHOP_PROMO_BADGE_LABELS,
  stripKhauHaoFromSpecText,
} from "~/lib/materials/shop-promo-badges";
import { isServerlessRuntime } from "~/server/runtime";
import { scrapeTimeoutMs } from "~/server/services/shop-scrape-limits";

export { scrapeTimeoutMs } from "~/server/services/shop-scrape-limits";

export {
  isShopPromoBadgeText,
  SHOP_PROMO_BADGE_LABELS,
  stripShopPromoBadgePrefix,
} from "~/lib/materials/shop-promo-badges";

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
  extractSource?: ProductExtractSource;
  nameSource?: ProductNameSource;
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

type ProductExtractSource =
  | "json_ld"
  | "woocommerce"
  | "generic_anchor"
  | "generic_node"
  | "snapshot";

type ProductNameSource =
  | "json_ld"
  | "title"
  | "anchor_title"
  | "anchor_text"
  | "card_text"
  | "snapshot_name";

export type ShopProductExtractionDiagnostic = {
  name: string | null;
  href: string | null;
  text: string;
  extractSource: ProductExtractSource;
  dropReason: string | null;
  score: number;
};

type ExtractedProductCandidate = {
  product: ScrapedShopProduct;
  extractSource: ProductExtractSource;
  nameSource: ProductNameSource;
  score: number;
};

const DEFAULT_MAX_PAGES = 5;
const DEFAULT_MAX_PRODUCTS = 100;
const DEFAULT_CONCURRENT_PAGES = 2;
const DNS_TIMEOUT_MS = 5_000;
const PAGE_GOTO_TIMEOUT_MS = 15_000;
const PAGE_NETWORK_IDLE_TIMEOUT_MS = 2_000;
const BROWSER_CLOSE_TIMEOUT_MS = 2_000;
const PUBLIC_HOST_CACHE = new Map<string, Promise<void>>();
let SHARED_BROWSER_PROMISE: Promise<Browser> | null = null;

type ShopScrapePageConfig = {
  promoBadgeLabels: readonly string[];
};

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
        const completedPages = new Set<string>();
        const inProgressPages = new Set<string>();
        const currentUrlsByWorker = new Map<number, string>();
        const products = new Map<string, ScrapedShopProduct>();
        const failedPages: ShopScrapeResult["failedPages"] = [];
        const workerCount = Math.max(1, Math.trunc(concurrentPages));
        let activePageCount = 0;
        let stopReason: ShopScrapeStopReason | null = null;
        let waiters: Array<() => void> = [];
        const productList = () => {
          const values = Array.from(products.values());
          const capped =
            maxProducts == null ? values : values.slice(0, maxProducts);
          return sanitizeScrapedProductList(capped);
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
            pagesVisited: Array.from(completedPages),
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
              `Scrape shop quá thời gian bảo vệ trước khi đọc hết queue. Đã đọc ${completedPages.size.toLocaleString(
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
            if (maxPages != null && completedPages.size >= maxPages) {
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
              if (
                completedPages.has(pageUrl) ||
                inProgressPages.has(pageUrl)
              ) {
                continue;
              }
              inProgressPages.add(pageUrl);
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
          if (maxPages === 1) {
            return;
          }
          if (maxProducts != null && products.size >= maxProducts) {
            stopReason = "product_limit";
            return;
          }

          for (const href of hrefs) {
            if (
              maxPages != null &&
              queue.length + completedPages.size + inProgressPages.size >=
                maxPages
            ) {
              break;
            }
            try {
              const nextUrl = await assertSafeScrapeUrl(
                href,
                startUrl.hostname,
              );
              if (
                !completedPages.has(nextUrl.href) &&
                !inProgressPages.has(nextUrl.href) &&
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
                inProgressPages.delete(pageUrl);
                completedPages.add(pageUrl);

                if (!stopReason) {
                  await enqueueNextUrls(snapshot.nextLinks);
                }
              } catch (error) {
                inProgressPages.delete(pageUrl);
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
          maxPages != null && completedPages.size >= maxPages
            ? "page_limit"
            : maxProducts != null && products.size >= maxProducts
              ? "product_limit"
              : "queue_empty";
        reportProgress("complete", stopReason);
        return {
          products: productList(),
          pagesVisited: Array.from(completedPages),
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
  await page
    .waitForSelector(
      ".woocommerce-loop-product__title, .catepage .motsanpham, ul.products li.product, li.product.type-product, article, [class*='product' i], a[href*='/product/'], a[href*='/san-pham/'], a[href*='/p/'], a[href*='/item/']",
      {
        timeout: Math.max(500, Math.min(5_000, scrapeDeadline - Date.now())),
      },
    )
    .catch(() => undefined);
  await page
    .waitForFunction(
      () => {
        const productPathPattern = /\/(?:product|san-pham|p|item)\//i;
        const isExcluded = (node: Element) =>
          node.classList.contains("product_list_widget") ||
          Boolean(
            node.closest(
              "aside, .sidebar, #secondary, .widget-area, [class*='widget-area' i], [class*='sidebar' i], header, footer, nav, [class*='related' i], [id*='related' i], [class*='upsell' i], [class*='cross-sell' i]",
            ),
          );
        const text = (node: Element | null | undefined) =>
          node?.textContent?.replace(/\s+/g, " ").trim() ?? "";
        const cards = Array.from(
          document.querySelectorAll(
            ".catepage .motsanpham, ul.products li.product, li.product.type-product",
          ),
        ).filter((node) => !isExcluded(node));
        const productAnchors = Array.from(
          document.querySelectorAll<HTMLAnchorElement>("a[href]"),
        ).filter(
          (anchor) =>
            !isExcluded(anchor) &&
            productPathPattern.test(anchor.getAttribute("href") ?? "") &&
            text(anchor).length >= 4,
        );
        const candidates = cards.length > 0 ? cards : productAnchors;
        if (candidates.length === 0) {
          return false;
        }
        const readyCards = candidates.filter((card) => {
          const titleText = card
            .querySelector(".woocommerce-loop-product__title, h2, h3")
            ?.textContent?.replace(/\s+/g, " ")
            .trim();
          const title =
            titleText && titleText.length > 0 ? titleText : text(card);
          return Boolean(title && title.length > 3);
        });
        return (
          readyCards.length >= Math.max(1, Math.ceil(candidates.length * 0.8))
        );
      },
      undefined,
      {
        timeout: Math.max(500, Math.min(8_000, scrapeDeadline - Date.now())),
      },
    )
    .catch(() => undefined);
  await autoScrollPageForLazyProducts(page, scrapeDeadline);

  await assertSafeScrapeUrl(page.url(), expectedHostname);
  return page.evaluate(collectShopPageSnapshot, {
    promoBadgeLabels: [...SHOP_PROMO_BADGE_LABELS],
  });
}

async function autoScrollPageForLazyProducts(
  page: Page,
  scrapeDeadline: number,
) {
  const timeoutMs = Math.max(250, Math.min(1_000, scrapeDeadline - Date.now()));
  if (timeoutMs <= 250) {
    return;
  }
  await page
    .evaluate(
      async (delay) => {
        const startY = window.scrollY;
        window.scrollTo(0, Math.max(document.body.scrollHeight, 0));
        await new Promise((resolve) => window.setTimeout(resolve, delay));
        window.scrollTo(0, startY);
      },
      Math.min(500, timeoutMs),
    )
    .catch(() => undefined);
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
  return extractProductsWithDiagnosticsFromPageSnapshot(snapshot, method)
    .products;
}

export function extractProductsWithDiagnosticsFromPageSnapshot(
  snapshot: ShopPageSnapshot,
  method: ShopScrapeMethod = "auto",
): {
  products: ScrapedShopProduct[];
  diagnostics: ShopProductExtractionDiagnostic[];
} {
  const candidates: ExtractedProductCandidate[] = [];
  const diagnostics: ShopProductExtractionDiagnostic[] = [];

  if (method === "auto" || method === "json_ld") {
    for (const jsonLdText of snapshot.jsonLdTexts) {
      for (const value of parseJsonLdText(jsonLdText)) {
        for (const product of productsFromJsonLd(value, snapshot.pageUrl)) {
          const candidate = candidateFromProduct(
            product,
            "json_ld",
            "json_ld",
            snapshot.pageUrl,
          );
          if (candidate) {
            candidates.push(candidate);
          }
        }
      }
    }
  }

  if (method === "auto" || method === "dom_cards") {
    for (const card of snapshot.cards) {
      const result = productCandidateFromCardSnapshot(card, snapshot.pageUrl);
      diagnostics.push(result.diagnostic);
      if (result.candidate) {
        candidates.push(result.candidate);
      }
    }
  }

  const products = sanitizeScrapedProductList(
    mergeProductCandidates(candidates, snapshot.pageUrl).map(
      (candidate) => candidate.product,
    ),
    snapshot.pageUrl,
  );
  return { products, diagnostics };
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

      const snapshot = await page.evaluate(collectShopPageSnapshot, {
        promoBadgeLabels: [...SHOP_PROMO_BADGE_LABELS],
      });
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

  const mergedName = chooseScrapedProductName(base.name, incoming.name);
  const priceSource = chooseScrapedProductPrice(base, incoming);

  return {
    ...base,
    name: mergedName,
    unit: base.unit ?? incoming.unit,
    category: base.category ?? incoming.category,
    specText: betterSpecText,
    manufacturer: base.manufacturer ?? incoming.manufacturer,
    originCountry: base.originCountry ?? incoming.originCountry,
    price: priceSource.price,
    priceText: priceSource.priceText,
    currency: priceSource.currency,
    sourceUrl: chooseProductSourceUrl(base.sourceUrl, incoming.sourceUrl),
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

export function collectShopPageSnapshot(
  config: ShopScrapePageConfig = { promoBadgeLabels: [] },
): ShopPageSnapshot {
  const promoBadgeLabels = config.promoBadgeLabels ?? [];
  const sortedPromoLabels = [...promoBadgeLabels].sort(
    (a, b) => b.length - a.length,
  );
  const normalizedPromoLabels = new Set(
    promoBadgeLabels.map((label) =>
      label
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim(),
    ),
  );
  const isPromoBadgeText = (value: string | null | undefined) => {
    const trimmed = value?.replace(/\s+/g, " ").trim();
    if (!trimmed) {
      return false;
    }
    const normalized = trimmed
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    return normalizedPromoLabels.has(normalized);
  };
  const stripPromoBadgePrefix = (value: string) => {
    let result = value.replace(/\s+/g, " ").trim();
    let changed = true;
    while (changed) {
      changed = false;
      for (const label of sortedPromoLabels) {
        const pattern = new RegExp(
          `^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`,
          "i",
        );
        if (pattern.test(result)) {
          result = result.replace(pattern, "").trim();
          changed = true;
          break;
        }
      }
    }
    return result;
  };

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
    /(label|badge|ribbon|sticker|onsale|sale[-_]?flash|countdown|\bawl\b|advanced-woo)/i;
  const isPromoBadgeElement = (element: Element | null | undefined) => {
    const directText = text(element);
    if (directText && isPromoBadgeText(directText)) {
      return true;
    }
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
    "h2, h3",
  ];
  const findTitleElement = (root: Element) => {
    for (const selector of titleSelectors) {
      const candidate = Array.from(root.querySelectorAll(selector)).find(
        (element) => {
          const value = text(element);
          return (
            !isPromoBadgeElement(element) &&
            Boolean(value) &&
            !isPromoBadgeText(value)
          );
        },
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
  const isWidgetProductNode = (node: Element) =>
    node.classList.contains("product_list_widget") ||
    Boolean(
      node.closest(
        "aside, .sidebar, #secondary, .widget-area, [class*='widget-area' i], [class*='sidebar' i], header, footer, nav, [class*='related' i], [id*='related' i], [class*='upsell' i], [class*='cross-sell' i]",
      ),
    );
  const stripTrailingPrice = (value: string) =>
    value
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\s*giá\s*:\s*/gi, " ")
      .replace(
        /\s+(?:\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?)(?:\s*(?:vnd|vnđ|₫|đ|dong|đồng))?.*$|\s+\d{4,}\s*(?:vnd|vnđ|₫|đ|dong|đồng)\b.*$/i,
        "",
      )
      .replace(/\b(còn hàng|hết hàng|in stock|out of stock)\b.*$/i, "")
      .trim();
  const stripStockCountPrefix = (value: string) =>
    value
      .replace(
        /^(?:còn|con|hàng còn|hang con)\s*\d+\s*(?:cái|chiếc|con|bộ|máy|pcs|set)?\s*/i,
        "",
      )
      .trim();
  const stripWarrantyPrefix = (value: string) =>
    value
      .replace(
        /^(?:bh|bảo hành|bao hanh)\s*\d+\s*(?:tháng|thang|năm|nam)\s*/i,
        "",
      )
      .trim();
  const sanitizeNameCandidate = (candidate: string | null | undefined) => {
    if (!candidate?.trim()) {
      return null;
    }
    const values = [candidate.replace(/\s+/g, " ").trim()];
    for (const line of candidate.split(/\r?\n+/)) {
      values.push(line.trim());
    }
    for (const value of values) {
      const stripped = stripTrailingPrice(
        stripStockCountPrefix(
          stripWarrantyPrefix(stripPromoBadgePrefix(value)),
        ),
      );
      if (stripped && !isPromoBadgeText(stripped)) {
        return stripped;
      }
    }
    return null;
  };
  const resolveCardName = (
    candidates: Array<{
      value: string | null | undefined;
      source: ProductNameSource;
    }>,
    cardText: string,
  ) => {
    const scored = candidates
      .map((candidate) => {
        const name = sanitizeNameCandidate(candidate.value);
        if (!name) {
          return null;
        }
        const sourceScore =
          candidate.source === "title"
            ? 40
            : candidate.source === "anchor_title"
              ? 30
              : candidate.source === "anchor_text"
                ? 20
                : 10;
        return { name, score: sourceScore * 1000 + name.length };
      })
      .filter((entry): entry is { name: string; score: number } =>
        Boolean(entry),
      )
      .sort((a, b) => b.score - a.score);
    if (scored[0]) {
      const best = scored[0];
      const source =
        candidates.find(
          (candidate) => sanitizeNameCandidate(candidate.value) === best.name,
        )?.source ?? "card_text";
      return { name: best.name, source };
    }
    const fallback = sanitizeNameCandidate(
      stripTrailingPrice(cardText.replace(/\s+/g, " ").trim()),
    );
    return {
      name: fallback,
      source: "card_text" as ProductNameSource,
    };
  };
  const cardNameScore = (card: {
    name: string | null;
    extractSource?: ProductExtractSource;
    nameSource?: ProductNameSource;
  }) => {
    const rawName = card.name?.replace(/\s+/g, " ").trim() ?? "";
    if (!rawName || isPromoBadgeText(rawName)) {
      return 0;
    }
    const stripped = stripPromoBadgePrefix(rawName);
    if (!stripped || isPromoBadgeText(stripped)) {
      return 0;
    }
    const sourceScore =
      card.extractSource === "woocommerce"
        ? 50
        : card.extractSource === "generic_anchor"
          ? 25
          : 10;
    const nameScore =
      card.nameSource === "title"
        ? 35
        : card.nameSource === "anchor_title"
          ? 25
          : card.nameSource === "anchor_text"
            ? 15
            : 5;
    return sourceScore + nameScore + stripped.length;
  };
  const cardHasPrice = (card: { text: string }, root: Element) => {
    if (pricePattern.test(card.text)) {
      return true;
    }
    const priceElement = root.querySelector(
      ".price, .woocommerce-Price-amount, [class*='price' i]",
    );
    const priceValue = text(priceElement);
    return Boolean(priceValue && pricePattern.test(priceValue));
  };
  const buildCardFromNode = (
    node: Element,
    extractSource: ProductExtractSource,
  ) => {
    const anchors = Array.from(
      node.querySelectorAll<HTMLAnchorElement>("a[href]"),
    );
    if (node.matches("a[href]")) {
      anchors.unshift(node as HTMLAnchorElement);
    }
    const anchor =
      anchors.find(
        (item) =>
          /\/product\/|\/san-pham\/|\/p\/|\/item\//i.test(
            item.getAttribute("href") ?? "",
          ) && !isPromoBadgeElement(item),
      ) ??
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
    const titleElement =
      node.querySelector(".woocommerce-loop-product__title") ??
      findTitleElement(node);
    const image =
      node.querySelector<HTMLImageElement>("img[src], img[data-src]") ??
      cardRoot.querySelector<HTMLImageElement>("img[src], img[data-src]");
    const categoryElement = node.querySelector(
      "[class*='category'], [class*='breadcrumb']",
    );
    const priceElement = node.querySelector(
      ".price, .woocommerce-Price-amount, [class*='price' i]",
    );
    const anchorTitle = anchor?.getAttribute("title")?.trim();
    const titleText = text(titleElement);
    const anchorText = text(anchor);
    const nodeText = text(node) ?? "";
    const priceText = text(priceElement);
    const cardText =
      priceText && !pricePattern.test(nodeText)
        ? `${nodeText} ${priceText}`.trim()
        : nodeText;
    const imageSrc =
      image?.getAttribute("src") ?? image?.getAttribute("data-src");
    const resolvedName = resolveCardName(
      [
        { value: titleText, source: "title" },
        { value: anchorTitle, source: "anchor_title" },
        { value: anchorText, source: "anchor_text" },
      ],
      cardText,
    );

    return {
      text: cardText,
      name: resolvedName.name,
      nameSource: resolvedName.source,
      href: abs(anchor?.getAttribute("href")),
      imageUrl: abs(imageSrc),
      category: text(categoryElement),
      pdfUrls: collectPdfUrls(cardRoot, 5),
      extractSource,
    };
  };
  const wooNodes = Array.from(
    document.querySelectorAll(
      ".catepage .motsanpham, ul.products li.product, li.product.type-product",
    ),
  ).filter((node) => !isWidgetProductNode(node));
  const cardsByHref = new Map<
    string,
    {
      text: string;
      name: string | null;
      href: string | null;
      imageUrl: string | null;
      category: string | null;
      pdfUrls: string[];
      extractSource: ProductExtractSource;
      nameSource: ProductNameSource;
    }
  >();
  for (const node of wooNodes) {
    const card = buildCardFromNode(node, "woocommerce");
    if (!card.href || !card.name) {
      continue;
    }
    const existing = cardsByHref.get(card.href);
    if (!existing || cardNameScore(card) > cardNameScore(existing)) {
      cardsByHref.set(card.href, card);
    }
  }
  const productPathPattern = /\/(?:product|products|san-pham|p|item)\//i;
  const likelyNodeSources = new Map<Element, ProductExtractSource>();
  const addLikelyNode = (node: Element, source: ProductExtractSource) => {
    if (!likelyNodeSources.has(node)) {
      likelyNodeSources.set(node, source);
    }
  };
  const productAnchors = Array.from(
    document.querySelectorAll<HTMLAnchorElement>("a[href]"),
  ).filter((anchor) => {
    const value = text(anchor) ?? anchor.getAttribute("title")?.trim();
    const href = anchor.getAttribute("href") ?? "";
    if (!value || value.length < 6 || value.length > 260) return false;
    if (/^(xem thêm|chi tiết|mua ngay|add to cart|giỏ hàng)$/i.test(value)) {
      return false;
    }
    return (
      !isWidgetProductNode(anchor) &&
      !/^(#|javascript:|mailto:|tel:)/i.test(href)
    );
  });

  for (const anchor of productAnchors) {
    const href = anchor.getAttribute("href") ?? "";
    if (productPathPattern.test(href)) {
      addLikelyNode(
        anchor.closest("article, li, [class*='product' i]") ?? anchor,
        "generic_anchor",
      );
      continue;
    }
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
        addLikelyNode(node, "generic_node");
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

  fallbackNodes
    .slice(0, 120)
    .forEach((node) => addLikelyNode(node, "generic_node"));
  const likelyNodes = Array.from(likelyNodeSources.entries())
    .filter(([node]) => !isWidgetProductNode(node))
    .slice(0, 160);

  for (const [node, source] of likelyNodes) {
    const card = buildCardFromNode(node, source);
    const hasProductPath = Boolean(
      card.href && productPathPattern.test(new URL(card.href).pathname),
    );
    if (
      !card.href ||
      !card.name ||
      (source !== "generic_anchor" &&
        !hasProductPath &&
        !cardHasPrice(card, node))
    ) {
      continue;
    }
    const existing = cardsByHref.get(card.href);
    if (!existing || cardNameScore(card) > cardNameScore(existing)) {
      cardsByHref.set(card.href, card);
    }
  }

  const cards = Array.from(cardsByHref.values());

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

function productCandidateFromCardSnapshot(
  card: ProductCardSnapshot,
  pageUrl: string,
): {
  candidate: ExtractedProductCandidate | null;
  diagnostic: ShopProductExtractionDiagnostic;
} {
  const extractSource = card.extractSource ?? "snapshot";
  const href = normalizeProductSourceUrl(card.href, pageUrl);
  const diagnosticBase = {
    name: card.name,
    href,
    text: card.text,
    extractSource,
    score: 0,
  };
  if (!href) {
    return {
      candidate: null,
      diagnostic: { ...diagnosticBase, dropReason: "missing_product_url" },
    };
  }

  const name = resolveProductNameFromCandidates(
    [{ value: card.name, source: card.nameSource ?? "snapshot_name" }],
    card.text,
  );
  if (!name) {
    return {
      candidate: null,
      diagnostic: { ...diagnosticBase, dropReason: "invalid_product_name" },
    };
  }
  const priceResult = extractPriceFromText(card.text);
  const labels = extractProductLabels(card.text);
  const product: ScrapedShopProduct = {
    name,
    unit: detectUnit(`${name} ${card.text}`),
    category: card.category ?? labels.category,
    specText: cleanDescription(card.text, name),
    manufacturer: labels.manufacturer,
    originCountry: labels.originCountry,
    price: priceResult.price,
    priceText: priceResult.priceText,
    currency: detectCurrency(priceResult.priceText) ?? "VND",
    sourceUrl: href,
    imageUrl: card.imageUrl,
    sku: labels.sku ?? detectSku(card.text),
    model: labels.model,
    availability: labels.availability ?? detectAvailability(card.text),
    shopCategory: card.category ?? labels.category,
    catalogPdfUrls: mergeCatalogPdfUrls(card.pdfUrls),
  };
  const nameSource = card.nameSource ?? "snapshot_name";
  const candidate = candidateFromProduct(
    product,
    extractSource,
    nameSource,
    pageUrl,
  );
  if (!candidate) {
    return {
      candidate: null,
      diagnostic: {
        ...diagnosticBase,
        name,
        dropReason:
          productValidationDropReason(product, pageUrl, extractSource) ??
          "invalid_product",
      },
    };
  }

  return {
    candidate,
    diagnostic: {
      ...diagnosticBase,
      name: candidate.product.name,
      dropReason: null,
      score: candidate.score,
    },
  };
}

function candidateFromProduct(
  product: ScrapedShopProduct,
  extractSource: ProductExtractSource,
  nameSource: ProductNameSource,
  pageUrl: string,
): ExtractedProductCandidate | null {
  const name = sanitizeScrapedProductName(product.name);
  const sourceUrl = normalizeProductSourceUrl(product.sourceUrl, pageUrl);
  if (!name || !sourceUrl) {
    return null;
  }

  const normalizedProduct = {
    ...product,
    name,
    sourceUrl,
    catalogPdfUrls: mergeCatalogPdfUrls(product.catalogPdfUrls),
  };
  if (productValidationDropReason(normalizedProduct, pageUrl, extractSource)) {
    return null;
  }

  return {
    product: normalizedProduct,
    extractSource,
    nameSource,
    score: scoreProductCandidate(
      normalizedProduct,
      extractSource,
      nameSource,
      pageUrl,
    ),
  };
}

type ProductMergeBucket = {
  candidate: ExtractedProductCandidate;
  hasProductUrl: boolean;
};

function mergeProductCandidates(
  candidates: ExtractedProductCandidate[],
  pageUrl: string,
) {
  const buckets: ProductMergeBucket[] = [];
  const byUrl = new Map<string, ProductMergeBucket>();
  const bySku = new Map<string, ProductMergeBucket>();
  const byName = new Map<string, ProductMergeBucket>();

  for (const candidate of candidates) {
    const urlKey = usableProductUrlIdentity(candidate.product, pageUrl);
    const skuKey = productSkuIdentity(candidate.product);
    const nameKey = productNameIdentity(candidate.product);
    const nameBucket = nameKey ? byName.get(nameKey) : undefined;
    const bucket =
      (urlKey ? byUrl.get(urlKey) : undefined) ??
      (skuKey ? bySku.get(skuKey) : undefined) ??
      (nameBucket && shouldMergeByName(candidate, nameBucket, pageUrl)
        ? nameBucket
        : undefined);

    if (!bucket) {
      const nextBucket: ProductMergeBucket = {
        candidate,
        hasProductUrl: Boolean(urlKey),
      };
      buckets.push(nextBucket);
      indexProductMergeBucket(nextBucket, byUrl, bySku, byName, pageUrl);
      continue;
    }

    bucket.candidate = mergeProductCandidate(
      bucket.candidate,
      candidate,
      pageUrl,
    );
    bucket.hasProductUrl =
      bucket.hasProductUrl ||
      Boolean(usableProductUrlIdentity(candidate.product, pageUrl));
    indexProductMergeBucket(bucket, byUrl, bySku, byName, pageUrl);
  }

  return buckets.map((bucket) => bucket.candidate);
}

function mergeProductCandidate(
  existing: ExtractedProductCandidate,
  incoming: ExtractedProductCandidate,
  pageUrl: string,
): ExtractedProductCandidate {
  const primary = incoming.score > existing.score ? incoming : existing;
  const secondary = primary === incoming ? existing : incoming;
  const merged = mergeScrapedProductData(primary.product, secondary.product);
  const product = {
    ...merged,
    name: chooseScrapedProductName(
      primary.product.name,
      secondary.product.name,
      primary.nameSource,
      secondary.nameSource,
    ),
  };
  const extractSource = primary.extractSource;
  const nameSource = primary.nameSource;
  return {
    product,
    extractSource,
    nameSource,
    score: scoreProductCandidate(product, extractSource, nameSource, pageUrl),
  };
}

function indexProductMergeBucket(
  bucket: ProductMergeBucket,
  byUrl: Map<string, ProductMergeBucket>,
  bySku: Map<string, ProductMergeBucket>,
  byName: Map<string, ProductMergeBucket>,
  pageUrl: string,
) {
  const urlKey = usableProductUrlIdentity(bucket.candidate.product, pageUrl);
  const skuKey = productSkuIdentity(bucket.candidate.product);
  const nameKey = productNameIdentity(bucket.candidate.product);
  if (urlKey) {
    byUrl.set(urlKey, bucket);
  }
  if (skuKey) {
    bySku.set(skuKey, bucket);
  }
  if (nameKey) {
    byName.set(nameKey, bucket);
  }
}

function shouldMergeByName(
  candidate: ExtractedProductCandidate,
  bucket: ProductMergeBucket,
  pageUrl: string,
) {
  const incomingUrlKey = usableProductUrlIdentity(candidate.product, pageUrl);
  const existingUrlKey = usableProductUrlIdentity(
    bucket.candidate.product,
    pageUrl,
  );
  if (!incomingUrlKey || !existingUrlKey) {
    return true;
  }
  return incomingUrlKey === existingUrlKey;
}

function productValidationDropReason(
  product: ScrapedShopProduct,
  pageUrl: string,
  extractSource: ProductExtractSource,
) {
  if (!sanitizeScrapedProductName(product.name)) {
    return "invalid_product_name";
  }
  const sourceUrl = normalizeProductSourceUrl(product.sourceUrl, pageUrl);
  if (!sourceUrl) {
    return "missing_product_url";
  }
  const samePage = sameCanonicalUrl(sourceUrl, pageUrl);
  if (samePage && !canUseCurrentPageAsProductUrl(pageUrl, extractSource)) {
    if (extractSource === "json_ld") {
      return null;
    }
    return "listing_page_url";
  }
  if (
    isLikelyListingOnlyUrl(sourceUrl) &&
    !isLikelyProductDetailUrl(sourceUrl)
  ) {
    if (extractSource === "json_ld") {
      return null;
    }
    return "listing_page_url";
  }
  if (
    extractSource === "generic_anchor" &&
    product.price == null &&
    !product.priceText &&
    !product.imageUrl &&
    !hasStrongProductUrlSignal(sourceUrl) &&
    !isLikelyProductDetailUrl(sourceUrl)
  ) {
    return "generic_anchor_without_product_evidence";
  }
  return null;
}

function canUseCurrentPageAsProductUrl(
  pageUrl: string,
  extractSource: ProductExtractSource,
) {
  if (isLikelyListingOnlyUrl(pageUrl)) {
    return false;
  }
  return extractSource === "json_ld" || isLikelyProductDetailUrl(pageUrl);
}

function scoreProductCandidate(
  product: ScrapedShopProduct,
  extractSource: ProductExtractSource,
  nameSource: ProductNameSource,
  pageUrl: string,
) {
  if (productValidationDropReason(product, pageUrl, extractSource)) {
    return Number.NEGATIVE_INFINITY;
  }
  const extractSourceScore: Record<ProductExtractSource, number> = {
    json_ld: 30,
    woocommerce: 32,
    generic_anchor: 18,
    generic_node: 12,
    snapshot: 10,
  };
  const nameSourceScore: Record<ProductNameSource, number> = {
    json_ld: 34,
    title: 34,
    anchor_title: 24,
    anchor_text: 14,
    snapshot_name: 14,
    card_text: 6,
  };
  let score =
    extractSourceScore[extractSource] +
    nameSourceScore[nameSource] +
    Math.min(product.name.length, 80) / 8;

  if (isLikelyProductDetailUrl(product.sourceUrl)) score += 40;
  else score += 15;
  if (product.price != null) score += 20;
  if (product.priceText) score += 5;
  if (product.manufacturer) score += 10;
  if (product.originCountry) score += 8;
  if (product.category) score += 8;
  if (product.unit) score += 6;
  if (product.specText.trim()) score += 10;
  if (product.sku) score += 14;
  if (product.model) score += 12;
  if (product.availability) score += 4;
  if (product.imageUrl) score += 4;
  if (product.catalogPdfUrls.length > 0) score += 8;
  return score;
}

function productIdentity(product: ScrapedShopProduct) {
  return (
    productSourceUrlIdentity(product.sourceUrl) ??
    productNameIdentity(product) ??
    ""
  );
}

function scoreProduct(product: ScrapedShopProduct) {
  const baseScore = [
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
  return baseScore + (isLikelyProductDetailUrl(product.sourceUrl) ? 5 : 0);
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

const PRODUCT_DETAIL_PATH_PATTERN = /\/(?:product|products|san-pham|p|item)\//i;
const STRONG_PRODUCT_DETAIL_PATH_PATTERN =
  /\/(?:product|products|p|item|show)(?:\/|$)|_p\d+\.aspx$/i;
const LISTING_PATH_PATTERN =
  /\/(?:category|categories|product-category|danh-muc|collections?|search|tag|tags|archive|account|login|register|cart|checkout)\b/i;
const SHOP_URL_PROFILES = [
  {
    hostPattern: /(?:^|\.)thegioiic\.com$/i,
    listingPathPatterns: [/^\/san-pham(?:\/|$)/i],
  },
  {
    hostPattern: /(?:^|\.)dientutuonglai\.com$/i,
    listingPathPatterns: [/^\/san-pham(?:\/|$)/i],
  },
  {
    hostPattern: /(?:^|\.)linhkienchatluong\.vn$/i,
    listingPathPatterns: [/_s\d+\.aspx$/i],
  },
] as const;

function normalizeProductSourceUrl(
  value: string | null | undefined,
  baseUrl: string,
) {
  if (!value?.trim()) {
    return null;
  }
  try {
    const url = new URL(value.trim(), baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }
    url.hash = "";
    url.username = "";
    url.password = "";
    return url.href;
  } catch {
    return null;
  }
}

function productSourceUrlIdentity(value: string | null | undefined) {
  if (!value?.trim()) {
    return null;
  }
  try {
    const url = new URL(value.trim());
    url.hash = "";
    url.username = "";
    url.password = "";
    url.protocol = "https:";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/g, "");
    }
    url.searchParams.sort();
    return `${url.hostname}${url.pathname}${url.search}`;
  } catch {
    const normalized = normalizeKey(value);
    return normalized || null;
  }
}

function sameCanonicalUrl(left: string, right: string) {
  const leftKey = productSourceUrlIdentity(left);
  const rightKey = productSourceUrlIdentity(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

function isLikelyProductDetailUrl(value: string) {
  try {
    const url = new URL(value);
    const path = url.pathname.replace(/\/+$/g, "") || "/";
    if (matchesShopListingProfile(url)) {
      return false;
    }
    if (PRODUCT_DETAIL_PATH_PATTERN.test(`${path}/`)) {
      return true;
    }
    return path !== "/" && !isLikelyListingOnlyUrl(value);
  } catch {
    return false;
  }
}

function isLikelyListingOnlyUrl(value: string) {
  try {
    const url = new URL(value);
    const path = url.pathname.replace(/\/+$/g, "") || "/";
    if (path === "/") {
      return true;
    }
    if (matchesShopListingProfile(url)) {
      return true;
    }
    if (LISTING_PATH_PATTERN.test(path)) {
      return true;
    }
    if (/\/page\/\d+$/i.test(path)) {
      return true;
    }
    const listingQueryKeys = [
      "s",
      "q",
      "search",
      "keyword",
      "paged",
      "page",
      "orderby",
      "filter",
      "min_price",
      "max_price",
    ];
    return listingQueryKeys.some((key) => url.searchParams.has(key));
  } catch {
    return false;
  }
}

function matchesShopListingProfile(url: URL) {
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  return SHOP_URL_PROFILES.some(
    (profile) =>
      profile.hostPattern.test(hostname) &&
      profile.listingPathPatterns.some((pattern) => pattern.test(url.pathname)),
  );
}

function hasStrongProductUrlSignal(value: string) {
  try {
    return STRONG_PRODUCT_DETAIL_PATH_PATTERN.test(new URL(value).pathname);
  } catch {
    return false;
  }
}

function usableProductUrlIdentity(
  product: ScrapedShopProduct,
  pageUrl: string,
) {
  const sourceUrl = normalizeProductSourceUrl(product.sourceUrl, pageUrl);
  if (!sourceUrl) {
    return null;
  }
  if (sameCanonicalUrl(sourceUrl, pageUrl) && isLikelyListingOnlyUrl(pageUrl)) {
    return null;
  }
  if (
    isLikelyListingOnlyUrl(sourceUrl) &&
    !isLikelyProductDetailUrl(sourceUrl)
  ) {
    return null;
  }
  return productSourceUrlIdentity(sourceUrl);
}

function productSkuIdentity(product: ScrapedShopProduct) {
  const sku =
    normalizeKey(product.sku ?? "") || normalizeKey(product.model ?? "");
  return sku ? `sku:${sku}` : null;
}

function productNameIdentity(product: ScrapedShopProduct) {
  const name = sanitizeScrapedProductName(product.name);
  if (!name) {
    return null;
  }
  return `name:${normalizeKey(name)}|${normalizeKey(product.unit ?? "")}`;
}

function cleanName(value: string | null | undefined) {
  return sanitizeScrapedProductName(value);
}

function chooseProductSourceUrl(baseUrl: string, incomingUrl: string) {
  const baseScore = scoreSourceUrl(baseUrl);
  const incomingScore = scoreSourceUrl(incomingUrl);
  return incomingScore > baseScore ? incomingUrl : baseUrl || incomingUrl;
}

function scoreSourceUrl(value: string | null | undefined) {
  if (!value?.trim()) {
    return 0;
  }
  if (isLikelyListingOnlyUrl(value) && !isLikelyProductDetailUrl(value)) {
    return -20;
  }
  return isLikelyProductDetailUrl(value) ? 30 : 10;
}

function chooseScrapedProductPrice(
  base: ScrapedShopProduct,
  incoming: ScrapedShopProduct,
) {
  if (base.price != null || base.priceText) {
    return {
      price: base.price,
      priceText: base.priceText,
      currency: base.currency || incoming.currency || "VND",
    };
  }
  return {
    price: incoming.price,
    priceText: incoming.priceText,
    currency: incoming.currency || base.currency || "VND",
  };
}

function cleanDescription(text: string, name: string) {
  return stripKhauHaoFromSpecText(
    text.replace(name, " ").replace(/\s+/g, " ").trim(),
  ).slice(0, 1000);
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
  const unitText = text.replace(
    /(?:^|\s)(?:còn|con|hàng còn|hang con)\s*\d+\s*(?:cái|chiếc|con|bộ|máy|pcs|set)(?=\s|$)/gi,
    " ",
  );
  const explicitUnits =
    "cái|chiếc|bộ|kg|g|m2|m²|m3|m³|lít|lit|hộp|cuộn|tấm|thùng|chai|bao|máy|con|pcs|set|module|mô đun|thanh|cây|sợi|ống|đôi|cặp";
  const inferredUnits =
    "cái|chiếc|bộ|kg|lít|lit|hộp|cuộn|tấm|thùng|chai|bao|máy|con|pcs|set|module|mô đun|thanh|cây|sợi|ống|đôi|cặp";
  const priceUnitMatch = new RegExp(
    `(?:₫|đ|vnd|vnđ|dong|đồng)\\s*\\/\\s*(${explicitUnits})(?![\\p{L}\\p{N}.,])`,
    "iu",
  ).exec(unitText);
  if (priceUnitMatch?.[1]) {
    return priceUnitMatch[1].toLowerCase();
  }

  const match = new RegExp(
    `(?<![\\p{L}\\p{N}])(${inferredUnits})(?![\\p{L}\\p{N}.,])`,
    "iu",
  ).exec(unitText);
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
