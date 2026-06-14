/**
 * Short-lived in-memory cache for BidWinner public HTML responses.
 *
 * BidWinner search is fetched live (no `no-store` CDN caching), so repeated or
 * adjacent searches (pagination, re-applying the same filter, the server
 * prefetch + client hydration pair) otherwise re-fetch identical remote pages.
 * This caches the resolved HTML per URL for a short TTL and dedupes concurrent
 * in-flight fetches for the same key so a `Promise.all` over several pages does
 * not issue duplicate requests.
 *
 * Scope is intentionally tiny: a single-process, single-user Electron/Next app.
 * No eviction policy beyond TTL + a hard entry cap; this is not a durable store.
 */

const DEFAULT_TTL_MS = 90_000;
const MAX_ENTRIES = 256;

type CacheEntry = {
  html: string;
  expiresAt: number;
};

const htmlCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<string>>();

function now(): number {
  return Date.now();
}

function pruneExpired(reference: number): void {
  for (const [key, entry] of htmlCache) {
    if (entry.expiresAt <= reference) {
      htmlCache.delete(key);
    }
  }

  // Hard cap so a long-running process cannot grow unbounded across many
  // distinct queries. Drop oldest-inserted entries (Map preserves order).
  while (htmlCache.size > MAX_ENTRIES) {
    const oldestKey = htmlCache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    htmlCache.delete(oldestKey);
  }
}

/**
 * Returns cached HTML for `key` if still fresh, otherwise runs `fetcher`,
 * caches the result, and returns it. Concurrent callers with the same key
 * share a single in-flight fetch. A rejected fetch is never cached.
 */
export async function fetchHtmlWithCache(
  key: string,
  fetcher: () => Promise<string>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<string> {
  const reference = now();

  const cached = htmlCache.get(key);
  if (cached && cached.expiresAt > reference) {
    return cached.html;
  }

  const existing = inFlight.get(key);
  if (existing) {
    return existing;
  }

  const pending = (async () => {
    const html = await fetcher();
    htmlCache.set(key, { html, expiresAt: now() + ttlMs });
    pruneExpired(now());
    return html;
  })();

  inFlight.set(key, pending);

  try {
    return await pending;
  } finally {
    inFlight.delete(key);
  }
}

/** Test-only: clear all cached entries and in-flight promises. */
export function __clearBidWinnerPageCache(): void {
  htmlCache.clear();
  inFlight.clear();
}
