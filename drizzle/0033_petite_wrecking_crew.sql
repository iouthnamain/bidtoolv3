-- Material profile commit audit + trigram indexes for match/list search.
-- Note: drizzle-kit generate also tried to recreate 0030–0032 tables because
-- meta snapshots for those tags are missing; this file is trimmed to the
-- Worker A schema delta only. pg_trgm was enabled in 0016_ai_match_support.sql.

ALTER TABLE "excel_workspace_items" ADD COLUMN IF NOT EXISTS "committed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "excel_workspace_items" ADD COLUMN IF NOT EXISTS "commit_source" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "excel_workspace_items_committed_idx" ON "excel_workspace_items" USING btree ("workspace_id","committed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "materials_spec_text_trgm_idx" ON "materials" USING gin ("spec_text" gin_trgm_ops) WHERE "materials"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "materials_code_trgm_idx" ON "materials" USING gin ("code" gin_trgm_ops) WHERE "materials"."deleted_at" IS NULL AND "materials"."code" IS NOT NULL;
