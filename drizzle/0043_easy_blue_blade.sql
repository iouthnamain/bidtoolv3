CREATE TYPE "public"."material_control_document_category" AS ENUM('general', 'requirement', 'purchase', 'shipment', 'installation', 'export');--> statement-breakpoint
CREATE TYPE "public"."material_control_location_type" AS ENUM('warehouse', 'site', 'zone', 'transit', 'installed', 'waste', 'virtual');--> statement-breakpoint
CREATE TYPE "public"."material_control_movement_type" AS ENUM('receipt', 'shipment', 'site_receipt', 'installation', 'return', 'waste', 'transfer_out', 'transfer_in', 'adjustment', 'reversal');--> statement-breakpoint
CREATE TYPE "public"."material_control_plan_status" AS ENUM('draft', 'active', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."material_control_project_source_type" AS ENUM('tender_package', 'tender_plan', 'investment_project', 'manual');--> statement-breakpoint
CREATE TYPE "public"."material_control_project_status" AS ENUM('draft', 'active', 'on_hold', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."material_control_purchase_commitment_status" AS ENUM('draft', 'committed', 'partially_received', 'received', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."material_control_requirement_status" AS ENUM('open', 'partially_fulfilled', 'fulfilled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."material_control_reservation_status" AS ENUM('active', 'released', 'fulfilled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."material_control_shipment_status" AS ENUM('draft', 'ready', 'in_transit', 'partially_received', 'received', 'cancelled');--> statement-breakpoint
CREATE TABLE "material_control_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"category" "material_control_document_category" DEFAULT 'general' NOT NULL,
	"file_name" text NOT NULL,
	"original_file_name" text NOT NULL,
	"relative_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size" bigint NOT NULL,
	"checksum" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_control_documents_file_size_non_negative" CHECK ("material_control_documents"."file_size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "material_control_locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer,
	"parent_id" integer,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "material_control_location_type" NOT NULL,
	"is_virtual" boolean DEFAULT false NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_control_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"status" "material_control_plan_status" DEFAULT 'draft' NOT NULL,
	"planned_start_at" timestamp with time zone,
	"planned_end_at" timestamp with time zone,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_control_project_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"source_type" "material_control_project_source_type" NOT NULL,
	"tender_package_id" integer,
	"tender_plan_id" integer,
	"investment_project_id" integer,
	"external_reference" text,
	"label" text DEFAULT '' NOT NULL,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_control_project_sources_shape_check" CHECK ((
        ("material_control_project_sources"."source_type" = 'tender_package' AND "material_control_project_sources"."tender_package_id" IS NOT NULL AND "material_control_project_sources"."tender_plan_id" IS NULL AND "material_control_project_sources"."investment_project_id" IS NULL AND "material_control_project_sources"."external_reference" IS NULL)
        OR ("material_control_project_sources"."source_type" = 'tender_plan' AND "material_control_project_sources"."tender_package_id" IS NULL AND "material_control_project_sources"."tender_plan_id" IS NOT NULL AND "material_control_project_sources"."investment_project_id" IS NULL AND "material_control_project_sources"."external_reference" IS NULL)
        OR ("material_control_project_sources"."source_type" = 'investment_project' AND "material_control_project_sources"."tender_package_id" IS NULL AND "material_control_project_sources"."tender_plan_id" IS NULL AND "material_control_project_sources"."investment_project_id" IS NOT NULL AND "material_control_project_sources"."external_reference" IS NULL)
        OR ("material_control_project_sources"."source_type" = 'manual' AND "material_control_project_sources"."tender_package_id" IS NULL AND "material_control_project_sources"."tender_plan_id" IS NULL AND "material_control_project_sources"."investment_project_id" IS NULL AND "material_control_project_sources"."external_reference" IS NOT NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "material_control_projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"status" "material_control_project_status" DEFAULT 'draft' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"planned_start_at" timestamp with time zone,
	"planned_end_at" timestamp with time zone,
	"actual_start_at" timestamp with time zone,
	"actual_end_at" timestamp with time zone,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_control_purchase_commitment_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"commitment_id" integer NOT NULL,
	"requirement_id" integer,
	"material_id" integer,
	"material_name" text NOT NULL,
	"spec_text" text NOT NULL,
	"unit" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_price" bigint,
	"currency" text DEFAULT 'VND' NOT NULL,
	"expected_at" timestamp with time zone,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_control_purchase_commitment_lines_quantity_positive" CHECK ("material_control_purchase_commitment_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "material_control_purchase_commitments" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"status" "material_control_purchase_commitment_status" DEFAULT 'draft' NOT NULL,
	"supplier_name" text,
	"external_reference" text,
	"committed_at" timestamp with time zone,
	"expected_at" timestamp with time zone,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_control_requirement_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"requirement_id" integer NOT NULL,
	"purchase_commitment_line_id" integer,
	"reservation_id" integer,
	"quantity" numeric(14, 3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_control_requirement_allocations_quantity_positive" CHECK ("material_control_requirement_allocations"."quantity" > 0),
	CONSTRAINT "material_control_requirement_allocations_exactly_one_source" CHECK (("material_control_requirement_allocations"."purchase_commitment_line_id" IS NOT NULL) <> ("material_control_requirement_allocations"."reservation_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "material_control_requirements" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" integer NOT NULL,
	"material_id" integer,
	"material_name" text NOT NULL,
	"spec_text" text NOT NULL,
	"unit" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"required_at" timestamp with time zone,
	"target_location_id" integer,
	"status" "material_control_requirement_status" DEFAULT 'open' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_control_requirements_quantity_positive" CHECK ("material_control_requirements"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "material_control_reservations" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"requirement_id" integer,
	"location_id" integer NOT NULL,
	"material_id" integer,
	"material_name" text NOT NULL,
	"spec_text" text NOT NULL,
	"unit" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"status" "material_control_reservation_status" DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"fulfilled_at" timestamp with time zone,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_control_reservations_quantity_positive" CHECK ("material_control_reservations"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "material_control_shipment_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
	"requirement_id" integer,
	"material_id" integer,
	"material_name" text NOT NULL,
	"spec_text" text NOT NULL,
	"unit" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"received_quantity" numeric(14, 3) DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_control_shipment_lines_quantity_positive" CHECK ("material_control_shipment_lines"."quantity" > 0),
	CONSTRAINT "material_control_shipment_lines_received_quantity_valid" CHECK ("material_control_shipment_lines"."received_quantity" >= 0 AND "material_control_shipment_lines"."received_quantity" <= "material_control_shipment_lines"."quantity")
);
--> statement-breakpoint
CREATE TABLE "material_control_shipments" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"source_location_id" integer NOT NULL,
	"destination_location_id" integer NOT NULL,
	"status" "material_control_shipment_status" DEFAULT 'draft' NOT NULL,
	"external_reference" text,
	"planned_ship_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"expected_arrival_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_control_shipments_distinct_locations" CHECK ("material_control_shipments"."source_location_id" <> "material_control_shipments"."destination_location_id")
);
--> statement-breakpoint
CREATE TABLE "material_control_stock_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer,
	"movement_type" "material_control_movement_type" NOT NULL,
	"source_location_id" integer,
	"destination_location_id" integer,
	"shipment_id" integer,
	"reservation_id" integer,
	"requirement_id" integer,
	"material_id" integer,
	"material_name" text NOT NULL,
	"spec_text" text NOT NULL,
	"unit" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversal_of_id" integer,
	"reference" text,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_control_stock_movements_quantity_positive" CHECK ("material_control_stock_movements"."quantity" > 0),
	CONSTRAINT "material_control_stock_movements_location_required" CHECK ("material_control_stock_movements"."source_location_id" IS NOT NULL OR "material_control_stock_movements"."destination_location_id" IS NOT NULL),
	CONSTRAINT "material_control_stock_movements_distinct_locations" CHECK ("material_control_stock_movements"."source_location_id" IS NULL OR "material_control_stock_movements"."destination_location_id" IS NULL OR "material_control_stock_movements"."source_location_id" <> "material_control_stock_movements"."destination_location_id")
);
--> statement-breakpoint
ALTER TABLE "material_control_documents" ADD CONSTRAINT "material_control_documents_project_id_material_control_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."material_control_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_locations" ADD CONSTRAINT "material_control_locations_project_id_material_control_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."material_control_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_locations" ADD CONSTRAINT "material_control_locations_parent_id_material_control_locations_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."material_control_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_plans" ADD CONSTRAINT "material_control_plans_project_id_material_control_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."material_control_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_project_sources" ADD CONSTRAINT "material_control_project_sources_project_id_material_control_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."material_control_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_project_sources" ADD CONSTRAINT "material_control_project_sources_tender_package_id_tender_packages_id_fk" FOREIGN KEY ("tender_package_id") REFERENCES "public"."tender_packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_project_sources" ADD CONSTRAINT "material_control_project_sources_tender_plan_id_tender_plans_id_fk" FOREIGN KEY ("tender_plan_id") REFERENCES "public"."tender_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_project_sources" ADD CONSTRAINT "material_control_project_sources_investment_project_id_investment_projects_id_fk" FOREIGN KEY ("investment_project_id") REFERENCES "public"."investment_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_purchase_commitment_lines" ADD CONSTRAINT "material_control_purchase_commitment_lines_commitment_id_material_control_purchase_commitments_id_fk" FOREIGN KEY ("commitment_id") REFERENCES "public"."material_control_purchase_commitments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_purchase_commitment_lines" ADD CONSTRAINT "material_control_purchase_commitment_lines_requirement_id_material_control_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."material_control_requirements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_purchase_commitment_lines" ADD CONSTRAINT "material_control_purchase_commitment_lines_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_purchase_commitments" ADD CONSTRAINT "material_control_purchase_commitments_project_id_material_control_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."material_control_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_requirement_allocations" ADD CONSTRAINT "material_control_requirement_allocations_requirement_id_material_control_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."material_control_requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_requirement_allocations" ADD CONSTRAINT "material_control_requirement_allocations_purchase_commitment_line_id_material_control_purchase_commitment_lines_id_fk" FOREIGN KEY ("purchase_commitment_line_id") REFERENCES "public"."material_control_purchase_commitment_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_requirement_allocations" ADD CONSTRAINT "material_control_requirement_allocations_reservation_id_material_control_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."material_control_reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_requirements" ADD CONSTRAINT "material_control_requirements_plan_id_material_control_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."material_control_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_requirements" ADD CONSTRAINT "material_control_requirements_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_requirements" ADD CONSTRAINT "material_control_requirements_target_location_id_material_control_locations_id_fk" FOREIGN KEY ("target_location_id") REFERENCES "public"."material_control_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_reservations" ADD CONSTRAINT "material_control_reservations_project_id_material_control_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."material_control_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_reservations" ADD CONSTRAINT "material_control_reservations_requirement_id_material_control_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."material_control_requirements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_reservations" ADD CONSTRAINT "material_control_reservations_location_id_material_control_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."material_control_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_reservations" ADD CONSTRAINT "material_control_reservations_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_shipment_lines" ADD CONSTRAINT "material_control_shipment_lines_shipment_id_material_control_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."material_control_shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_shipment_lines" ADD CONSTRAINT "material_control_shipment_lines_requirement_id_material_control_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."material_control_requirements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_shipment_lines" ADD CONSTRAINT "material_control_shipment_lines_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_shipments" ADD CONSTRAINT "material_control_shipments_project_id_material_control_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."material_control_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_shipments" ADD CONSTRAINT "material_control_shipments_source_location_id_material_control_locations_id_fk" FOREIGN KEY ("source_location_id") REFERENCES "public"."material_control_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_shipments" ADD CONSTRAINT "material_control_shipments_destination_location_id_material_control_locations_id_fk" FOREIGN KEY ("destination_location_id") REFERENCES "public"."material_control_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_stock_movements" ADD CONSTRAINT "material_control_stock_movements_project_id_material_control_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."material_control_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_stock_movements" ADD CONSTRAINT "material_control_stock_movements_source_location_id_material_control_locations_id_fk" FOREIGN KEY ("source_location_id") REFERENCES "public"."material_control_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_stock_movements" ADD CONSTRAINT "material_control_stock_movements_destination_location_id_material_control_locations_id_fk" FOREIGN KEY ("destination_location_id") REFERENCES "public"."material_control_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_stock_movements" ADD CONSTRAINT "material_control_stock_movements_shipment_id_material_control_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."material_control_shipments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_stock_movements" ADD CONSTRAINT "material_control_stock_movements_reservation_id_material_control_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."material_control_reservations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_stock_movements" ADD CONSTRAINT "material_control_stock_movements_requirement_id_material_control_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."material_control_requirements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_stock_movements" ADD CONSTRAINT "material_control_stock_movements_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_control_stock_movements" ADD CONSTRAINT "material_control_stock_movements_reversal_of_id_material_control_stock_movements_id_fk" FOREIGN KEY ("reversal_of_id") REFERENCES "public"."material_control_stock_movements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "material_control_documents_project_path_unique" ON "material_control_documents" USING btree ("project_id","relative_path");--> statement-breakpoint
CREATE INDEX "material_control_documents_project_category_idx" ON "material_control_documents" USING btree ("project_id","category");--> statement-breakpoint
CREATE INDEX "material_control_documents_checksum_idx" ON "material_control_documents" USING btree ("checksum");--> statement-breakpoint
CREATE UNIQUE INDEX "material_control_locations_project_code_unique" ON "material_control_locations" USING btree ("project_id","code");--> statement-breakpoint
CREATE INDEX "material_control_locations_project_type_idx" ON "material_control_locations" USING btree ("project_id","type");--> statement-breakpoint
CREATE INDEX "material_control_locations_parent_idx" ON "material_control_locations" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_control_plans_project_name_unique" ON "material_control_plans" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "material_control_plans_project_status_idx" ON "material_control_plans" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "material_control_project_sources_project_idx" ON "material_control_project_sources" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_control_project_sources_tender_package_unique" ON "material_control_project_sources" USING btree ("project_id","tender_package_id") WHERE "material_control_project_sources"."tender_package_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "material_control_project_sources_tender_plan_unique" ON "material_control_project_sources" USING btree ("project_id","tender_plan_id") WHERE "material_control_project_sources"."tender_plan_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "material_control_project_sources_investment_project_unique" ON "material_control_project_sources" USING btree ("project_id","investment_project_id") WHERE "material_control_project_sources"."investment_project_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "material_control_project_sources_manual_reference_unique" ON "material_control_project_sources" USING btree ("project_id","external_reference") WHERE "material_control_project_sources"."external_reference" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "material_control_projects_code_unique" ON "material_control_projects" USING btree ("code") WHERE "material_control_projects"."code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "material_control_projects_status_updated_idx" ON "material_control_projects" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "material_control_purchase_commitment_lines_commitment_idx" ON "material_control_purchase_commitment_lines" USING btree ("commitment_id");--> statement-breakpoint
CREATE INDEX "material_control_purchase_commitment_lines_requirement_idx" ON "material_control_purchase_commitment_lines" USING btree ("requirement_id");--> statement-breakpoint
CREATE INDEX "material_control_purchase_commitment_lines_material_idx" ON "material_control_purchase_commitment_lines" USING btree ("material_id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_control_purchase_commitments_project_reference_unique" ON "material_control_purchase_commitments" USING btree ("project_id","external_reference") WHERE "material_control_purchase_commitments"."external_reference" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "material_control_purchase_commitments_project_status_idx" ON "material_control_purchase_commitments" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "material_control_requirement_allocations_requirement_idx" ON "material_control_requirement_allocations" USING btree ("requirement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_control_requirement_allocations_purchase_line_unique" ON "material_control_requirement_allocations" USING btree ("requirement_id","purchase_commitment_line_id") WHERE "material_control_requirement_allocations"."purchase_commitment_line_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "material_control_requirement_allocations_reservation_unique" ON "material_control_requirement_allocations" USING btree ("requirement_id","reservation_id") WHERE "material_control_requirement_allocations"."reservation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "material_control_requirements_plan_status_required_idx" ON "material_control_requirements" USING btree ("plan_id","status","required_at");--> statement-breakpoint
CREATE INDEX "material_control_requirements_material_idx" ON "material_control_requirements" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "material_control_requirements_location_idx" ON "material_control_requirements" USING btree ("target_location_id");--> statement-breakpoint
CREATE INDEX "material_control_reservations_project_status_idx" ON "material_control_reservations" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "material_control_reservations_location_status_idx" ON "material_control_reservations" USING btree ("location_id","status");--> statement-breakpoint
CREATE INDEX "material_control_reservations_requirement_idx" ON "material_control_reservations" USING btree ("requirement_id");--> statement-breakpoint
CREATE INDEX "material_control_reservations_material_idx" ON "material_control_reservations" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "material_control_shipment_lines_shipment_idx" ON "material_control_shipment_lines" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "material_control_shipment_lines_requirement_idx" ON "material_control_shipment_lines" USING btree ("requirement_id");--> statement-breakpoint
CREATE INDEX "material_control_shipment_lines_material_idx" ON "material_control_shipment_lines" USING btree ("material_id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_control_shipments_project_reference_unique" ON "material_control_shipments" USING btree ("project_id","external_reference") WHERE "material_control_shipments"."external_reference" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "material_control_shipments_project_status_idx" ON "material_control_shipments" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "material_control_shipments_source_idx" ON "material_control_shipments" USING btree ("source_location_id");--> statement-breakpoint
CREATE INDEX "material_control_shipments_destination_idx" ON "material_control_shipments" USING btree ("destination_location_id");--> statement-breakpoint
CREATE INDEX "material_control_stock_movements_project_occurred_idx" ON "material_control_stock_movements" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "material_control_stock_movements_source_occurred_idx" ON "material_control_stock_movements" USING btree ("source_location_id","occurred_at");--> statement-breakpoint
CREATE INDEX "material_control_stock_movements_destination_occurred_idx" ON "material_control_stock_movements" USING btree ("destination_location_id","occurred_at");--> statement-breakpoint
CREATE INDEX "material_control_stock_movements_material_occurred_idx" ON "material_control_stock_movements" USING btree ("material_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "material_control_stock_movements_reversal_unique" ON "material_control_stock_movements" USING btree ("reversal_of_id") WHERE "material_control_stock_movements"."reversal_of_id" IS NOT NULL;