ALTER TABLE "material_match_decisions" ADD COLUMN IF NOT EXISTS "scraped_name" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "material_match_decisions" ADD COLUMN IF NOT EXISTS "scraped_unit" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "material_match_decisions" ADD COLUMN IF NOT EXISTS "scraped_source_url" text DEFAULT '' NOT NULL;
