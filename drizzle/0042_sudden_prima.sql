CREATE TYPE "public"."shop_import_item_status" AS ENUM('processing', 'created', 'updated', 'skipped', 'failed');--> statement-breakpoint
CREATE TABLE "shop_import_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"import_job_id" uuid NOT NULL,
	"product_key" text NOT NULL,
	"source_url" text NOT NULL,
	"product_name" text NOT NULL,
	"status" "shop_import_item_status" NOT NULL,
	"material_id" integer,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shop_import_items" ADD CONSTRAINT "shop_import_items_import_job_id_shop_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."shop_import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_import_items" ADD CONSTRAINT "shop_import_items_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shop_import_items_job_product_unique" ON "shop_import_items" USING btree ("import_job_id","product_key");--> statement-breakpoint
CREATE INDEX "shop_import_items_job_status_idx" ON "shop_import_items" USING btree ("import_job_id","status");