CREATE TABLE "material_enrichment_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"item_id" integer,
	"material_id" integer,
	"field" text NOT NULL,
	"before_value" text,
	"after_value" text,
	"action" text NOT NULL,
	"evidence_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_enrichment_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"material_id" integer NOT NULL,
	"original_snapshot_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"committed_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_enrichment_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"status" "shop_job_status" DEFAULT 'queued' NOT NULL,
	"options_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"material_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"filter_snapshot_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"matched" integer DEFAULT 0 NOT NULL,
	"needs_review" integer DEFAULT 0 NOT NULL,
	"pdfs_found" integer DEFAULT 0 NOT NULL,
	"pdfs_generated" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"current_material_id" integer,
	"current_material_name" text,
	"message" text,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"last_progress_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_web_candidates" (
	"id" serial PRIMARY KEY NOT NULL,
	"enrichment_item_id" integer NOT NULL,
	"material_id" integer NOT NULL,
	"provider" text DEFAULT 'duckduckgo' NOT NULL,
	"query" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"domain" text NOT NULL,
	"snippet" text DEFAULT '' NOT NULL,
	"raw_evidence" text DEFAULT '' NOT NULL,
	"image_url" text,
	"extracted_spec_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"catalog_pdf_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence_score" integer DEFAULT 0 NOT NULL,
	"match_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_selected" boolean DEFAULT false NOT NULL,
	"source_type" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "material_enrichment_events" ADD CONSTRAINT "material_enrichment_events_job_id_material_enrichment_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."material_enrichment_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_enrichment_events" ADD CONSTRAINT "material_enrichment_events_item_id_material_enrichment_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."material_enrichment_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_enrichment_events" ADD CONSTRAINT "material_enrichment_events_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_enrichment_items" ADD CONSTRAINT "material_enrichment_items_job_id_material_enrichment_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."material_enrichment_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_enrichment_items" ADD CONSTRAINT "material_enrichment_items_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_web_candidates" ADD CONSTRAINT "material_web_candidates_enrichment_item_id_material_enrichment_items_id_fk" FOREIGN KEY ("enrichment_item_id") REFERENCES "public"."material_enrichment_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_web_candidates" ADD CONSTRAINT "material_web_candidates_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "material_enrichment_events_job_created_at_idx" ON "material_enrichment_events" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE INDEX "material_enrichment_events_item_idx" ON "material_enrichment_events" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "material_enrichment_items_job_sort_order_idx" ON "material_enrichment_items" USING btree ("job_id","sort_order");--> statement-breakpoint
CREATE INDEX "material_enrichment_items_material_idx" ON "material_enrichment_items" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "material_enrichment_jobs_status_started_at_idx" ON "material_enrichment_jobs" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "material_web_candidates_enrichment_item_idx" ON "material_web_candidates" USING btree ("enrichment_item_id");--> statement-breakpoint
CREATE INDEX "material_web_candidates_material_idx" ON "material_web_candidates" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "material_web_candidates_url_idx" ON "material_web_candidates" USING btree ("url");