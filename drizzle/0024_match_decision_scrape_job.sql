ALTER TABLE "material_match_decisions" ADD COLUMN IF NOT EXISTS "scrape_job_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "material_match_decisions" ADD CONSTRAINT "material_match_decisions_scrape_job_id_shop_scrape_jobs_id_fk" FOREIGN KEY ("scrape_job_id") REFERENCES "public"."shop_scrape_jobs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "material_match_decisions_scrape_job_id_idx" ON "material_match_decisions" USING btree ("scrape_job_id");
