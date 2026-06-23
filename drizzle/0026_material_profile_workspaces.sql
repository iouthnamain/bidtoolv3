ALTER TABLE "excel_workspaces" ADD COLUMN IF NOT EXISTS "notice_number" text;--> statement-breakpoint
ALTER TABLE "excel_workspaces" ADD COLUMN IF NOT EXISTS "source_workbook_path" text;--> statement-breakpoint
ALTER TABLE "excel_workspaces" ADD COLUMN IF NOT EXISTS "edit_state_json" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "excel_workspaces" ADD COLUMN IF NOT EXISTS "output_dir_path" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "excel_workspaces_notice_number_idx" ON "excel_workspaces" USING btree ("notice_number");
