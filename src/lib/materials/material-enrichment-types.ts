/**
 * Client-safe types for the material web-enrichment feature.
 * Keep this module free of server-only imports (DB, fetch, OpenRouter).
 */

export const ENRICHMENT_THRESHOLDS = {
  high: 0.85,
  medium: 0.5,
} as const;

export const ENRICHABLE_FIELDS = [
  "category",
  "specText",
  "manufacturer",
  "originCountry",
  "unit",
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
  model?: string;
  maxSearchResults?: number;
  maxQueries?: number;
  fields?: EnrichableField[];
};
