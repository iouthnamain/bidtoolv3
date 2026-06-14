export type MaterialPriceSourceMode = "linked" | "fixed";

export type MaterialPriceSource = {
  id: string;
  label: string;
  url: string;
  mode: MaterialPriceSourceMode;
  fixedPrice: number | null;
  lastPrice: number | null;
  lastPriceText: string | null;
  currency: string;
  lastCheckedAt: string | null;
  note: string;
  isPrimary: boolean;
};

export type MaterialShopScrapeMetadata = {
  sourceUrl: string;
  shopHost: string;
  scrapedAt: string;
  imageUrl: string | null;
  sku: string | null;
  model: string | null;
  availability: string | null;
  shopCategory: string | null;
};

export type MaterialWebEnrichmentMetadata = {
  lastEnrichedAt: string | null;
  lastEnrichmentJobId: string | null;
  enrichmentConfidence: number | null;
  enrichmentStatus: string | null;
};

export type MaterialFieldLockKey =
  | "code"
  | "name"
  | "unit"
  | "category"
  | "specText"
  | "manufacturer"
  | "originCountry"
  | "defaultUnitPrice"
  | "currency"
  | "sourceUrl"
  | "imageUrl";

export const MATERIAL_FIELD_LOCK_KEYS = [
  "code",
  "name",
  "unit",
  "category",
  "specText",
  "manufacturer",
  "originCountry",
  "defaultUnitPrice",
  "currency",
  "sourceUrl",
  "imageUrl",
] as const satisfies readonly MaterialFieldLockKey[];

export type MaterialMetadata = {
  priceSources: MaterialPriceSource[];
  shopScrape?: MaterialShopScrapeMetadata;
  webEnrichment?: MaterialWebEnrichmentMetadata;
  fieldLocks?: Partial<Record<MaterialFieldLockKey, boolean>>;
};

export function normalizePriceSource(
  value: unknown,
): MaterialPriceSource | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const source = value as Partial<MaterialPriceSource>;
  if (!source.id || !source.label) {
    return null;
  }
  const currency =
    typeof source.currency === "string" && source.currency.trim().length > 0
      ? source.currency
      : "VND";

  return {
    id: source.id,
    label: source.label,
    url: source.url ?? "",
    mode: source.mode === "fixed" ? "fixed" : "linked",
    fixedPrice:
      typeof source.fixedPrice === "number" &&
      Number.isFinite(source.fixedPrice)
        ? source.fixedPrice
        : null,
    lastPrice:
      typeof source.lastPrice === "number" && Number.isFinite(source.lastPrice)
        ? source.lastPrice
        : null,
    lastPriceText: source.lastPriceText ?? null,
    currency,
    lastCheckedAt: source.lastCheckedAt ?? null,
    note: source.note ?? "",
    isPrimary: Boolean(source.isPrimary),
  };
}

export function normalizeMaterialMetadata(value: unknown): MaterialMetadata {
  const record = value && typeof value === "object" ? value : {};
  const priceSourcesValue = (record as { priceSources?: unknown }).priceSources;
  const shopScrape = normalizeShopScrapeMetadata(
    (record as { shopScrape?: unknown }).shopScrape,
  );
  const webEnrichment = normalizeWebEnrichmentMetadata(
    (record as { webEnrichment?: unknown }).webEnrichment,
  );
  const fieldLocks = normalizeFieldLocks(
    (record as { fieldLocks?: unknown }).fieldLocks,
  );

  return {
    priceSources: Array.isArray(priceSourcesValue)
      ? priceSourcesValue
          .map(normalizePriceSource)
          .filter((source): source is MaterialPriceSource => source !== null)
      : [],
    ...(shopScrape ? { shopScrape } : {}),
    ...(webEnrichment ? { webEnrichment } : {}),
    ...(fieldLocks ? { fieldLocks } : {}),
  };
}

function normalizeFieldLocks(
  value: unknown,
): Partial<Record<MaterialFieldLockKey, boolean>> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const locks: Partial<Record<MaterialFieldLockKey, boolean>> = {};
  for (const key of MATERIAL_FIELD_LOCK_KEYS) {
    const locked = (value as Record<string, unknown>)[key];
    if (locked === true) {
      locks[key] = true;
    }
  }
  return Object.keys(locks).length > 0 ? locks : undefined;
}

export function buildMaterialMetadata(input: MaterialMetadata) {
  return {
    priceSources: input.priceSources,
    ...(input.shopScrape ? { shopScrape: input.shopScrape } : {}),
    ...(input.webEnrichment ? { webEnrichment: input.webEnrichment } : {}),
    ...(input.fieldLocks && Object.keys(input.fieldLocks).length > 0
      ? { fieldLocks: input.fieldLocks }
      : {}),
  };
}

export function normalizeWebEnrichmentMetadata(
  value: unknown,
): MaterialWebEnrichmentMetadata | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const enrichment = value as Partial<MaterialWebEnrichmentMetadata>;
  const lastEnrichedAt =
    typeof enrichment.lastEnrichedAt === "string" &&
    enrichment.lastEnrichedAt.trim().length > 0
      ? enrichment.lastEnrichedAt
      : null;
  const lastEnrichmentJobId =
    typeof enrichment.lastEnrichmentJobId === "string" &&
    enrichment.lastEnrichmentJobId.trim().length > 0
      ? enrichment.lastEnrichmentJobId
      : null;
  const enrichmentConfidence =
    typeof enrichment.enrichmentConfidence === "number" &&
    Number.isFinite(enrichment.enrichmentConfidence)
      ? Math.min(100, Math.max(0, Math.round(enrichment.enrichmentConfidence)))
      : null;
  const enrichmentStatus =
    typeof enrichment.enrichmentStatus === "string" &&
    enrichment.enrichmentStatus.trim().length > 0
      ? enrichment.enrichmentStatus
      : null;

  if (
    !lastEnrichedAt &&
    !lastEnrichmentJobId &&
    enrichmentConfidence == null &&
    !enrichmentStatus
  ) {
    return null;
  }

  return {
    lastEnrichedAt,
    lastEnrichmentJobId,
    enrichmentConfidence,
    enrichmentStatus,
  };
}

function normalizeShopScrapeMetadata(
  value: unknown,
): MaterialShopScrapeMetadata | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const scrape = value as Partial<MaterialShopScrapeMetadata>;
  if (
    typeof scrape.sourceUrl !== "string" ||
    scrape.sourceUrl.trim().length === 0 ||
    typeof scrape.shopHost !== "string" ||
    scrape.shopHost.trim().length === 0 ||
    typeof scrape.scrapedAt !== "string" ||
    scrape.scrapedAt.trim().length === 0
  ) {
    return null;
  }

  return {
    sourceUrl: scrape.sourceUrl,
    shopHost: scrape.shopHost,
    scrapedAt: scrape.scrapedAt,
    imageUrl: scrape.imageUrl ?? null,
    sku: scrape.sku ?? null,
    model: scrape.model ?? null,
    availability: scrape.availability ?? null,
    shopCategory: scrape.shopCategory ?? null,
  };
}

export function extractPriceFromText(text: string): {
  priceText: string | null;
  price: number | null;
} {
  const normalized = text.replace(/\s+/g, " ").slice(0, 250_000);
  const currencyPattern = "(?:vnd|vnđ|₫|đ|dong|đồng|usd|us\\$|\\$|eur|€)";
  const matches = Array.from(
    normalized.matchAll(
      new RegExp(
        `((?:${currencyPattern})\\s*(?:\\d{1,3}(?:[.,]\\d{3})+(?:[.,]\\d+)?|\\d+(?:[.,]\\d+)?)|(?:\\d{1,3}(?:[.,]\\d{3})+(?:[.,]\\d+)?|\\d{4,})\\s*(?:${currencyPattern}))`,
        "gi",
      ),
    ),
  );

  const explicitMatch =
    /(?:gia|giá|price|don gia|đơn giá)\s*[:\-]?\s*((?:\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d{4,})(?:\s*(?:vnd|vnđ|₫|đ|dong|đồng|usd|us\$|\$|eur|€))?)/i.exec(
      normalized,
    );

  const explicitPriceText = explicitMatch?.[1];
  const priceTexts = explicitPriceText
    ? [explicitPriceText]
    : matches.flatMap((match) =>
        typeof match[1] === "string" ? [match[1]] : [],
      );
  const candidates = priceTexts.map((priceText) => ({
    priceText,
    price: parsePriceNumber(priceText),
  }));
  const selected =
    explicitPriceText && candidates[0]
      ? candidates[0]
      : (candidates
          .filter((candidate) => candidate.price != null)
          .sort((a, b) => (a.price ?? 0) - (b.price ?? 0))[0] ??
        candidates[0] ??
        null);
  if (!selected) {
    return { priceText: null, price: null };
  }

  return {
    priceText: selected.priceText.trim(),
    price: selected.price,
  };
}

function parsePriceNumber(priceText: string) {
  const cleaned = priceText.trim();
  const currencyFirst = /^[^\d]+/.test(cleaned);
  const numericText = cleaned.replace(/[^\d.,]/g, "");
  const isDecimalCurrency = /usd|us\$|\$|eur|€/i.test(cleaned);
  if (isDecimalCurrency) {
    const normalized = normalizeDecimalPrice(numericText, currencyFirst);
    const value = Number(normalized);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  const numeric = Number(numericText.replace(/[^\d]/g, ""));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function normalizeDecimalPrice(value: string, currencyFirst: boolean) {
  const separators = [...value.matchAll(/[.,]/g)].map(
    (match) => match.index ?? -1,
  );
  if (separators.length === 0) {
    return value;
  }
  const lastSeparator = separators[separators.length - 1] ?? -1;
  const integerPart = value.slice(0, lastSeparator).replace(/[^\d]/g, "");
  const decimalPart = value.slice(lastSeparator + 1).replace(/[^\d]/g, "");
  if (decimalPart.length === 3 && !currencyFirst) {
    return value.replace(/[^\d]/g, "");
  }
  return `${integerPart}.${decimalPart}`;
}
