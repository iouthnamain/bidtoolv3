import { z } from "zod";

import {
  ENRICH_THRESHOLDS,
  FILLABLE_FIELDS,
  type FillableField,
} from "~/lib/materials/excel-enrich-fields";

export class ExcelResearchJobError extends Error {
  constructor(
    public readonly code: "BAD_REQUEST" | "CONFLICT" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "ExcelResearchJobError";
  }
}

export type ExcelResearchJobStatus =
  | "draft"
  | "queued"
  | "running"
  | "paused"
  | "awaiting_review"
  | "exporting"
  | "completed"
  | "failed"
  | "cancelled";

export type ExcelResearchRowStatus =
  | "pending"
  | "processing"
  | "matched"
  | "needs_review"
  | "approved"
  | "skipped"
  | "error";

export const excelResearchJobConfigSchema = z.object({
  minSimilarity: z.number().min(0).max(1).default(0.1),
  candidateLimit: z.number().int().min(1).max(20).default(8),
  autoThreshold: z.number().min(0).max(1).default(ENRICH_THRESHOLDS.auto),
  reviewThreshold: z.number().min(0).max(1).default(ENRICH_THRESHOLDS.review),
  batchSize: z.number().int().min(1).max(50).default(10),
  enableWebSearch: z.boolean().default(true),
});

export type ExcelResearchJobConfig = z.infer<
  typeof excelResearchJobConfigSchema
>;

export const DEFAULT_EXCEL_RESEARCH_CONFIG: ExcelResearchJobConfig =
  excelResearchJobConfigSchema.parse({});

export type FieldEvidence = {
  field: string;
  value: string;
  source_url: string;
  source_type: string;
  confidence: number;
  note: string;
};

export type RowResearchResult = {
  row_number: number;
  status: "matched" | "partial_match" | "needs_review" | "failed";
  input_product_data: Record<string, string>;
  matched_product: {
    name: string;
    brand: string;
    model: string;
    sku: string;
    category: string;
    material_id: number | null;
    source: "catalog" | "web";
  } | null;
  matched_fields: Partial<Record<FillableField, string>>;
  accepted_fields: FillableField[];
  catalog_pdf_url: string;
  source_urls: string[];
  evidence: FieldEvidence[];
  confidence_score: number;
  needs_review: boolean;
  review_reason: string;
};

export const MAX_EXCEL_RESEARCH_ROWS = 2000;

export const fieldEvidenceSchema = z.object({
  field: z.string(),
  value: z.string(),
  source_url: z.string(),
  source_type: z.string(),
  confidence: z.number(),
  note: z.string(),
});

export const rowResearchResultSchema = z.object({
  row_number: z.number().int(),
  status: z.enum(["matched", "partial_match", "needs_review", "failed"]),
  input_product_data: z.record(z.string(), z.string()),
  matched_product: z
    .object({
      name: z.string(),
      brand: z.string(),
      model: z.string(),
      sku: z.string(),
      category: z.string(),
      material_id: z.number().int().nullable(),
      source: z.enum(["catalog", "web"]),
    })
    .nullable(),
  matched_fields: z.record(z.string(), z.string()),
  accepted_fields: z.array(z.enum(FILLABLE_FIELDS)),
  catalog_pdf_url: z.string(),
  source_urls: z.array(z.string()),
  evidence: z.array(fieldEvidenceSchema),
  confidence_score: z.number(),
  needs_review: z.boolean(),
  review_reason: z.string(),
});
