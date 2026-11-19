ALTER TABLE "material_control_stock_movements" DROP CONSTRAINT "material_control_stock_movements_quantity_positive";--> statement-breakpoint
DROP INDEX "material_control_locations_project_code_unique";--> statement-breakpoint
ALTER TABLE "material_control_stock_movements" ADD COLUMN "explicit_adjustment" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- The previous index allowed duplicate codes for shared locations. Keep each ID
-- so stock, shipments, and child locations continue to reference the same row.
DO $$
DECLARE
  duplicate record;
  replacement text;
  suffix text;
  attempt integer;
BEGIN
  FOR duplicate IN
    SELECT id, code
    FROM (
      SELECT id, code, row_number() OVER (PARTITION BY code ORDER BY id) AS position
      FROM "material_control_locations"
      WHERE project_id IS NULL
    ) AS shared_locations
    WHERE position > 1
    ORDER BY id
  LOOP
    attempt := 0;
    LOOP
      suffix := '-' || duplicate.id::text || CASE WHEN attempt > 0 THEN '-' || attempt::text ELSE '' END;
      replacement := left(duplicate.code, 120 - length(suffix)) || suffix;
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM "material_control_locations"
        WHERE project_id IS NULL AND code = replacement
      );
      attempt := attempt + 1;
    END LOOP;

    UPDATE "material_control_locations" SET code = replacement WHERE id = duplicate.id;
    RAISE NOTICE 'Shared location % code changed from % to %', duplicate.id, duplicate.code, replacement;
  END LOOP;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "material_control_locations_global_code_unique" ON "material_control_locations" USING btree ("code") WHERE "material_control_locations"."project_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "material_control_locations_project_code_unique" ON "material_control_locations" USING btree ("project_id","code") WHERE "material_control_locations"."project_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "material_control_stock_movements" ADD CONSTRAINT "material_control_stock_movements_quantity_positive" CHECK ("material_control_stock_movements"."quantity" > 0 OR ("material_control_stock_movements"."movement_type" = 'adjustment' AND "material_control_stock_movements"."explicit_adjustment" = true AND "material_control_stock_movements"."quantity" <> 0));
