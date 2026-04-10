CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'email');--> statement-breakpoint
CREATE TYPE "public"."notification_frequency" AS ENUM('daily', 'weekly');--> statement-breakpoint
CREATE TYPE "public"."notification_severity" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."watchlist_type" AS ENUM('package', 'inviter', 'competitor', 'commodity');--> statement-breakpoint
CREATE TYPE "public"."workflow_action_type" AS ENUM('in_app', 'email');--> statement-breakpoint
CREATE TYPE "public"."workflow_run_status" AS ENUM('success', 'failed', 'running');--> statement-breakpoint
CREATE TYPE "public"."workflow_trigger_type" AS ENUM('new_package', 'schedule');--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"severity" "notification_severity" NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_filters" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"keyword" text DEFAULT '' NOT NULL,
	"provinces" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"budget_min" integer,
	"budget_max" integer,
	"notification_frequency" "notification_frequency" DEFAULT 'daily' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tender_packages" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"inviter" text NOT NULL,
	"province" text NOT NULL,
	"category" text NOT NULL,
	"budget" integer NOT NULL,
	"published_at" text NOT NULL,
	"match_score" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlist_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" "watchlist_type" NOT NULL,
	"ref_key" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_id" integer NOT NULL,
	"status" "workflow_run_status" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"message" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"trigger_type" "workflow_trigger_type" NOT NULL,
	"trigger_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"action_type" "workflow_action_type" NOT NULL,
	"action_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;