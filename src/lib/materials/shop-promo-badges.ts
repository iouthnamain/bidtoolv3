/** WooCommerce / Vietnamese shop promo sticker text — never valid product names. */
export const SHOP_PROMO_BADGE_LABELS = [
  "Thịnh hành",
  "Thịnh thành",
  "Bán chạy",
  "Sản phẩm bán chạy",
  "Hàng mới",
  "Sản phẩm mới",
  "Mới về",
  "Mới",
  "Giảm giá",
  "Giảm sốc",
  "Giá sốc",
  "Khuyến mãi",
  "Ưu đãi",
  "Nổi bật",
  "Siêu sale",
  "Siêu hot",
  "Flash sale",
  "Hot deal",
  "Top deal",
  "Best seller",
  "Bestseller",
  "Trending",
  "Popular",
  "Hot",
  "Sale off",
  "Sale",
  "New",
  "Deal",
  "Limited offer",
  "Limited",
  "Freeship",
  "Free ship",
  "Miễn phí ship",
  "Miễn phí vận chuyển",
  "Xả kho",
  "Sắp hết hàng",
  "Yêu thích",
  "Đề xuất",
  "Gợi ý",
  "Liên hệ",
  "Contact",
  "Đăng ký",
  "Đăng nhập",
  "Register",
  "Login",
] as const;

function normalizePromoKey(value: string) {
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

function buildPromoBadgeHelpers(labels: readonly string[]) {
  const sortedLabels = [...labels].sort((a, b) => b.length - a.length);
  const normalizedLabels = new Set(
    labels.map((label) => normalizePromoKey(label)),
  );

  const isPromoBadgeText = (value: string | null | undefined) => {
    const trimmed = value?.replace(/\s+/g, " ").trim();
    if (!trimmed) {
      return false;
    }
    return normalizedLabels.has(normalizePromoKey(trimmed));
  };

  const stripPromoBadgePrefix = (value: string) => {
    let result = value.replace(/\s+/g, " ").trim();
    let changed = true;
    while (changed) {
      changed = false;
      for (const label of sortedLabels) {
        const pattern = new RegExp(`^${escapeRegExp(label)}\\s*`, "i");
        if (pattern.test(result)) {
          result = result.replace(pattern, "").trim();
          changed = true;
          break;
        }
      }
    }
    return result;
  };

  return { isPromoBadgeText, stripPromoBadgePrefix };
}

const promoBadgeHelpers = buildPromoBadgeHelpers(SHOP_PROMO_BADGE_LABELS);

export function isShopPromoBadgeText(value: string | null | undefined) {
  return promoBadgeHelpers.isPromoBadgeText(value);
}

export function stripShopPromoBadgePrefix(value: string) {
  return promoBadgeHelpers.stripPromoBadgePrefix(value);
}

/** Trailing shop prices — require separators or currency so model codes like 2200W stay. */
const CARD_PRICE_SUFFIX_PATTERN =
  /\s+(?:\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?)(?:\s*(?:vnd|vnđ|₫|đ|dong|đồng))?.*$|\s+\d{4,}\s*(?:vnd|vnđ|₫|đ|dong|đồng)\b.*$/i;

export function stripTrailingPriceFromProductName(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*giá\s*:\s*/gi, " ")
    .replace(CARD_PRICE_SUFFIX_PATTERN, "")
    .replace(
      /\b(còn hàng|hết hàng|in stock|out of stock|hàng còn|hang con)\b.*$/i,
      "",
    )
    .trim();
}

function sanitizeScrapedProductNameSingle(value: string) {
  const stripped = stripTrailingPriceFromProductName(
    stripStockCountPrefix(
      stripWarrantyPrefix(
        stripShopPromoBadgePrefix(value.replace(/\s+/g, " ").trim()),
      ),
    ),
  );
  const cleaned = stripped
    .replace(
      /\b(add to cart|mua ngay|chi tiết|xem thêm|liên hệ|lien he|đăng ký|dang ky|đăng nhập|dang nhap|register|login|cart|giỏ hàng|gio hang)\b/gi,
      " ",
    )
    .trim();
  if (
    !cleaned ||
    cleaned.length < 2 ||
    isShopPromoBadgeText(cleaned) ||
    isPriceOnlyProductName(cleaned) ||
    isUtilityOnlyProductName(cleaned)
  ) {
    return null;
  }
  return cleaned.slice(0, 220);
}

function stripWarrantyPrefix(value: string) {
  return value
    .replace(
      /^(?:bh|bảo hành|bao hanh)\s*\d+\s*(?:tháng|thang|năm|nam)\s*/i,
      "",
    )
    .trim();
}

function stripStockCountPrefix(value: string) {
  return value
    .replace(
      /^(?:còn|con|hàng còn|hang con)\s*\d+\s*(?:cái|chiếc|con|bộ|máy|pcs|set)?\s*/i,
      "",
    )
    .trim();
}

export function stripStockCountFromProductName(value: string) {
  return stripStockCountPrefix(value);
}

export function stripWarrantyFromProductName(value: string) {
  return stripWarrantyPrefix(value);
}

/** Remove KH / Khấu hao column noise from scraped spec text. */
export function stripKhauHaoFromSpecText(value: string) {
  return value
    .replace(
      /\b(?:kh|khấu hao|khau hao)\s*[:：]?\s*\d+(?:[.,]\d+)?\s*%?/gi,
      " ",
    )
    .replace(/\b(?:khấu hao|khau hao)\b/gi, " ")
    .replace(/\bKH\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isPriceOnlyProductName(value: string) {
  return /^(?:\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d{4,})\s*(?:vnd|vnđ|₫|đ|dong|đồng)?$/i.test(
    value.trim(),
  );
}

function isUtilityOnlyProductName(value: string) {
  return /^(?:bh|bảo hành|bao hanh)\s*\d+\s*(?:tháng|thang|năm|nam)$|^(?:còn hàng|hết hàng|in stock|out of stock|available|unavailable)$|^(?:còn|con|hàng còn|hang con)\s*\d+\s*(?:cái|chiếc|con|bộ|máy|pcs|set)?$/i.test(
    value.trim(),
  );
}

/** Normalize a scraped product name; returns null when only a promo sticker. */
export function sanitizeScrapedProductName(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const lines = trimmed
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > 1) {
    for (const line of lines) {
      const fromLine = sanitizeScrapedProductNameSingle(line);
      if (fromLine) {
        return fromLine;
      }
    }
    const combined = sanitizeScrapedProductNameSingle(lines.join(" "));
    if (combined) {
      return combined;
    }
    return null;
  }

  return sanitizeScrapedProductNameSingle(trimmed);
}

/** Pull a product title out of full card text (promo + name + price). */
export function extractProductNameFromCardText(text: string) {
  return sanitizeScrapedProductName(text);
}

export type ScrapedProductNameSource =
  | "json_ld"
  | "title"
  | "anchor_title"
  | "anchor_text"
  | "card_text"
  | "snapshot_name";

export type ScrapedProductNameCandidate =
  | string
  | null
  | undefined
  | {
      value: string | null | undefined;
      source?: ScrapedProductNameSource;
    };

const NAME_SOURCE_SCORES: Record<ScrapedProductNameSource, number> = {
  title: 40,
  json_ld: 38,
  anchor_title: 30,
  snapshot_name: 25,
  anchor_text: 20,
  card_text: 10,
};

export function scoreScrapedProductName(
  name: string | null | undefined,
  source?: ScrapedProductNameSource,
) {
  const sanitized = sanitizeScrapedProductName(name);
  if (!sanitized) {
    return -1;
  }
  const sourceScore = source ? (NAME_SOURCE_SCORES[source] ?? 15) : 15;
  return sourceScore * 1000 + sanitized.length;
}

export function chooseScrapedProductName(
  baseName: string,
  incomingName: string,
  baseSource?: ScrapedProductNameSource,
  incomingSource?: ScrapedProductNameSource,
) {
  const base = sanitizeScrapedProductName(baseName);
  const incoming = sanitizeScrapedProductName(incomingName);
  if (!incoming) {
    return base ?? baseName;
  }
  if (!base || isShopPromoBadgeText(baseName)) {
    return incoming;
  }
  if (isShopPromoBadgeText(incomingName)) {
    return base;
  }
  const baseScore = scoreScrapedProductName(base, baseSource);
  const incomingScore = scoreScrapedProductName(incoming, incomingSource);
  if (incomingScore === baseScore) {
    return incoming.length > base.length ? incoming : base;
  }
  return incomingScore > baseScore ? incoming : base;
}

/** Pick the best valid product name from DOM/card candidates. */
export function resolveProductNameFromCandidates(
  candidates: Array<ScrapedProductNameCandidate>,
  cardText?: string | null,
) {
  const scored: Array<{ name: string; score: number }> = [];
  for (const candidate of candidates) {
    const value =
      typeof candidate === "object" && candidate !== null && "value" in candidate
        ? candidate.value
        : candidate;
    const source =
      typeof candidate === "object" && candidate !== null && "value" in candidate
        ? candidate.source
        : undefined;
    const sanitized = sanitizeScrapedProductName(value);
    if (sanitized) {
      scored.push({
        name: sanitized,
        score: scoreScrapedProductName(sanitized, source),
      });
    }
  }

  if (scored.length > 0) {
    return scored.sort((a, b) => b.score - a.score)[0]?.name ?? null;
  }

  if (cardText?.trim()) {
    return extractProductNameFromCardText(cardText);
  }

  return null;
}

export type ScrapedProductNameFields = {
  name: string;
  sourceUrl: string;
};

function isCategoryListingUrl(url: string) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/g, "") || "/";
    if (path === "/") {
      return true;
    }
    return (
      /\/category\/|\/categories\/|\/danh-muc\/|\/collection\//i.test(path) ||
      /\/product-category\/|\/search\b|\/tag\b|\/page\/\d+$/i.test(path) ||
      /\/(?:account|login|register|cart|checkout)(?:\/|$)/i.test(path) ||
      ["s", "q", "search", "paged", "page", "orderby"].some((key) =>
        parsed.searchParams.has(key),
      )
    );
  } catch {
    return false;
  }
}

function sourceUrlIdentity(url: string) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.protocol = "https:";
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (parsed.pathname.length > 1) {
      parsed.pathname = parsed.pathname.replace(/\/+$/g, "");
    }
    parsed.searchParams.sort();
    return `${parsed.hostname}${parsed.pathname}${parsed.search}`;
  } catch {
    return url.trim();
  }
}

export function isInvalidListingOnlyProduct<T extends ScrapedProductNameFields>(
  product: T,
  pageUrl?: string | null,
) {
  const name = sanitizeScrapedProductName(product.name);
  if (!name) {
    return true;
  }
  if (isCategoryListingUrl(product.sourceUrl)) {
    return true;
  }
  if (!pageUrl) {
    return false;
  }
  try {
    const productUrl = new URL(product.sourceUrl);
    const listingUrl = new URL(pageUrl);
    if (
      productUrl.origin === listingUrl.origin &&
      productUrl.pathname.replace(/\/+$/g, "") ===
        listingUrl.pathname.replace(/\/+$/g, "") &&
      isCategoryListingUrl(pageUrl)
    ) {
      return true;
    }
  } catch {
    // Keep products with unparseable URLs.
  }
  return false;
}

export function sanitizeScrapedProductList<T extends ScrapedProductNameFields>(
  products: T[],
  pageUrl?: string | null,
): T[] {
  const byIdentity = new Map<string, T>();

  for (const product of products) {
    const name = sanitizeScrapedProductName(product.name);
    if (!name || isInvalidListingOnlyProduct(product, pageUrl)) {
      continue;
    }

    const sanitized = { ...product, name };
    const identity = product.sourceUrl.trim()
      ? sourceUrlIdentity(product.sourceUrl)
      : `${name}|`;
    const existing = byIdentity.get(identity);
    if (
      !existing ||
      scoreScrapedProductName(name) > scoreScrapedProductName(existing.name)
    ) {
      byIdentity.set(identity, sanitized);
    }
  }

  return Array.from(byIdentity.values());
}
