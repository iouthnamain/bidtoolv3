DROP INDEX IF EXISTS "shop_scrape_jobs_active_url_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "shop_scrape_jobs_active_tenant_url_unique" ON "shop_scrape_jobs" USING btree ("tenant_id","normalized_url") WHERE "shop_scrape_jobs"."status" in ('queued', 'running');
