CREATE TABLE IF NOT EXISTS "search_audit_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "feature" text NOT NULL,
  "provider" text DEFAULT 'searxng' NOT NULL,
  "query" text NOT NULL,
  "normalized_query" text NOT NULL,
  "engines" text DEFAULT '' NOT NULL,
  "language" text DEFAULT 'vi-VN' NOT NULL,
  "result_count" integer DEFAULT 0 NOT NULL,
  "selected_result_count" integer DEFAULT 0 NOT NULL,
  "duration_ms" integer DEFAULT 0 NOT NULL,
  "status" text NOT NULL,
  "warning_text" text DEFAULT '' NOT NULL,
  "error_text" text DEFAULT '' NOT NULL,
  "top_results_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "ranking_policy_json" jsonb DEFAULT '{"boostDomains":[],"penaltyDomains":[],"blockDomains":[]}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_audit_logs_created_at_idx" ON "search_audit_logs" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_audit_logs_feature_created_at_idx" ON "search_audit_logs" USING btree ("feature","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_audit_logs_status_created_at_idx" ON "search_audit_logs" USING btree ("status","created_at");
--> statement-breakpoint
ALTER TABLE "material_web_candidates" ALTER COLUMN "provider" SET DEFAULT 'searxng';
