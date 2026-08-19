CREATE TABLE "material_profile_export_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"revision_number" integer NOT NULL,
	"excel_file_name" text NOT NULL,
	"workbook_base64" text NOT NULL,
	"source_snapshot_json" jsonb NOT NULL,
	"manifest_json" jsonb NOT NULL,
	"warnings_csv" text NOT NULL,
	"summary_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "material_profile_export_revisions" ADD CONSTRAINT "material_profile_export_revisions_workspace_id_excel_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."excel_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "material_profile_export_revisions_workspace_revision_unique" ON "material_profile_export_revisions" USING btree ("workspace_id","revision_number");--> statement-breakpoint
CREATE INDEX "material_profile_export_revisions_workspace_created_at_idx" ON "material_profile_export_revisions" USING btree ("workspace_id","created_at");