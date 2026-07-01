CREATE TABLE IF NOT EXISTS "shop_scrape_job_products" (
  "id" serial PRIMARY KEY NOT NULL,
  "job_id" uuid NOT NULL REFERENCES "shop_scrape_jobs"("id") ON DELETE CASCADE,
  "source_url" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "product_json" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "shop_scrape_job_products_job_id_idx"
  ON "shop_scrape_job_products" ("job_id");

CREATE INDEX IF NOT EXISTS "shop_scrape_job_products_job_order_idx"
  ON "shop_scrape_job_products" ("job_id", "sort_order");

CREATE UNIQUE INDEX IF NOT EXISTS "shop_scrape_job_products_job_source_unique"
  ON "shop_scrape_job_products" ("job_id", "source_url");

INSERT INTO "shop_scrape_job_products" (
  "job_id",
  "source_url",
  "sort_order",
  "product_json"
)
SELECT
  jobs."id",
  product.value->>'sourceUrl',
  (product.ordinality - 1)::integer,
  product.value
FROM "shop_scrape_jobs" jobs
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN jsonb_typeof(jobs."products") = 'array' THEN jobs."products"
    ELSE '[]'::jsonb
  END
) WITH ORDINALITY AS product(value, ordinality)
WHERE product.value ? 'sourceUrl'
  AND nullif(btrim(product.value->>'sourceUrl'), '') IS NOT NULL
ON CONFLICT ("job_id", "source_url") DO UPDATE
SET "sort_order" = EXCLUDED."sort_order",
    "product_json" = EXCLUDED."product_json",
    "updated_at" = now();
