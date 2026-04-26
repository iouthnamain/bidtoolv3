ALTER TABLE "saved_filters" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "saved_filters" SET "updated_at" = "created_at";
