CREATE TYPE "public"."excel_research_job_status" AS ENUM('draft', 'queued', 'running', 'paused', 'awaiting_review', 'exporting', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."excel_research_row_status" AS ENUM('pending', 'processing', 'matched', 'needs_review', 'approved', 'skipped', 'error');--> statement-breakpoint
CREATE TYPE "public"."excel_research_evidence_type" AS ENUM('catalog_match', 'web_search', 'page_scrape', 'pdf_found', 'pdf_generated', 'ai_extraction');--> statement-breakpoint
CREATE TYPE "public"."excel_research_artifact_kind" AS ENUM('original_xlsx', 'enriched_xlsx', 'review_report_json', 'review_report_xlsx', 'export_zip', 'pdf_found', 'pdf_generated');--> statement-breakpoint
CREATE TABLE "excel_research_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" "excel_research_job_status" DEFAULT 'draft' NOT NULL,
	"source_file_name" text NOT NULL,
	"sheet_name" text NOT NULL,
	"header_row_index" integer NOT NULL,
	"column_mapping_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"processed_rows" integer DEFAULT 0 NOT NULL,
	"matched_rows" integer DEFAULT 0 NOT NULL,
	"needs_review_rows" integer DEFAULT 0 NOT NULL,
	"error_rows" integer DEFAULT 0 NOT NULL,
	"pdfs_found_count" integer DEFAULT 0 NOT NULL,
	"pdfs_generated_count" integer DEFAULT 0 NOT NULL,
	"current_batch_id" uuid,
	"message" text,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"last_progress_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "excel_research_job_rows" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"status" "excel_research_row_status" DEFAULT 'pending' NOT NULL,
	"product_name" text NOT NULL,
	"input_fields_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"original_cells_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"matched_material_id" integer,
	"selected_candidate_id" integer,
	"confidence_score" numeric(4, 3),
	"fill_plan_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"excel_updates_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_message" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"processing_token" uuid,
	"processing_started_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "excel_research_row_evidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_row_id" integer NOT NULL,
	"evidence_type" "excel_research_evidence_type" NOT NULL,
	"provider" text DEFAULT '' NOT NULL,
	"query" text,
	"title" text,
	"url" text,
	"domain" text,
	"snippet" text,
	"raw_evidence" text,
	"image_url" text,
	"material_id" integer,
	"extracted_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence_score" integer,
	"match_reasons_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_selected" boolean DEFAULT false NOT NULL,
	"artifact_id" integer,
	"fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "excel_research_file_artifacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"job_row_id" integer,
	"kind" "excel_research_artifact_kind" NOT NULL,
	"local_file_path" text NOT NULL,
	"file_name" text NOT NULL,
	"file_size" bigint,
	"mime_type" text,
	"checksum" text,
	"source_url" text,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "excel_research_change_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"job_row_id" integer,
	"row_number" integer,
	"event" text NOT NULL,
	"actor" text DEFAULT 'system' NOT NULL,
	"field" text,
	"before" text,
	"after" text,
	"action" text,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "excel_research_job_rows" ADD CONSTRAINT "excel_research_job_rows_job_id_excel_research_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."excel_research_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excel_research_job_rows" ADD CONSTRAINT "excel_research_job_rows_matched_material_id_materials_id_fk" FOREIGN KEY ("matched_material_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excel_research_row_evidence" ADD CONSTRAINT "excel_research_row_evidence_job_row_id_excel_research_job_rows_id_fk" FOREIGN KEY ("job_row_id") REFERENCES "public"."excel_research_job_rows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excel_research_row_evidence" ADD CONSTRAINT "excel_research_row_evidence_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excel_research_file_artifacts" ADD CONSTRAINT "excel_research_file_artifacts_job_id_excel_research_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."excel_research_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excel_research_file_artifacts" ADD CONSTRAINT "excel_research_file_artifacts_job_row_id_excel_research_job_rows_id_fk" FOREIGN KEY ("job_row_id") REFERENCES "public"."excel_research_job_rows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excel_research_change_log" ADD CONSTRAINT "excel_research_change_log_job_id_excel_research_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."excel_research_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excel_research_change_log" ADD CONSTRAINT "excel_research_change_log_job_row_id_excel_research_job_rows_id_fk" FOREIGN KEY ("job_row_id") REFERENCES "public"."excel_research_job_rows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "excel_research_job_rows_job_row_unique" ON "excel_research_job_rows" USING btree ("job_id","row_number");--> statement-breakpoint
CREATE INDEX "excel_research_job_rows_job_status_idx" ON "excel_research_job_rows" USING btree ("job_id","status");--> statement-breakpoint
CREATE INDEX "excel_research_row_evidence_job_row_idx" ON "excel_research_row_evidence" USING btree ("job_row_id");--> statement-breakpoint
CREATE INDEX "excel_research_file_artifacts_job_kind_idx" ON "excel_research_file_artifacts" USING btree ("job_id","kind");--> statement-breakpoint
CREATE INDEX "excel_research_change_log_job_at_idx" ON "excel_research_change_log" USING btree ("job_id","at");--> statement-breakpoint
CREATE INDEX "excel_research_jobs_status_started_at_idx" ON "excel_research_jobs" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "excel_research_jobs_updated_at_idx" ON "excel_research_jobs" USING btree ("updated_at");
