import { createLogger, traceFn } from "~/server/lib/logger";
const log = createLogger("services-shop-scrape-limits");

const SCRAPE_BASE_TIMEOUT_MS = 15_000;
const SCRAPE_PAGE_TIMEOUT_MS = 8_000;
const SCRAPE_MAX_TIMEOUT_PAGES = 100;
export const SCRAPE_ALL_TIMEOUT_MS = 20 * 60_000;
export const SCRAPE_MIN_SINGLE_PAGE_TIMEOUT_MS = 45_000;

function _scrapeTimeoutMs(maxPages: number | null) {
  if (maxPages == null) {
    return SCRAPE_ALL_TIMEOUT_MS;
  }

  const calculated =
    SCRAPE_BASE_TIMEOUT_MS +
    Math.min(maxPages, SCRAPE_MAX_TIMEOUT_PAGES) * SCRAPE_PAGE_TIMEOUT_MS;
  if (maxPages <= 1) {
    return Math.max(SCRAPE_MIN_SINGLE_PAGE_TIMEOUT_MS, calculated);
  }
  return calculated;
}

export const scrapeTimeoutMs = traceFn(log, "scrapeTimeoutMs", _scrapeTimeoutMs);
