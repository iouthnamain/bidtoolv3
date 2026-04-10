ALTER TABLE "saved_filters" ALTER COLUMN "budget_min" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "saved_filters" ALTER COLUMN "budget_max" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "tender_packages" ALTER COLUMN "budget" SET DATA TYPE bigint;