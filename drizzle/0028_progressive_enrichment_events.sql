ALTER TABLE "excel_workspace_items"
  ADD COLUMN IF NOT EXISTS "enrichment_status" text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS "web_results_json" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "ai_fields_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "ai_evidence_json" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "enrichment_updated_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "excel_workspace_items_enrichment_idx"
  ON "excel_workspace_items" ("workspace_id", "enrichment_status", "enrichment_updated_at");

CREATE TABLE IF NOT EXISTS "material_enrichment_job_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "job_id" uuid NOT NULL,
  "item_id" integer,
  "event_type" text NOT NULL,
  "item_status" text,
  "payload_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "material_enrichment_job_events_job_id_material_enrichment_jobs_id_fk"
    FOREIGN KEY ("job_id") REFERENCES "material_enrichment_jobs"("id") ON DELETE cascade,
  CONSTRAINT "material_enrichment_job_events_item_id_material_enrichment_items_id_fk"
    FOREIGN KEY ("item_id") REFERENCES "material_enrichment_items"("id") ON DELETE cascade
);

CREATE INDEX IF NOT EXISTS "material_enrichment_job_events_job_id_idx"
  ON "material_enrichment_job_events" ("job_id", "id");

CREATE INDEX IF NOT EXISTS "material_enrichment_job_events_item_id_idx"
  ON "material_enrichment_job_events" ("item_id");
