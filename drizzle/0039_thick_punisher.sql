CREATE TABLE "material_search_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"material_signature" text NOT NULL,
	"normalized_url" text NOT NULL,
	"domain" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"source_feature" text DEFAULT 'profile_search' NOT NULL,
	"workspace_id" integer,
	"item_id" integer,
	"rejected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"restored_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "search_audit_logs" ADD COLUMN "quality_summary_json" jsonb DEFAULT 'null'::jsonb;--> statement-breakpoint
ALTER TABLE "material_search_feedback" ADD CONSTRAINT "material_search_feedback_workspace_id_excel_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."excel_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_search_feedback" ADD CONSTRAINT "material_search_feedback_item_id_excel_workspace_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."excel_workspace_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "material_search_feedback_signature_url_unique" ON "material_search_feedback" USING btree ("material_signature","normalized_url");--> statement-breakpoint
CREATE INDEX "material_search_feedback_signature_restored_idx" ON "material_search_feedback" USING btree ("material_signature","restored_at");--> statement-breakpoint
CREATE INDEX "material_search_feedback_rejected_at_idx" ON "material_search_feedback" USING btree ("rejected_at");--> statement-breakpoint
CREATE INDEX "material_search_feedback_domain_idx" ON "material_search_feedback" USING btree ("domain");