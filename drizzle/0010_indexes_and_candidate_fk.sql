CREATE INDEX IF NOT EXISTS "saved_filters_mode_idx" ON "saved_filters" USING btree ("mode");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_filters_updated_at_idx" ON "saved_filters" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "watchlist_items_type_idx" ON "watchlist_items" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "watchlist_items_type_ref_key_idx" ON "watchlist_items" USING btree ("type","ref_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflows_is_active_idx" ON "workflows" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflows_trigger_type_idx" ON "workflows" USING btree ("trigger_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_runs_workflow_started_idx" ON "workflow_runs" USING btree ("workflow_id","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_is_read_created_idx" ON "notifications" USING btree ("is_read","created_at");--> statement-breakpoint
UPDATE "excel_workspace_items"
SET "selected_candidate_id" = NULL
WHERE "selected_candidate_id" IS NOT NULL
  AND "selected_candidate_id" NOT IN (SELECT "id" FROM "web_product_candidates");--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'excel_workspace_items_selected_candidate_id_fkey'
  ) THEN
    ALTER TABLE "excel_workspace_items"
      ADD CONSTRAINT "excel_workspace_items_selected_candidate_id_fkey"
      FOREIGN KEY ("selected_candidate_id")
      REFERENCES "web_product_candidates"("id")
      ON DELETE SET NULL;
  END IF;
END$$;
