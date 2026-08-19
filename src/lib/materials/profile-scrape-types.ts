import type { FillableField } from "~/lib/materials/excel-enrich-fields";
import type { MaterialEnrichmentEvidence } from "~/lib/materials/material-enrichment-types";

export type ProfileExtraField = "name" | "imageUrl";

export type ScrapedProductReviewDraft = {
  acceptedFields: FillableField[];
  overwriteFields?: FillableField[];
  editedValues?: Partial<Record<FillableField, string>>;
  acceptedProfileFields?: ProfileExtraField[];
  editedProfileValues?: Partial<Record<ProfileExtraField, string>>;
  catalogPdfUrls?: string[];
};

export type ProfileScrapedProduct = {
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
  imageUrl?: string | null;
  sku: string | null;
  model: string | null;
  shopCategory: string | null;
  catalogPdfUrls: string[];
};

export type ScrapedProductStoredResult = {
  productKey: string;
  jobId: string;
  shopScrapeJobId: string | null;
  sourceCandidateKey: string;
  sourceUrl: string;
  sourceScore: number | null;
  product: ProfileScrapedProduct;
  fields: Partial<Record<FillableField, string>>;
  name: string;
  imageUrl?: string;
  evidence: MaterialEnrichmentEvidence[];
  catalogPdfUrls: string[];
  productMatchScore: number | null;
  /** Immutable capture time used when reviewing time-sensitive price evidence. */
  capturedAt?: string;
  reviewDraft?: ScrapedProductReviewDraft;
};

function normalizedProductIdentityText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("vi-VN")
    .replace(/\s+/g, " ");
}

function normalizedProductIdentityUrl(value: string | null | undefined) {
  try {
    const url = new URL((value ?? "").trim());
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    url.username = "";
    url.password = "";
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return (value ?? "").trim().replace(/\/+$/, "");
  }
}

function productIdentityHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Stable identity shared by retained results and live scrape candidates. */
export function scrapedProductKey(
  sourceUrl: string,
  product: Pick<ProfileScrapedProduct, "sourceUrl" | "sku" | "model" | "name">,
) {
  const identity = [
    normalizedProductIdentityUrl(sourceUrl),
    normalizedProductIdentityUrl(product.sourceUrl),
    normalizedProductIdentityText(product.sku),
    normalizedProductIdentityText(product.model),
    normalizedProductIdentityText(product.name),
  ].join("\u0000");
  return `scrape:${productIdentityHash(identity)}`;
}
