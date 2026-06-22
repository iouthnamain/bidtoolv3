import { materialImageUrlFromScrape } from "~/lib/materials/image";
import {
  buildMaterialMetadata,
  normalizeMaterialMetadata,
  type MaterialFieldLockKey,
  type MaterialMetadata,
  type MaterialPriceSource,
} from "~/lib/material-price-sources";
import type { materials } from "~/server/db/schema";
import type { ScrapedShopProduct } from "~/server/services/shop-material-scraper";

type MaterialRow = typeof materials.$inferSelect;

export type MergePreviewField = {
  key: string;
  label: string;
  before: string;
  after: string;
  changed: boolean;
};

function isFieldLocked(
  locks: Partial<Record<MaterialFieldLockKey, boolean>>,
  field: MaterialFieldLockKey,
) {
  return locks[field] === true;
}

function applyLockedFillEmptyField(
  locks: Partial<Record<MaterialFieldLockKey, boolean>>,
  field: MaterialFieldLockKey,
  existing: string | null | undefined,
  scraped: string | null | undefined,
): string | undefined {
  if (isFieldLocked(locks, field)) {
    return existing ?? undefined;
  }
  const existingTrimmed = existing?.trim();
  if (existingTrimmed) {
    return existing ?? undefined;
  }
  const scrapedTrimmed = scraped?.trim();
  return scrapedTrimmed ? (scraped ?? undefined) : (existing ?? undefined);
}

function applyLockedPriceField(
  locks: Partial<Record<MaterialFieldLockKey, boolean>>,
  existingPrice: number | null,
  scrapedPrice: number | null,
) {
  if (isFieldLocked(locks, "defaultUnitPrice")) {
    return existingPrice;
  }
  return existingPrice == null && scrapedPrice != null
    ? scrapedPrice
    : existingPrice;
}

function applyLockedCurrencyField(
  locks: Partial<Record<MaterialFieldLockKey, boolean>>,
  existingPrice: number | null,
  existingCurrency: string,
  scrapedPrice: number | null,
  scrapedCurrency: string,
) {
  if (isFieldLocked(locks, "currency")) {
    return existingCurrency;
  }
  return existingPrice == null && scrapedPrice != null
    ? scrapedCurrency
    : existingCurrency;
}

function scrapedShopMetadata(
  product: ScrapedShopProduct,
  scrapedAt: string,
): NonNullable<MaterialMetadata["shopScrape"]> {
  let shopHost = "";
  try {
    shopHost = new URL(product.sourceUrl).hostname;
  } catch {
    shopHost = "";
  }

  return {
    sourceUrl: product.sourceUrl,
    shopHost,
    scrapedAt,
    imageUrl: product.imageUrl,
    sku: product.sku,
    model: product.model,
    availability: product.availability,
    shopCategory: product.shopCategory,
  };
}

function normalizePrimarySources(
  sources: MaterialPriceSource[],
  primaryId?: string,
) {
  if (sources.length === 0) {
    return sources;
  }

  const targetPrimaryId =
    primaryId ?? sources.find((source) => source.isPrimary)?.id;
  if (!targetPrimaryId) {
    return sources;
  }

  return sources.map((source) => ({
    ...source,
    isPrimary: source.id === targetPrimaryId,
  }));
}

function upsertScrapedPriceSource(
  existingSources: MaterialPriceSource[],
  product: ScrapedShopProduct,
  checkedAt: string,
) {
  const sourceUrl = product.sourceUrl.trim();
  const hasPrimary = existingSources.some((source) => source.isPrimary);
  const sourceIndex = existingSources.findIndex(
    (source) => source.url.trim() === sourceUrl,
  );

  if (sourceIndex >= 0) {
    return normalizePrimarySources(
      existingSources.map((source, index) =>
        index === sourceIndex
          ? {
              ...source,
              lastPrice: product.price,
              lastPriceText: product.priceText,
              currency: product.currency,
              lastCheckedAt: checkedAt,
            }
          : source,
      ),
    );
  }

  let label = "Shop scrape";
  try {
    label = new URL(sourceUrl).hostname;
  } catch {
    // Keep generic label.
  }

  const source: MaterialPriceSource = {
    id: "preview-source",
    label,
    url: sourceUrl,
    mode: "linked",
    fixedPrice: null,
    lastPrice: product.price,
    lastPriceText: product.priceText,
    currency: product.currency,
    lastCheckedAt: checkedAt,
    note: "Tự động nhập từ shop URL.",
    isPrimary: !hasPrimary,
  };

  return normalizePrimarySources([...existingSources, source], source.id);
}

function metadataForScrapedProduct(
  material: MaterialRow | null,
  product: ScrapedShopProduct,
  scrapedAt: string,
) {
  const existingMetadata = normalizeMaterialMetadata(material?.metadataJson);
  const priceSources = upsertScrapedPriceSource(
    existingMetadata.priceSources,
    product,
    scrapedAt,
  );

  return {
    ...(material?.metadataJson ?? {}),
    ...buildMaterialMetadata({
      priceSources,
      shopScrape: scrapedShopMetadata(product, scrapedAt),
      fieldLocks: normalizeMaterialMetadata(material?.metadataJson).fieldLocks,
    }),
  };
}

export function computeMergedMaterialValues(
  material: MaterialRow,
  product: ScrapedShopProduct,
  now: string,
) {
  const locks =
    normalizeMaterialMetadata(material.metadataJson).fieldLocks ?? {};
  const metadataJson = metadataForScrapedProduct(material, product, now);

  return {
    category: applyLockedFillEmptyField(
      locks,
      "category",
      material.category,
      product.category,
    ),
    specText:
      applyLockedFillEmptyField(
        locks,
        "specText",
        material.specText,
        product.specText,
      ) ?? material.specText,
    manufacturer: applyLockedFillEmptyField(
      locks,
      "manufacturer",
      material.manufacturer,
      product.manufacturer,
    ),
    originCountry: applyLockedFillEmptyField(
      locks,
      "originCountry",
      material.originCountry,
      product.originCountry,
    ),
    defaultUnitPrice: applyLockedPriceField(
      locks,
      material.defaultUnitPrice,
      product.price,
    ),
    currency: applyLockedCurrencyField(
      locks,
      material.defaultUnitPrice,
      material.currency,
      product.price,
      product.currency,
    ),
    sourceUrl: applyLockedFillEmptyField(
      locks,
      "sourceUrl",
      material.sourceUrl,
      product.sourceUrl,
    ),
    imageUrl: isFieldLocked(locks, "imageUrl")
      ? material.imageUrl
      : materialImageUrlFromScrape(product.imageUrl),
    metadataJson,
  };
}

export function buildMergePreview(
  material: MaterialRow,
  product: ScrapedShopProduct,
): MergePreviewField[] {
  const now = new Date().toISOString();
  const mergedValues = computeMergedMaterialValues(material, product, now);

  const formatPrice = (value: number | null | undefined, currency: string) =>
    value == null ? "" : `${value.toLocaleString("vi-VN")} ${currency}`;

  const rows: Array<{
    key: string;
    label: string;
    before: string;
    after: string;
  }> = [
    {
      key: "name",
      label: "Tên",
      before: material.name,
      after: material.name,
    },
    {
      key: "unit",
      label: "Đơn vị",
      before: material.unit,
      after: material.unit,
    },
    {
      key: "category",
      label: "Nhóm",
      before: material.category ?? "",
      after: mergedValues.category ?? "",
    },
    {
      key: "specText",
      label: "Thông số",
      before: material.specText,
      after: mergedValues.specText ?? material.specText,
    },
    {
      key: "manufacturer",
      label: "NCC",
      before: material.manufacturer ?? "",
      after: mergedValues.manufacturer ?? "",
    },
    {
      key: "originCountry",
      label: "Xuất xứ",
      before: material.originCountry ?? "",
      after: mergedValues.originCountry ?? "",
    },
    {
      key: "defaultUnitPrice",
      label: "Giá",
      before: formatPrice(material.defaultUnitPrice, material.currency),
      after: formatPrice(
        mergedValues.defaultUnitPrice ?? null,
        mergedValues.currency ?? material.currency,
      ),
    },
    {
      key: "sourceUrl",
      label: "Nguồn",
      before: material.sourceUrl ?? "",
      after: mergedValues.sourceUrl ?? "",
    },
    {
      key: "imageUrl",
      label: "Ảnh",
      before: material.imageUrl ?? "",
      after: mergedValues.imageUrl ?? "",
    },
  ];

  return rows.map((row) => ({
    ...row,
    changed: row.before.trim() !== row.after.trim(),
  }));
}
