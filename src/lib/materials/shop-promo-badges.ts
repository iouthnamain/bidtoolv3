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
  const normalizedLabels = new Set(labels.map((label) => normalizePromoKey(label)));

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
    .replace(/\b(còn hàng|hết hàng|in stock|out of stock)\b.*$/i, "")
    .trim();
}

function sanitizeScrapedProductNameSingle(value: string) {
  const stripped = stripTrailingPriceFromProductName(
    stripShopPromoBadgePrefix(value.replace(/\s+/g, " ").trim()),
  );
  const cleaned = stripped
    .replace(/\b(add to cart|mua ngay|chi tiết|xem thêm)\b/gi, " ")
    .trim();
  if (
    !cleaned ||
    cleaned.length < 2 ||
    isShopPromoBadgeText(cleaned) ||
    isPriceOnlyProductName(cleaned)
  ) {
    return null;
  }
  return cleaned.slice(0, 220);
}

function isPriceOnlyProductName(value: string) {
  return /^(?:\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d{4,})\s*(?:vnd|vnđ|₫|đ|dong|đồng)?$/i.test(
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

/** Pick the longest valid product name from DOM/card candidates. */
export function resolveProductNameFromCandidates(
  candidates: Array<string | null | undefined>,
  cardText?: string | null,
) {
  const fromCandidates = candidates
    .map((candidate) => sanitizeScrapedProductName(candidate))
    .filter((name): name is string => Boolean(name));

  if (fromCandidates.length > 0) {
    return fromCandidates.sort((a, b) => b.length - a.length)[0] ?? null;
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
    const path = new URL(url).pathname;
    return /\/category\/|\/categories\/|\/danh-muc\/|\/collection\//i.test(
      path,
    );
  } catch {
    return false;
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
        listingUrl.pathname.replace(/\/+$/g, "")
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
    const identity = product.sourceUrl.trim() || `${name}|`;
    const existing = byIdentity.get(identity);
    if (!existing || name.length > existing.name.length) {
      byIdentity.set(identity, sanitized);
    }
  }

  return Array.from(byIdentity.values());
}
