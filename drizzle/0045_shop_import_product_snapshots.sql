CREATE TABLE "shop_import_job_products" (
	"import_job_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"product_json" jsonb NOT NULL,
	CONSTRAINT "shop_import_job_products_import_job_id_sort_order_pk" PRIMARY KEY("import_job_id","sort_order")
);
--> statement-breakpoint
ALTER TABLE "shop_import_job_products" ADD CONSTRAINT "shop_import_job_products_import_job_id_shop_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."shop_import_jobs"("id") ON DELETE cascade ON UPDATE no action;