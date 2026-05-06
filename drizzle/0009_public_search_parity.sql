CREATE TYPE "search_mode" AS ENUM ('package_keyword', 'package_location', 'package_area_location', 'plan', 'project');--> statement-breakpoint
ALTER TYPE "watchlist_type" ADD VALUE IF NOT EXISTS 'plan';--> statement-breakpoint
ALTER TYPE "watchlist_type" ADD VALUE IF NOT EXISTS 'project';--> statement-breakpoint
ALTER TYPE "workflow_trigger_type" RENAME TO "workflow_trigger_type_old";--> statement-breakpoint
CREATE TYPE "workflow_trigger_type" AS ENUM ('new_package', 'new_search_result', 'schedule');--> statement-breakpoint
ALTER TABLE "workflows"
	ALTER COLUMN "trigger_type" TYPE "workflow_trigger_type"
	USING "trigger_type"::text::"workflow_trigger_type";--> statement-breakpoint
DROP TYPE "workflow_trigger_type_old";--> statement-breakpoint
CREATE TABLE "tender_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" text DEFAULT '' NOT NULL,
	"title" text NOT NULL,
	"owner" text NOT NULL,
	"province" text NOT NULL,
	"field" text NOT NULL,
	"procurement_method" text NOT NULL,
	"budget" bigint NOT NULL,
	"published_at" text NOT NULL,
	"timeline" text,
	"source_url" text DEFAULT '' NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "tender_plans_external_id_unique" ON "tender_plans" USING btree ("external_id");--> statement-breakpoint
CREATE TABLE "investment_projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" text DEFAULT '' NOT NULL,
	"title" text NOT NULL,
	"owner" text NOT NULL,
	"province" text NOT NULL,
	"project_group" text NOT NULL,
	"investment_budget" bigint NOT NULL,
	"published_at" text NOT NULL,
	"approved_at" text,
	"related_plan_count" integer DEFAULT 0 NOT NULL,
	"source_url" text DEFAULT '' NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "investment_projects_external_id_unique" ON "investment_projects" USING btree ("external_id");--> statement-breakpoint
CREATE TABLE "plan_details_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"source_url" text NOT NULL,
	"cache_key" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "plan_details_cache_cache_key_unique" ON "plan_details_cache" USING btree ("cache_key");--> statement-breakpoint
CREATE INDEX "plan_details_cache_external_id_idx" ON "plan_details_cache" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "plan_details_cache_source_url_idx" ON "plan_details_cache" USING btree ("source_url");--> statement-breakpoint
CREATE INDEX "plan_details_cache_updated_at_idx" ON "plan_details_cache" USING btree ("updated_at");--> statement-breakpoint
CREATE TABLE "project_details_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"source_url" text NOT NULL,
	"cache_key" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "project_details_cache_cache_key_unique" ON "project_details_cache" USING btree ("cache_key");--> statement-breakpoint
CREATE INDEX "project_details_cache_external_id_idx" ON "project_details_cache" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "project_details_cache_source_url_idx" ON "project_details_cache" USING btree ("source_url");--> statement-breakpoint
CREATE INDEX "project_details_cache_updated_at_idx" ON "project_details_cache" USING btree ("updated_at");--> statement-breakpoint
ALTER TABLE "saved_filters" ADD COLUMN "mode" "search_mode" DEFAULT 'package_keyword' NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_filters" ADD COLUMN "criteria_json" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "saved_filters"
SET
	"mode" = 'package_keyword',
	"criteria_json" = jsonb_build_object(
		'keyword', COALESCE("keyword", ''),
		'provinces', COALESCE("provinces", '[]'::jsonb),
		'packageCategories', COALESCE("categories", '[]'::jsonb),
		'classifyIds', '[]'::jsonb,
		'planFields', '[]'::jsonb,
		'procurementMethods', '[]'::jsonb,
		'projectGroups', '[]'::jsonb,
		'budgetMin', to_jsonb("budget_min"),
		'budgetMax', to_jsonb("budget_max"),
		'publishedFrom', '',
		'publishedTo', '',
		'minMatchScore', COALESCE("min_match_score", 0)
	)
WHERE "criteria_json" = '{}'::jsonb;--> statement-breakpoint
UPDATE "workflows"
SET
	"trigger_type" = 'new_search_result',
	"trigger_config" = jsonb_build_object(
		'searchMode', 'package_keyword',
		'criteria', jsonb_build_object(
			'keyword', COALESCE("trigger_config"->>'keyword', ''),
			'provinces', COALESCE("trigger_config"->'provinces', '[]'::jsonb),
			'packageCategories', COALESCE("trigger_config"->'categories', '[]'::jsonb),
			'classifyIds', '[]'::jsonb,
			'planFields', '[]'::jsonb,
			'procurementMethods', '[]'::jsonb,
			'projectGroups', '[]'::jsonb,
			'budgetMin', COALESCE("trigger_config"->'budgetMin', 'null'::jsonb),
			'budgetMax', COALESCE("trigger_config"->'budgetMax', 'null'::jsonb),
			'publishedFrom', '',
			'publishedTo', '',
			'minMatchScore', COALESCE("trigger_config"->'minMatchScore', '0'::jsonb)
		),
		'savedFilterId', COALESCE("trigger_config"->'savedFilterId', 'null'::jsonb),
		'savedFilterName', COALESCE("trigger_config"->'savedFilterName', 'null'::jsonb),
		'notificationFrequency', COALESCE("trigger_config"->'notificationFrequency', 'null'::jsonb)
	)
WHERE "trigger_type" = 'new_package';
