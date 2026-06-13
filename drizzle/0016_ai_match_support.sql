CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS materials_name_trgm_idx
  ON materials USING gin (name gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS "material_match_decisions" (
  "id" serial PRIMARY KEY,
  "scraped_product_hash" text NOT NULL,
  "matched_material_id" integer REFERENCES materials(id) ON DELETE SET NULL,
  "match_method" text NOT NULL DEFAULT 'trigram',
  "confidence" numeric(4,3) NOT NULL,
  "reasoning" text NOT NULL DEFAULT '',
  "candidates_json" jsonb NOT NULL DEFAULT '[]',
  "status" text NOT NULL DEFAULT 'pending',
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX material_match_decisions_hash_unique
  ON material_match_decisions (scraped_product_hash);

CREATE INDEX material_match_decisions_status_idx
  ON material_match_decisions (status);

CREATE INDEX material_match_decisions_material_idx
  ON material_match_decisions (matched_material_id);
