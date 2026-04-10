import {
  pgEnum,
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  bigint,
} from "drizzle-orm/pg-core";

export const notificationFrequencyEnum = pgEnum("notification_frequency", [
  "daily",
  "weekly",
]);

export const watchlistTypeEnum = pgEnum("watchlist_type", [
  "package",
  "inviter",
  "competitor",
  "commodity",
]);

export const workflowTriggerTypeEnum = pgEnum("workflow_trigger_type", [
  "new_package",
  "schedule",
]);

export const workflowActionTypeEnum = pgEnum("workflow_action_type", [
  "in_app",
  "email",
]);

export const workflowRunStatusEnum = pgEnum("workflow_run_status", [
  "success",
  "failed",
  "running",
]);

export const notificationSeverityEnum = pgEnum("notification_severity", [
  "high",
  "medium",
  "low",
]);

export const notificationChannelEnum = pgEnum("notification_channel", [
  "in_app",
  "email",
]);

export const tenderPackages = pgTable("tender_packages", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  inviter: text("inviter").notNull(),
  province: text("province").notNull(),
  category: text("category").notNull(),
  budget: bigint("budget", { mode: "number" }).notNull(),
  publishedAt: text("published_at").notNull(),
  matchScore: integer("match_score").notNull(),
});

export const savedFilters = pgTable("saved_filters", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  keyword: text("keyword").notNull().default(""),
  provinces: jsonb("provinces").$type<string[]>().notNull().default([]),
  categories: jsonb("categories").$type<string[]>().notNull().default([]),
  budgetMin: bigint("budget_min", { mode: "number" }),
  budgetMax: bigint("budget_max", { mode: "number" }),
  notificationFrequency: notificationFrequencyEnum("notification_frequency")
    .notNull()
    .default("daily"),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const watchlistItems = pgTable("watchlist_items", {
  id: serial("id").primaryKey(),
  type: watchlistTypeEnum("type").notNull(),
  refKey: text("ref_key").notNull(),
  label: text("label").notNull(),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const workflows = pgTable("workflows", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  triggerType: workflowTriggerTypeEnum("trigger_type").notNull(),
  triggerConfig: jsonb("trigger_config")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  actionType: workflowActionTypeEnum("action_type").notNull(),
  actionConfig: jsonb("action_config")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const workflowRuns = pgTable("workflow_runs", {
  id: serial("id").primaryKey(),
  workflowId: integer("workflow_id")
    .notNull()
    .references(() => workflows.id, { onDelete: "cascade" }),
  status: workflowRunStatusEnum("status").notNull(),
  startedAt: timestamp("started_at", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { mode: "string", withTimezone: true }),
  message: text("message").notNull(),
});

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  channel: notificationChannelEnum("channel").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  severity: notificationSeverityEnum("severity").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
});
