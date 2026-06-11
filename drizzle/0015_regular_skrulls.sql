CREATE TYPE "public"."shop_job_status" AS ENUM('queued', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "shop_import_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scrape_job_id" uuid NOT NULL,
	"status" "shop_job_status" DEFAULT 'queued' NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"product_source_urls" jsonb,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_product_name" text,
	"current_source_url" text,
	"error" text,
	"duration_ms" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"last_progress_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_scrape_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"normalized_url" text NOT NULL,
	"status" "shop_job_status" DEFAULT 'queued' NOT NULL,
	"scrape_mode" text DEFAULT 'limited' NOT NULL,
	"max_pages" integer,
	"max_products" integer,
	"method" text DEFAULT 'auto' NOT NULL,
	"detail_enrichment" text DEFAULT 'none' NOT NULL,
	"current_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pages_visited" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failed_pages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"queue_length" integer DEFAULT 0 NOT NULL,
	"product_count" integer DEFAULT 0 NOT NULL,
	"message" text,
	"stop_reason" text,
	"error" text,
	"products" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duration_ms" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"last_progress_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shop_import_jobs" ADD CONSTRAINT "shop_import_jobs_scrape_job_id_shop_scrape_jobs_id_fk" FOREIGN KEY ("scrape_job_id") REFERENCES "public"."shop_scrape_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shop_import_jobs_scrape_job_id_idx" ON "shop_import_jobs" USING btree ("scrape_job_id");--> statement-breakpoint
CREATE INDEX "shop_import_jobs_status_started_at_idx" ON "shop_import_jobs" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "shop_scrape_jobs_status_started_at_idx" ON "shop_scrape_jobs" USING btree ("status","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_scrape_jobs_active_url_unique" ON "shop_scrape_jobs" USING btree ("normalized_url") WHERE "shop_scrape_jobs"."status" in ('queued', 'running');