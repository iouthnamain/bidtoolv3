CREATE TABLE "material_profile_promotion_ledger" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL,
  "item_id" integer NOT NULL,
  "source_fingerprint" text NOT NULL,
  "material_id" integer,
  "status" text NOT NULL,
  "resolution_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_profile_search_cache" (
  "id" serial PRIMARY KEY NOT NULL,
  "cache_key" text NOT NULL,
  "payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "excel_workspace_items"
  ADD COLUMN "source_fingerprint" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "excel_workspace_items"
  ADD COLUMN "is_stale" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "material_profile_promotion_ledger"
  ADD CONSTRAINT "material_profile_promotion_ledger_workspace_id_excel_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "public"."excel_workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "material_profile_promotion_ledger"
  ADD CONSTRAINT "material_profile_promotion_ledger_item_id_excel_workspace_items_id_fk"
  FOREIGN KEY ("item_id") REFERENCES "public"."excel_workspace_items"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "material_profile_promotion_ledger"
  ADD CONSTRAINT "material_profile_promotion_ledger_material_id_materials_id_fk"
  FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "material_profile_promotion_ledger_unique"
  ON "material_profile_promotion_ledger" USING btree ("workspace_id", "item_id", "source_fingerprint");
--> statement-breakpoint
CREATE INDEX "material_profile_promotion_ledger_workspace_updated_idx"
  ON "material_profile_promotion_ledger" USING btree ("workspace_id", "updated_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "material_profile_search_cache_key_unique"
  ON "material_profile_search_cache" USING btree ("cache_key");
--> statement-breakpoint
CREATE INDEX "material_profile_search_cache_expiry_idx"
  ON "material_profile_search_cache" USING btree ("expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "excel_workspace_items_source_fingerprint_unique"
  ON "excel_workspace_items" USING btree ("workspace_id", "source_fingerprint")
  WHERE "excel_workspace_items"."source_fingerprint" <> '';
