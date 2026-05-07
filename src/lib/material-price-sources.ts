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

export type MaterialMetadata = {
  priceSources: MaterialPriceSource[];
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

  return {
    priceSources: Array.isArray(priceSourcesValue)
      ? priceSourcesValue
          .map(normalizePriceSource)
          .filter((source): source is MaterialPriceSource => source !== null)
      : [],
  };
}

export function buildMaterialMetadata(input: MaterialMetadata) {
  return {
    priceSources: input.priceSources,
  };
}

export function extractPriceFromText(text: string): {
  priceText: string | null;
  price: number | null;
} {
  const normalized = text.replace(/\s+/g, " ").slice(0, 250_000);
  const matches = Array.from(
    normalized.matchAll(
      /((?:\d{1,3}(?:[.,]\d{3})+|\d{4,})(?:\s*(?:vnd|vnđ|₫|dong|đồng)))/gi,
    ),
  );

  const explicitMatch =
    /(?:gia|giá|price|don gia|đơn giá)\s*[:\-]?\s*((?:\d{1,3}(?:[.,]\d{3})+|\d{4,})(?:\s*(?:vnd|vnđ|₫|dong|đồng))?)/i.exec(
      normalized,
    );

  const priceText = explicitMatch?.[1] ?? matches[0]?.[1] ?? null;
  if (!priceText) {
    return { priceText: null, price: null };
  }

  const numeric = Number(priceText.replace(/[^\d]/g, ""));
  return {
    priceText: priceText.trim(),
    price: Number.isFinite(numeric) && numeric > 0 ? numeric : null,
  };
}
