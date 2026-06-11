CREATE TYPE "public"."catalog_document_link_source" AS ENUM('manual', 'scrape', 'import');--> statement-breakpoint
CREATE TYPE "public"."catalog_document_source_type" AS ENUM('uploaded', 'detected', 'manual_url');--> statement-breakpoint
CREATE TABLE "material_catalog_document_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"material_id" integer NOT NULL,
	"link_source" "catalog_document_link_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_catalog_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"supplier" text,
	"source_url" text,
	"normalized_source_url" text DEFAULT '' NOT NULL,
	"local_file_path" text,
	"file_name" text,
	"file_size" bigint,
	"mime_type" text,
	"checksum" text,
	"source_type" "catalog_document_source_type" DEFAULT 'manual_url' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"tags_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "material_catalog_document_links" ADD CONSTRAINT "material_catalog_document_links_document_id_material_catalog_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."material_catalog_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_catalog_document_links" ADD CONSTRAINT "material_catalog_document_links_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "material_catalog_document_links_unique" ON "material_catalog_document_links" USING btree ("document_id","material_id");--> statement-breakpoint
CREATE INDEX "material_catalog_document_links_material_idx" ON "material_catalog_document_links" USING btree ("material_id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_catalog_documents_source_url_unique" ON "material_catalog_documents" USING btree ("normalized_source_url") WHERE "material_catalog_documents"."deleted_at" IS NULL AND "material_catalog_documents"."normalized_source_url" <> '';--> statement-breakpoint
CREATE INDEX "material_catalog_documents_title_idx" ON "material_catalog_documents" USING btree ("title");