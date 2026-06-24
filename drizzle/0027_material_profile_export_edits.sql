ALTER TABLE "excel_workspaces" ADD COLUMN IF NOT EXISTS "export_edit_state_json" jsonb DEFAULT '{}'::jsonb NOT NULL;
