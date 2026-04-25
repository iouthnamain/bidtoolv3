CREATE TYPE "public"."excel_workspace_status" AS ENUM('draft', 'reviewed', 'catalog_generated', 'checked', 'approved');--> statement-breakpoint
CREATE TYPE "public"."product_match_status" AS ENUM('unmatched', 'candidates_found', 'matched', 'manual');--> statement-breakpoint
CREATE TYPE "public"."school_campus" AS ENUM('cs2', 'cs3');--> statement-breakpoint
CREATE TYPE "public"."school_term" AS ENUM('hk1', 'hk2');--> statement-breakpoint
CREATE TABLE "excel_workspace_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"event" text NOT NULL,
	"actor" text DEFAULT 'system' NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "excel_workspace_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"term" "school_term" NOT NULL,
	"material_id" integer,
	"material_name" text NOT NULL,
	"unit" text NOT NULL,
	"qty_total" integer DEFAULT 0 NOT NULL,
	"qty_in_stock" integer DEFAULT 0 NOT NULL,
	"depreciation" numeric(10, 2) DEFAULT 1 NOT NULL,
	"reuse_pct" integer DEFAULT 0 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"requirement_text" text DEFAULT '' NOT NULL,
	"required_keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferred_origin" text,
	"price_ceiling_vnd" bigint,
	"selected_candidate_id" integer,
	"spec_snapshot_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"match_status" "product_match_status" DEFAULT 'unmatched' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "excel_workspaces" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"school_year" text NOT NULL,
	"campus" "school_campus" NOT NULL,
	"status" "excel_workspace_status" DEFAULT 'draft' NOT NULL,
	"thvt_pdf_url" text,
	"request_pdf_url" text,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"category" text,
	"default_depreciation" numeric(10, 2) DEFAULT 1 NOT NULL,
	"default_reuse_pct" integer DEFAULT 0 NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "web_product_candidates" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_item_id" integer NOT NULL,
	"provider" text DEFAULT 'tavily' NOT NULL,
	"query" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"domain" text NOT NULL,
	"snippet" text DEFAULT '' NOT NULL,
	"raw_evidence" text DEFAULT '' NOT NULL,
	"image_url" text,
	"extracted_spec_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence_score" integer DEFAULT 0 NOT NULL,
	"tavily_score" numeric(8, 4),
	"match_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_selected" boolean DEFAULT false NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "excel_workspace_events" ADD CONSTRAINT "excel_workspace_events_workspace_id_excel_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."excel_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excel_workspace_items" ADD CONSTRAINT "excel_workspace_items_workspace_id_excel_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."excel_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excel_workspace_items" ADD CONSTRAINT "excel_workspace_items_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_product_candidates" ADD CONSTRAINT "web_product_candidates_workspace_item_id_excel_workspace_items_id_fk" FOREIGN KEY ("workspace_item_id") REFERENCES "public"."excel_workspace_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "excel_workspace_events_timeline_idx" ON "excel_workspace_events" USING btree ("workspace_id","at");--> statement-breakpoint
CREATE INDEX "excel_workspace_items_order_idx" ON "excel_workspace_items" USING btree ("workspace_id","term","sort_order");--> statement-breakpoint
CREATE INDEX "excel_workspace_items_material_idx" ON "excel_workspace_items" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "excel_workspaces_lookup_idx" ON "excel_workspaces" USING btree ("school_year","campus","status");--> statement-breakpoint
CREATE UNIQUE INDEX "materials_code_unique" ON "materials" USING btree ("code");--> statement-breakpoint
CREATE INDEX "materials_name_idx" ON "materials" USING btree ("name");--> statement-breakpoint
CREATE INDEX "materials_category_idx" ON "materials" USING btree ("category");--> statement-breakpoint
CREATE INDEX "web_product_candidates_item_idx" ON "web_product_candidates" USING btree ("workspace_item_id");--> statement-breakpoint
CREATE INDEX "web_product_candidates_url_idx" ON "web_product_candidates" USING btree ("url");