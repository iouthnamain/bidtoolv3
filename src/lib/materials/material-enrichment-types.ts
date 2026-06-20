/**
 * Client-safe types for the material web-enrichment feature.
 * Keep this module free of server-only imports (DB, fetch, OpenRouter).
 */

import { ENRICH_THRESHOLDS } from "~/lib/materials/excel-enrich-fields";

/**
 * Canonical confidence thresholds live in `excel-enrich-fields.ts` as
 * `ENRICH_THRESHOLDS = { auto, review }`. We re-key them here as
 * `{ high, medium }` so existing consumers keep working while there remains a
 * single source of truth. (env.js holds AI_MATCH_AUTO_THRESHOLD as a
 * separately-configurable runtime copy used by the matcher; it is intentionally
 * not wired here.)
 */
export const ENRICHMENT_THRESHOLDS = {
  high: ENRICH_THRESHOLDS.auto,
  medium: ENRICH_THRESHOLDS.review,
} as const;

export const ENRICHABLE_FIELDS = [
  "category",
  "specText",
  "manufacturer",
  "originCountry",
  "unit",
  "price",
  "sourceUrl",
] as const;

export type EnrichableField = (typeof ENRICHABLE_FIELDS)[number];

export type MaterialEnrichmentConfidenceBand = "auto" | "review" | "skip";

export function classifyEnrichmentConfidence(
  score: number | null | undefined,
): MaterialEnrichmentConfidenceBand {
  if (score != null && score >= ENRICHMENT_THRESHOLDS.high) return "auto";
  if (score != null && score >= ENRICHMENT_THRESHOLDS.medium) return "review";
  return "skip";
}

export type MaterialEnrichmentInput = {
  materialId: number;
  code: string | null;
  name: string;
  unit: string;
  category: string | null;
  specText: string;
  manufacturer: string | null;
  originCountry: string | null;
  defaultUnitPrice: number | null;
  currency: string;
  sourceUrl: string | null;
  sku?: string | null;
  model?: string | null;
};

export type MaterialEnrichmentEvidence = {
  field: string;
  value: string;
  sourceUrl: string;
  snippet: string;
};

export type MaterialEnrichmentFieldResult = {
  value: string | null;
  confidence: number;
  evidence: MaterialEnrichmentEvidence[];
  matchedOption?: string | null;
};

export type MaterialEnrichmentItemStatus =
  | "pending"
  | "processing"
  | "review"
  | "auto"
  | "committed"
  | "rejected"
  | "failed"
  | "skipped";

export type MaterialEnrichmentResult = {
  fields: Partial<Record<EnrichableField, MaterialEnrichmentFieldResult>>;
  catalogPdfUrls: string[];
  overallConfidence: number;
  status: MaterialEnrichmentItemStatus;
  selectedCandidateId?: number | null;
  error?: string | null;
};

export type MaterialEnrichmentFilterOptions = {
  categories: string[];
  manufacturers: string[];
  origins: string[];
  units: string[];
};

export type MaterialEnrichmentJobOptions = {
  autoCommitHighConfidence?: boolean;
  /** Skip enrichment for materials that already have their enrichable fields filled. */
  skipWellFilled?: boolean;
  /** Gate the catalog-PDF attach step (and, in future, PDF generation). */
  generatePdfIfMissing?: boolean;
  model?: string;
  maxSearchResults?: number;
  maxQueries?: number;
  fields?: EnrichableField[];
};
