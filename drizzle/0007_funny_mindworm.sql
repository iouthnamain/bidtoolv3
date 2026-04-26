ALTER TABLE "saved_filters" ADD COLUMN "min_match_score" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tender_packages" ADD COLUMN "external_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "tender_packages" ADD COLUMN "closing_at" text;--> statement-breakpoint
ALTER TABLE "tender_packages" ADD COLUMN "source_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE "tender_packages" SET "external_id" = 'legacy-' || "id"::text WHERE "external_id" = '';--> statement-breakpoint
CREATE UNIQUE INDEX "tender_packages_external_id_unique" ON "tender_packages" USING btree ("external_id");
