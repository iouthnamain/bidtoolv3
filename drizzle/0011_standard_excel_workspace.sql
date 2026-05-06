ALTER TABLE "excel_workspaces" ADD COLUMN IF NOT EXISTS "template_config_json" jsonb DEFAULT '{
  "organizationLine1": "UBND TỈNH ĐỒNG NAI",
  "organizationLine2": "TRƯỜNG CAO ĐẲNG KỸ THUẬT - CÔNG NGHỆ ĐỒNG NAI",
  "departmentLine": "KHOA / PHÒNG BAN",
  "rightHeaderLine1": "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM",
  "rightHeaderLine2": "Độc lập - Tự do - Hạnh phúc",
  "schoolYearLabel": "Năm học 2026 - 2027",
  "siteLabel": "Cơ sở",
  "thvtTitle": "BẢNG TỔNG HỢP VẬT TƯ THỰC HÀNH",
  "purchaseRequestTitle": "BẢNG ĐỀ NGHỊ MUA VẬT TƯ THỰC HÀNH",
  "inspectionTitle": "BIÊN BẢN KIỂM TRA VẬT TƯ THỰC HÀNH CUỐI HỌC KỲ",
  "requestRecipients": ["Ban Giám hiệu", "Phòng Đào tạo", "Phòng TCKT"],
  "basisParagraphs": [
    "Căn cứ vào kế hoạch giảng dạy, định mức vật tư và nhu cầu thực hành.",
    "Căn cứ vào số lượng máy móc, trang thiết bị hiện có tại đơn vị.",
    "Đơn vị kính đề nghị mua các vật tư phục vụ công tác đào tạo theo bảng dưới đây."
  ],
  "signerLabels": ["Người lập", "Đơn vị", "Phòng vật tư", "Hiệu trưởng"]
}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "excel_workspaces" ADD COLUMN IF NOT EXISTS "selected_sheet_template_ids" jsonb DEFAULT '["thvt","purchase_request","inspection_term_1","inspection_term_2","evidence"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "spec_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "manufacturer" text;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "origin_country" text;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "default_unit_price" bigint;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "currency" text DEFAULT 'VND' NOT NULL;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "source_url" text;--> statement-breakpoint
ALTER TABLE "excel_workspace_items" ADD COLUMN IF NOT EXISTS "material_id" integer;--> statement-breakpoint
ALTER TABLE "excel_workspace_items" ADD COLUMN IF NOT EXISTS "term" text DEFAULT 'term_1' NOT NULL;--> statement-breakpoint
ALTER TABLE "excel_workspace_items" ADD COLUMN IF NOT EXISTS "qty_total" numeric(12,2);--> statement-breakpoint
ALTER TABLE "excel_workspace_items" ADD COLUMN IF NOT EXISTS "qty_in_stock" numeric(12,2);--> statement-breakpoint
ALTER TABLE "excel_workspace_items" ADD COLUMN IF NOT EXISTS "depreciation" numeric(10,2) DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "excel_workspace_items" ADD COLUMN IF NOT EXISTS "reuse_pct" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "excel_workspace_items" ADD COLUMN IF NOT EXISTS "inspection_qty_term_1" numeric(12,2);--> statement-breakpoint
ALTER TABLE "excel_workspace_items" ADD COLUMN IF NOT EXISTS "inspection_qty_term_2" numeric(12,2);--> statement-breakpoint
ALTER TABLE "excel_workspace_items" ADD COLUMN IF NOT EXISTS "unit_price" bigint;--> statement-breakpoint
ALTER TABLE "excel_workspace_items" ADD COLUMN IF NOT EXISTS "included_in_export" boolean DEFAULT true NOT NULL;--> statement-breakpoint
UPDATE "excel_workspace_items"
SET
  "qty_total" = COALESCE("qty_total", "quantity"),
  "qty_in_stock" = COALESCE("qty_in_stock", 0),
  "unit_price" = COALESCE("unit_price", "target_price")
WHERE "qty_total" IS NULL
   OR "qty_in_stock" IS NULL
   OR ("unit_price" IS NULL AND "target_price" IS NOT NULL);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'excel_workspace_items_material_id_materials_id_fk'
  ) THEN
    ALTER TABLE "excel_workspace_items"
      ADD CONSTRAINT "excel_workspace_items_material_id_materials_id_fk"
      FOREIGN KEY ("material_id")
      REFERENCES "materials"("id")
      ON DELETE SET NULL;
  END IF;
END$$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "excel_workspace_items_material_idx" ON "excel_workspace_items" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "excel_workspace_items_export_idx" ON "excel_workspace_items" USING btree ("workspace_id","included_in_export","term");
