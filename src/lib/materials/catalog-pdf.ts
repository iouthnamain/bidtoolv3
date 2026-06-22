export const CATALOG_PDF_MAX_FILE_SIZE = 50 * 1024 * 1024;

export const CATALOG_DOCUMENT_SOURCE_TYPES = [
  "uploaded",
  "detected",
  "manual_url",
  "generated",
] as const;
export type CatalogDocumentSourceType =
  (typeof CATALOG_DOCUMENT_SOURCE_TYPES)[number];

export const CATALOG_DOCUMENT_LINK_SOURCES = [
  "manual",
  "scrape",
  "import",
] as const;
export type CatalogDocumentLinkSource =
  (typeof CATALOG_DOCUMENT_LINK_SOURCES)[number];

/**
 * Normalize a catalog PDF URL for dedupe: lowercase scheme/host, drop the
 * fragment and default ports, keep path/query (they can identify the file).
 * Returns "" for unusable values so callers can store it in the non-null
 * `normalized_source_url` column.
 */
export function normalizeCatalogPdfUrl(value: string | null | undefined) {
  const raw = value?.trim();
  if (!raw) {
    return "";
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "";
  }

  url.hash = "";
  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  ) {
    url.port = "";
  }

  return url.toString();
}

export function isLikelyPdfUrl(value: string | null | undefined) {
  const raw = value?.trim();
  if (!raw) {
    return false;
  }
  try {
    const url = new URL(raw);
    return /\.pdf$/i.test(url.pathname);
  } catch {
    return /\.pdf(?:[?#]|$)/i.test(raw);
  }
}

/**
 * Parse a `catalog_pdf_urls` import cell. Multiple URLs are separated by
 * newline or semicolon. Returns trimmed, deduped (by normalized form) URLs.
 */
export function parseCatalogPdfUrlsCell(value: string | null | undefined) {
  const raw = value?.trim();
  if (!raw) {
    return [];
  }

  const urls: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(/[\n;]+/)) {
    const candidate = part.trim();
    if (!candidate) {
      continue;
    }
    const normalized = normalizeCatalogPdfUrl(candidate);
    const key = normalized || candidate.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    urls.push(candidate);
  }
  return urls;
}

export function formatCatalogPdfUrlsCell(urls: string[]) {
  return urls
    .map((url) => url.trim())
    .filter(Boolean)
    .join("\n");
}

/** Derive a readable document title from a PDF URL (file name without extension). */
export function catalogDocumentTitleFromUrl(url: string, fallback: string) {
  try {
    const pathname = new URL(url).pathname;
    const fileName = decodeURIComponent(pathname.split("/").pop() ?? "");
    const withoutExt = fileName.replace(/\.pdf$/i, "").trim();
    if (withoutExt) {
      return withoutExt.replace(/[-_]+/g, " ").trim();
    }
  } catch {
    // Fall through to fallback.
  }
  return fallback;
}

export function catalogPdfFileNameFromUrl(url: string) {
  try {
    const pathname = new URL(url).pathname;
    const fileName = decodeURIComponent(pathname.split("/").pop() ?? "");
    if (/\.pdf$/i.test(fileName)) {
      return fileName;
    }
  } catch {
    // Ignore parse failures.
  }
  return "catalog.pdf";
}

/** Union + dedupe PDF URL lists by normalized form, preserving order. */
export function mergeCatalogPdfUrls(...lists: Array<string[] | undefined>) {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const url of list ?? []) {
      const candidate = url.trim();
      if (!candidate) {
        continue;
      }
      const key = normalizeCatalogPdfUrl(candidate) || candidate.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(candidate);
    }
  }
  return merged;
}
