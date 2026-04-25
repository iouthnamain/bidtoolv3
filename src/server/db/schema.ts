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
  numeric,
  index,
  uniqueIndex,
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

export const excelWorkspaceStatusEnum = pgEnum("excel_workspace_status", [
  "draft",
  "imported",
  "mapped",
  "reviewed",
  "matched",
  "exported",
  "catalog_generated",
  "checked",
  "approved",
]);

export const productMatchStatusEnum = pgEnum("product_match_status", [
  "unmatched",
  "candidates_found",
  "matched",
  "manual",
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

export const packageDetailsCache = pgTable(
  "package_details_cache",
  {
    id: serial("id").primaryKey(),
    externalId: text("external_id").notNull(),
    sourceUrl: text("source_url").notNull(),
    cacheKey: text("cache_key").notNull(),
    payloadJson: jsonb("payload_json")
      .$type<Record<string, unknown>>()
      .notNull(),
    fetchedAt: timestamp("fetched_at", {
      mode: "string",
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    packageDetailsCacheKeyUnique: uniqueIndex(
      "package_details_cache_cache_key_unique",
    ).on(table.cacheKey),
    packageDetailsCacheExternalIdIdx: index(
      "package_details_cache_external_id_idx",
    ).on(table.externalId),
    packageDetailsCacheSourceUrlIdx: index(
      "package_details_cache_source_url_idx",
    ).on(table.sourceUrl),
    packageDetailsCacheUpdatedAtIdx: index(
      "package_details_cache_updated_at_idx",
    ).on(table.updatedAt),
  }),
);

export const materials = pgTable(
  "materials",
  {
    id: serial("id").primaryKey(),
    code: text("code"),
    name: text("name").notNull(),
    unit: text("unit").notNull(),
    category: text("category"),
    defaultDepreciation: numeric("default_depreciation", {
      precision: 10,
      scale: 2,
      mode: "number",
    })
      .notNull()
      .default(1),
    defaultReusePct: integer("default_reuse_pct").notNull().default(0),
    metadataJson: jsonb("metadata_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    deletedAt: timestamp("deleted_at", { mode: "string", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    materialsCodeUnique: uniqueIndex("materials_code_unique").on(table.code),
    materialsNameIdx: index("materials_name_idx").on(table.name),
    materialsCategoryIdx: index("materials_category_idx").on(table.category),
  }),
);

export const excelWorkspaces = pgTable(
  "excel_workspaces",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    status: excelWorkspaceStatusEnum("status").notNull().default("draft"),
    sourceFileName: text("source_file_name"),
    sourceSheetName: text("source_sheet_name"),
    rowCount: integer("row_count").notNull().default(0),
    columnMappingJson: jsonb("column_mapping_json")
      .$type<Record<string, string | null>>()
      .notNull()
      .default({}),
    workbookJson: jsonb("workbook_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    exportFileName: text("export_file_name"),
    exportedAt: timestamp("exported_at", {
      mode: "string",
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    excelWorkspacesLookupIdx: index("excel_workspaces_lookup_idx").on(
      table.status,
      table.updatedAt,
    ),
  }),
);

export const excelWorkspaceItems = pgTable(
  "excel_workspace_items",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => excelWorkspaces.id, { onDelete: "cascade" }),
    originalRowIndex: integer("original_row_index").notNull(),
    originalDataJson: jsonb("original_data_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    productName: text("product_name").notNull(),
    specText: text("spec_text").notNull().default(""),
    unit: text("unit").notNull().default(""),
    quantity: numeric("quantity", {
      precision: 12,
      scale: 2,
      mode: "number",
    }),
    targetPrice: bigint("target_price", { mode: "number" }),
    currency: text("currency").notNull().default("VND"),
    vendorHint: text("vendor_hint"),
    originHint: text("origin_hint"),
    notes: text("notes").notNull().default(""),
    searchKeywords: jsonb("search_keywords")
      .$type<string[]>()
      .notNull()
      .default([]),
    sortOrder: integer("sort_order").notNull().default(0),
    selectedCandidateId: integer("selected_candidate_id"),
    enrichedSnapshotJson: jsonb("enriched_snapshot_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    matchStatus: productMatchStatusEnum("match_status")
      .notNull()
      .default("unmatched"),
    createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    excelWorkspaceItemsOrderIdx: index("excel_workspace_items_order_idx").on(
      table.workspaceId,
      table.sortOrder,
    ),
    excelWorkspaceItemsMatchIdx: index("excel_workspace_items_match_idx").on(
      table.workspaceId,
      table.matchStatus,
    ),
  }),
);

export const webProductCandidates = pgTable(
  "web_product_candidates",
  {
    id: serial("id").primaryKey(),
    workspaceItemId: integer("workspace_item_id")
      .notNull()
      .references(() => excelWorkspaceItems.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("searxng"),
    query: text("query").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    domain: text("domain").notNull(),
    snippet: text("snippet").notNull().default(""),
    rawEvidence: text("raw_evidence").notNull().default(""),
    imageUrl: text("image_url"),
    extractedSpecJson: jsonb("extracted_spec_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    confidenceScore: integer("confidence_score").notNull().default(0),
    legacySearchScore: numeric("tavily_score", {
      precision: 8,
      scale: 4,
      mode: "number",
    }),
    matchReasons: jsonb("match_reasons")
      .$type<string[]>()
      .notNull()
      .default([]),
    isSelected: boolean("is_selected").notNull().default(false),
    fetchedAt: timestamp("fetched_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    webProductCandidatesItemIdx: index("web_product_candidates_item_idx").on(
      table.workspaceItemId,
    ),
    webProductCandidatesUrlIdx: index("web_product_candidates_url_idx").on(
      table.url,
    ),
  }),
);

export const excelWorkspaceEvents = pgTable(
  "excel_workspace_events",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => excelWorkspaces.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    actor: text("actor").notNull().default("system"),
    at: timestamp("at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
    payloadJson: jsonb("payload_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (table) => ({
    excelWorkspaceEventsTimelineIdx: index(
      "excel_workspace_events_timeline_idx",
    ).on(table.workspaceId, table.at),
  }),
);
