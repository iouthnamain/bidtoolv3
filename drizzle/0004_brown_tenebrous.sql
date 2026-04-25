ALTER TYPE "public"."excel_workspace_status" ADD VALUE 'imported' BEFORE 'reviewed';--> statement-breakpoint
ALTER TYPE "public"."excel_workspace_status" ADD VALUE 'mapped' BEFORE 'reviewed';--> statement-breakpoint
ALTER TYPE "public"."excel_workspace_status" ADD VALUE 'matched' BEFORE 'catalog_generated';--> statement-breakpoint
ALTER TYPE "public"."excel_workspace_status" ADD VALUE 'exported' BEFORE 'catalog_generated';--> statement-breakpoint
ALTER TABLE "excel_workspace_items" DROP CONSTRAINT "excel_workspace_items_material_id_materials_id_fk";
--> statement-breakpoint
DROP INDEX "excel_workspace_items_material_idx";--> statement-breakpoint
DROP INDEX "excel_workspace_items_order_idx";--> statement-breakpoint
DROP INDEX "excel_workspaces_lookup_idx";--> statement-breakpoint
ALTER TABLE "excel_workspace_items" ALTER COLUMN "unit" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "excel_workspace_items" ADD COLUMN "original_row_index" integer;--> statement-breakpoint
ALTER TABLE "excel_workspace_items" ADD COLUMN "original_data_json" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "excel_workspace_items" ADD COLUMN "product_name" text;--> statement-breakpoint
ALTER TABLE "excel_workspace_items" ADD COLUMN "spec_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "excel_workspace_items" ADD COLUMN "quantity" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "excel_workspace_items" ADD COLUMN "target_price" bigint;--> statement-breakpoint
ALTER TABLE "excel_workspace_items" ADD COLUMN "currency" text DEFAULT 'VND' NOT NULL;--> statement-breakpoint
ALTER TABLE "excel_workspace_items" ADD COLUMN "vendor_hint" text;--> statement-breakpoint
ALTER TABLE "excel_workspace_items" ADD COLUMN "origin_hint" text;--> statement-breakpoint
ALTER TABLE "excel_workspace_items" ADD COLUMN "notes" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "excel_workspace_items" ADD COLUMN "search_keywords" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "excel_workspace_items" ADD COLUMN "enriched_snapshot_json" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "excel_workspaces" ADD COLUMN "source_file_name" text;--> statement-breakpoint
ALTER TABLE "excel_workspaces" ADD COLUMN "source_sheet_name" text;--> statement-breakpoint
ALTER TABLE "excel_workspaces" ADD COLUMN "row_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "excel_workspaces" ADD COLUMN "column_mapping_json" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "excel_workspaces" ADD COLUMN "workbook_json" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "excel_workspaces" ADD COLUMN "export_file_name" text;--> statement-breakpoint
ALTER TABLE "excel_workspaces" ADD COLUMN "exported_at" timestamp with time zone;--> statement-breakpoint
UPDATE "excel_workspace_items"
SET
  "original_row_index" = "sort_order" + 1,
  "original_data_json" = jsonb_build_object(
    'material_name', "material_name",
    'unit', "unit",
    'qty_total', "qty_total",
    'qty_in_stock', "qty_in_stock",
    'note', "note",
    'requirement_text', "requirement_text"
  ),
  "product_name" = "material_name",
  "spec_text" = coalesce(nullif("requirement_text", ''), "material_name"),
  "quantity" = "qty_total",
  "target_price" = "price_ceiling_vnd",
  "notes" = "note",
  "search_keywords" = "required_keywords",
  "enriched_snapshot_json" = "spec_snapshot_json";--> statement-breakpoint
ALTER TABLE "excel_workspace_items" ALTER COLUMN "original_row_index" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "excel_workspace_items" ALTER COLUMN "product_name" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "excel_workspace_items_match_idx" ON "excel_workspace_items" USING btree ("workspace_id","match_status");--> statement-breakpoint
CREATE INDEX "excel_workspace_items_order_idx" ON "excel_workspace_items" USING btree ("workspace_id","sort_order");--> statement-breakpoint
CREATE INDEX "excel_workspaces_lookup_idx" ON "excel_workspaces" USING btree ("status","updated_at");--> statement-breakpoint
ALTER TABLE "excel_workspace_items" DROP COLUMN "term";--> statement-breakpoint
ALTER TABLE "excel_workspace_items" DROP COLUMN "material_id";--> statement-breakpoint
ALTER TABLE "excel_workspace_items" DROP COLUMN "material_name";--> statement-breakpoint
ALTER TABLE "excel_workspace_items" DROP COLUMN "qty_total";--> statement-breakpoint
ALTER TABLE "excel_workspace_items" DROP COLUMN "qty_in_stock";--> statement-breakpoint
ALTER TABLE "excel_workspace_items" DROP COLUMN "depreciation";--> statement-breakpoint
ALTER TABLE "excel_workspace_items" DROP COLUMN "reuse_pct";--> statement-breakpoint
ALTER TABLE "excel_workspace_items" DROP COLUMN "note";--> statement-breakpoint
ALTER TABLE "excel_workspace_items" DROP COLUMN "requirement_text";--> statement-breakpoint
ALTER TABLE "excel_workspace_items" DROP COLUMN "required_keywords";--> statement-breakpoint
ALTER TABLE "excel_workspace_items" DROP COLUMN "preferred_origin";--> statement-breakpoint
ALTER TABLE "excel_workspace_items" DROP COLUMN "price_ceiling_vnd";--> statement-breakpoint
ALTER TABLE "excel_workspace_items" DROP COLUMN "spec_snapshot_json";--> statement-breakpoint
ALTER TABLE "excel_workspaces" DROP COLUMN "school_year";--> statement-breakpoint
ALTER TABLE "excel_workspaces" DROP COLUMN "campus";--> statement-breakpoint
ALTER TABLE "excel_workspaces" DROP COLUMN "thvt_pdf_url";--> statement-breakpoint
ALTER TABLE "excel_workspaces" DROP COLUMN "request_pdf_url";--> statement-breakpoint
ALTER TABLE "excel_workspaces" DROP COLUMN "locked_at";
