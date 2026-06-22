import { isShopPromoBadgeText } from "~/lib/materials/shop-promo-badges";

export type ScrapeProductQualityInput = {
  name: string;
  unit: string | null;
  category: string | null;
  specText: string;
  manufacturer: string | null;
  originCountry: string | null;
  price: number | null;
  catalogPdfUrls?: readonly string[];
};

export type ScrapeQualityFlag =
  | "missingPrice"
  | "missingName"
  | "suspiciousName"
  | "missingNcc"
  | "missingOrigin"
  | "missingSpec"
  | "missingUnit"
  | "hasPdf";

export function missingPrice(product: ScrapeProductQualityInput) {
  return product.price == null;
}

export function missingName(product: ScrapeProductQualityInput) {
  return !product.name.trim();
}

export function suspiciousName(product: ScrapeProductQualityInput) {
  const name = product.name.trim();
  if (!name) {
    return false;
  }
  return isShopPromoBadgeText(name);
}

export function missingNcc(product: ScrapeProductQualityInput) {
  return !product.manufacturer?.trim();
}

export function missingOrigin(product: ScrapeProductQualityInput) {
  return !product.originCountry?.trim();
}

export function missingSpec(product: ScrapeProductQualityInput) {
  return !product.specText.trim();
}

export function missingUnit(product: ScrapeProductQualityInput) {
  return !product.unit?.trim();
}

export function hasPdf(product: ScrapeProductQualityInput) {
  return (product.catalogPdfUrls?.length ?? 0) > 0;
}

export function qualityFlags(
  product: ScrapeProductQualityInput,
): ScrapeQualityFlag[] {
  const flags: ScrapeQualityFlag[] = [];
  if (missingPrice(product)) flags.push("missingPrice");
  if (missingName(product)) flags.push("missingName");
  if (suspiciousName(product)) flags.push("suspiciousName");
  if (missingNcc(product)) flags.push("missingNcc");
  if (missingOrigin(product)) flags.push("missingOrigin");
  if (missingSpec(product)) flags.push("missingSpec");
  if (missingUnit(product)) flags.push("missingUnit");
  if (hasPdf(product)) flags.push("hasPdf");
  return flags;
}

export const SCRAPE_QUALITY_FLAG_LABELS: Record<ScrapeQualityFlag, string> = {
  missingPrice: "Thiếu giá",
  missingName: "Thiếu tên",
  suspiciousName: "Tên nghi vấn",
  missingNcc: "Thiếu NCC",
  missingOrigin: "Thiếu xuất xứ",
  missingSpec: "Thiếu thông số",
  missingUnit: "Thiếu ĐVT",
  hasPdf: "Có PDF",
};

export type ScrapeProductQualityFilter =
  | "all"
  | ScrapeQualityFlag;

export function matchesQualityFilter(
  product: ScrapeProductQualityInput,
  filter: ScrapeProductQualityFilter,
  options?: { hideMissingName?: boolean },
) {
  if (options?.hideMissingName && missingName(product)) {
    return false;
  }
  if (filter === "all") {
    return true;
  }
  switch (filter) {
    case "missingPrice":
      return missingPrice(product);
    case "missingName":
      return missingName(product);
    case "suspiciousName":
      return suspiciousName(product);
    case "missingNcc":
      return missingNcc(product);
    case "missingOrigin":
      return missingOrigin(product);
    case "missingSpec":
      return missingSpec(product);
    case "hasPdf":
      return hasPdf(product);
    case "missingUnit":
      return missingUnit(product);
    default:
      return true;
  }
}
