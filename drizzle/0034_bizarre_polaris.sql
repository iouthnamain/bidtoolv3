CREATE TABLE "material_profile_material_batch_rows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"workspace_item_id" integer NOT NULL,
	"original_row_index" integer NOT NULL,
	"included" boolean DEFAULT true NOT NULL,
	"action" text NOT NULL,
	"target_material_id" integer,
	"target_score" numeric(5, 4),
	"target_method" text,
	"expected_target_updated_at" timestamp with time zone,
	"proposed_material_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pre_commit_material_snapshot_json" jsonb,
	"pre_commit_catalog_links_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"post_commit_version" timestamp with time zone,
	"previous_workspace_item_state_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warnings_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"winner_row_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_profile_material_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"source_scrape_job_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"overwrite_scope" text DEFAULT 'all' NOT NULL,
	"target_threshold" numeric(4, 3) DEFAULT 0.85 NOT NULL,
	"target_margin" numeric(4, 3) DEFAULT 0.05 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"create_count" integer DEFAULT 0 NOT NULL,
	"update_count" integer DEFAULT 0 NOT NULL,
	"link_only_count" integer DEFAULT 0 NOT NULL,
	"excluded_count" integer DEFAULT 0 NOT NULL,
	"blocked_count" integer DEFAULT 0 NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"message" text,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_profile_scrape_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"requested_item_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_threshold" numeric(4, 3) DEFAULT 0.75 NOT NULL,
	"source_margin" numeric(4, 3) DEFAULT 0.05 NOT NULL,
	"max_products_per_source" integer DEFAULT 8 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"captured" integer DEFAULT 0 NOT NULL,
	"needs_review" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"current_item_id" integer,
	"current_row_index" integer,
	"current_product_name" text,
	"message" text,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"last_progress_at" timestamp with time zone,
	"progress_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_profile_scrape_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"workspace_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"original_row_index" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"source_candidate_key" text,
	"source_url" text,
	"source_kind" text,
	"source_score" numeric(5, 4),
	"shop_scrape_job_id" uuid,
	"input_snapshot_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_fingerprint" text DEFAULT '' NOT NULL,
	"scraped_product_candidates_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"selected_product_json" jsonb,
	"warnings_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "material_profile_material_batch_rows" ADD CONSTRAINT "material_profile_material_batch_rows_batch_id_material_profile_material_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."material_profile_material_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_profile_material_batch_rows" ADD CONSTRAINT "material_profile_material_batch_rows_workspace_item_id_excel_workspace_items_id_fk" FOREIGN KEY ("workspace_item_id") REFERENCES "public"."excel_workspace_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_profile_material_batch_rows" ADD CONSTRAINT "material_profile_material_batch_rows_target_material_id_materials_id_fk" FOREIGN KEY ("target_material_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_profile_material_batch_rows" ADD CONSTRAINT "material_profile_material_batch_rows_winner_row_id_material_profile_material_batch_rows_id_fk" FOREIGN KEY ("winner_row_id") REFERENCES "public"."material_profile_material_batch_rows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_profile_material_batches" ADD CONSTRAINT "material_profile_material_batches_workspace_id_excel_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."excel_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_profile_material_batches" ADD CONSTRAINT "material_profile_material_batches_source_scrape_job_id_material_profile_scrape_jobs_id_fk" FOREIGN KEY ("source_scrape_job_id") REFERENCES "public"."material_profile_scrape_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_profile_scrape_jobs" ADD CONSTRAINT "material_profile_scrape_jobs_workspace_id_excel_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."excel_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_profile_scrape_jobs" ADD CONSTRAINT "material_profile_scrape_jobs_current_item_id_excel_workspace_items_id_fk" FOREIGN KEY ("current_item_id") REFERENCES "public"."excel_workspace_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_profile_scrape_runs" ADD CONSTRAINT "material_profile_scrape_runs_job_id_material_profile_scrape_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."material_profile_scrape_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_profile_scrape_runs" ADD CONSTRAINT "material_profile_scrape_runs_workspace_id_excel_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."excel_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_profile_scrape_runs" ADD CONSTRAINT "material_profile_scrape_runs_item_id_excel_workspace_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."excel_workspace_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_profile_scrape_runs" ADD CONSTRAINT "material_profile_scrape_runs_shop_scrape_job_id_shop_scrape_jobs_id_fk" FOREIGN KEY ("shop_scrape_job_id") REFERENCES "public"."shop_scrape_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "material_profile_material_batch_rows_batch_item_unique" ON "material_profile_material_batch_rows" USING btree ("batch_id","workspace_item_id");--> statement-breakpoint
CREATE INDEX "material_profile_material_batch_rows_batch_row_idx" ON "material_profile_material_batch_rows" USING btree ("batch_id","original_row_index");--> statement-breakpoint
CREATE INDEX "material_profile_material_batch_rows_target_idx" ON "material_profile_material_batch_rows" USING btree ("target_material_id");--> statement-breakpoint
CREATE INDEX "material_profile_material_batches_workspace_updated_at_idx" ON "material_profile_material_batches" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "material_profile_material_batches_status_expiry_idx" ON "material_profile_material_batches" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "material_profile_scrape_jobs_workspace_updated_at_idx" ON "material_profile_scrape_jobs" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "material_profile_scrape_jobs_status_updated_at_idx" ON "material_profile_scrape_jobs" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "material_profile_scrape_runs_job_item_unique" ON "material_profile_scrape_runs" USING btree ("job_id","item_id");--> statement-breakpoint
CREATE INDEX "material_profile_scrape_runs_workspace_item_history_idx" ON "material_profile_scrape_runs" USING btree ("workspace_id","item_id","updated_at");--> statement-breakpoint
CREATE INDEX "material_profile_scrape_runs_job_sort_order_idx" ON "material_profile_scrape_runs" USING btree ("job_id","sort_order");--> statement-breakpoint
CREATE INDEX "material_profile_scrape_runs_status_updated_at_idx" ON "material_profile_scrape_runs" USING btree ("status","updated_at");