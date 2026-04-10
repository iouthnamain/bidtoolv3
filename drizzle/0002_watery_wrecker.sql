CREATE TABLE "package_details_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"source_url" text NOT NULL,
	"cache_key" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "package_details_cache_cache_key_unique" ON "package_details_cache" USING btree ("cache_key");--> statement-breakpoint
CREATE INDEX "package_details_cache_external_id_idx" ON "package_details_cache" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "package_details_cache_source_url_idx" ON "package_details_cache" USING btree ("source_url");--> statement-breakpoint
CREATE INDEX "package_details_cache_updated_at_idx" ON "package_details_cache" USING btree ("updated_at");