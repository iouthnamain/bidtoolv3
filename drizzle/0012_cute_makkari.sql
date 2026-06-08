DROP INDEX IF EXISTS "materials_code_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "materials_code_unique" ON "materials" USING btree ("code") WHERE "deleted_at" IS NULL;
