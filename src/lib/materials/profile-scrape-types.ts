import type { FillableField } from "~/lib/materials/excel-enrich-fields";
import type { MaterialEnrichmentEvidence } from "~/lib/materials/material-enrichment-types";

export type ProfileExtraField = "name" | "imageUrl";

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
};
