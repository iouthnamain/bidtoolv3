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
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const notificationFrequencyEnum = pgEnum("notification_frequency", [
  "daily",
  "weekly",
]);

export const searchModeEnum = pgEnum("search_mode", [
  "package_keyword",
  "package_location",
  "package_area_location",
  "plan",
  "project",
]);

export const watchlistTypeEnum = pgEnum("watchlist_type", [
  "package",
  "plan",
  "project",
  "inviter",
  "competitor",
  "commodity",
]);

export const workflowTriggerTypeEnum = pgEnum("workflow_trigger_type", [
  "new_package",
  "new_search_result",
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

export const catalogDocumentSourceTypeEnum = pgEnum(
  "catalog_document_source_type",
  ["uploaded", "detected", "manual_url"],
);

export const catalogDocumentLinkSourceEnum = pgEnum(
  "catalog_document_link_source",
  ["manual", "scrape", "import"],
);

export const shopJobStatusEnum = pgEnum("shop_job_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const tenderPackages = pgTable(
  "tender_packages",
  {
    id: serial("id").primaryKey(),
    externalId: text("external_id").notNull().default(""),
    title: text("title").notNull(),
    inviter: text("inviter").notNull(),
    province: text("province").notNull(),
    category: text("category").notNull(),
    budget: bigint("budget", { mode: "number" }).notNull(),
    publishedAt: text("published_at").notNull(),
    closingAt: text("closing_at"),
    sourceUrl: text("source_url").notNull().default(""),
    matchScore: integer("match_score").notNull(),
  },
  (table) => ({
    externalIdUnique: uniqueIndex("tender_packages_external_id_unique").on(
      table.externalId,
    ),
  }),
);

export const tenderPlans = pgTable(
  "tender_plans",
  {
    id: serial("id").primaryKey(),
    externalId: text("external_id").notNull().default(""),
    title: text("title").notNull(),
    owner: text("owner").notNull(),
    province: text("province").notNull(),
    field: text("field").notNull(),
    procurementMethod: text("procurement_method").notNull(),
    budget: bigint("budget", { mode: "number" }).notNull(),
    publishedAt: text("published_at").notNull(),
    timeline: text("timeline"),
    sourceUrl: text("source_url").notNull().default(""),
  },
  (table) => ({
    externalIdUnique: uniqueIndex("tender_plans_external_id_unique").on(
      table.externalId,
    ),
  }),
);

export const investmentProjects = pgTable(
  "investment_projects",
  {
    id: serial("id").primaryKey(),
    externalId: text("external_id").notNull().default(""),
    title: text("title").notNull(),
    owner: text("owner").notNull(),
    province: text("province").notNull(),
    projectGroup: text("project_group").notNull(),
    investmentBudget: bigint("investment_budget", { mode: "number" }).notNull(),
    publishedAt: text("published_at").notNull(),
    approvedAt: text("approved_at"),
    relatedPlanCount: integer("related_plan_count").notNull().default(0),
    sourceUrl: text("source_url").notNull().default(""),
  },
  (table) => ({
    externalIdUnique: uniqueIndex("investment_projects_external_id_unique").on(
      table.externalId,
    ),
  }),
);

export const savedFilters = pgTable(
  "saved_filters",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    mode: searchModeEnum("mode").notNull().default("package_keyword"),
    criteriaJson: jsonb("criteria_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    keyword: text("keyword").notNull().default(""),
    provinces: jsonb("provinces").$type<string[]>().notNull().default([]),
    categories: jsonb("categories").$type<string[]>().notNull().default([]),
    budgetMin: bigint("budget_min", { mode: "number" }),
    budgetMax: bigint("budget_max", { mode: "number" }),
    minMatchScore: integer("min_match_score").notNull().default(0),
    notificationFrequency: notificationFrequencyEnum("notification_frequency")
      .notNull()
      .default("daily"),
    tenantId: text("tenant_id").references((): AnyPgColumn => tenant.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    savedFiltersModeIdx: index("saved_filters_mode_idx").on(table.mode),
    savedFiltersUpdatedAtIdx: index("saved_filters_updated_at_idx").on(
      table.updatedAt,
    ),
    savedFiltersTenantIdx: index("saved_filters_tenant_id_idx").on(
      table.tenantId,
    ),
  }),
);

export const watchlistItems = pgTable(
  "watchlist_items",
  {
    id: serial("id").primaryKey(),
    type: watchlistTypeEnum("type").notNull(),
    refKey: text("ref_key").notNull(),
    label: text("label").notNull(),
    tenantId: text("tenant_id").references((): AnyPgColumn => tenant.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    watchlistItemsTypeIdx: index("watchlist_items_type_idx").on(table.type),
    watchlistItemsTypeRefKeyIdx: index("watchlist_items_type_ref_key_idx").on(
      table.type,
      table.refKey,
    ),
    watchlistItemsTenantIdx: index("watchlist_items_tenant_id_idx").on(
      table.tenantId,
    ),
  }),
);

export const workflows = pgTable(
  "workflows",
  {
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
    tenantId: text("tenant_id").references((): AnyPgColumn => tenant.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    workflowsActiveIdx: index("workflows_is_active_idx").on(table.isActive),
    workflowsTriggerTypeIdx: index("workflows_trigger_type_idx").on(
      table.triggerType,
    ),
    workflowsTenantIdx: index("workflows_tenant_id_idx").on(table.tenantId),
  }),
);

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: serial("id").primaryKey(),
    workflowId: integer("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    status: workflowRunStatusEnum("status").notNull(),
    startedAt: timestamp("started_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", {
      mode: "string",
      withTimezone: true,
    }),
    message: text("message").notNull(),
  },
  (table) => ({
    workflowRunsWorkflowStartedIdx: index(
      "workflow_runs_workflow_started_idx",
    ).on(table.workflowId, table.startedAt),
  }),
);

export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    channel: notificationChannelEnum("channel").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    severity: notificationSeverityEnum("severity").notNull(),
    isRead: boolean("is_read").notNull().default(false),
    tenantId: text("tenant_id").references((): AnyPgColumn => tenant.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    notificationsIsReadCreatedIdx: index(
      "notifications_is_read_created_idx",
    ).on(table.isRead, table.createdAt),
    notificationsTenantIdx: index("notifications_tenant_id_idx").on(
      table.tenantId,
    ),
  }),
);

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

export const planDetailsCache = pgTable(
  "plan_details_cache",
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
    planDetailsCacheKeyUnique: uniqueIndex(
      "plan_details_cache_cache_key_unique",
    ).on(table.cacheKey),
    planDetailsCacheExternalIdIdx: index(
      "plan_details_cache_external_id_idx",
    ).on(table.externalId),
    planDetailsCacheSourceUrlIdx: index("plan_details_cache_source_url_idx").on(
      table.sourceUrl,
    ),
    planDetailsCacheUpdatedAtIdx: index("plan_details_cache_updated_at_idx").on(
      table.updatedAt,
    ),
  }),
);

export const projectDetailsCache = pgTable(
  "project_details_cache",
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
    projectDetailsCacheKeyUnique: uniqueIndex(
      "project_details_cache_cache_key_unique",
    ).on(table.cacheKey),
    projectDetailsCacheExternalIdIdx: index(
      "project_details_cache_external_id_idx",
    ).on(table.externalId),
    projectDetailsCacheSourceUrlIdx: index(
      "project_details_cache_source_url_idx",
    ).on(table.sourceUrl),
    projectDetailsCacheUpdatedAtIdx: index(
      "project_details_cache_updated_at_idx",
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
    specText: text("spec_text").notNull().default(""),
    manufacturer: text("manufacturer"),
    originCountry: text("origin_country"),
    defaultUnitPrice: bigint("default_unit_price", { mode: "number" }),
    currency: text("currency").notNull().default("VND"),
    sourceUrl: text("source_url"),
    imageUrl: text("image_url"),
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
    materialsCodeUnique: uniqueIndex("materials_code_unique")
      .on(table.code)
      .where(sql`${table.deletedAt} IS NULL`),
    materialsNameIdx: index("materials_name_idx").on(table.name),
    materialsCategoryIdx: index("materials_category_idx").on(table.category),
  }),
);

export const materialCatalogDocuments = pgTable(
  "material_catalog_documents",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    supplier: text("supplier"),
    sourceUrl: text("source_url"),
    normalizedSourceUrl: text("normalized_source_url").notNull().default(""),
    localFilePath: text("local_file_path"),
    fileName: text("file_name"),
    fileSize: bigint("file_size", { mode: "number" }),
    mimeType: text("mime_type"),
    checksum: text("checksum"),
    sourceType: catalogDocumentSourceTypeEnum("source_type")
      .notNull()
      .default("manual_url"),
    notes: text("notes").notNull().default(""),
    tagsJson: jsonb("tags_json").$type<string[]>().notNull().default([]),
    deletedAt: timestamp("deleted_at", { mode: "string", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    catalogDocumentsSourceUrlUnique: uniqueIndex(
      "material_catalog_documents_source_url_unique",
    )
      .on(table.normalizedSourceUrl)
      .where(
        sql`${table.deletedAt} IS NULL AND ${table.normalizedSourceUrl} <> ''`,
      ),
    catalogDocumentsTitleIdx: index("material_catalog_documents_title_idx").on(
      table.title,
    ),
  }),
);

export const materialCatalogDocumentLinks = pgTable(
  "material_catalog_document_links",
  {
    id: serial("id").primaryKey(),
    documentId: integer("document_id")
      .notNull()
      .references(() => materialCatalogDocuments.id, { onDelete: "cascade" }),
    materialId: integer("material_id")
      .notNull()
      .references(() => materials.id, { onDelete: "cascade" }),
    linkSource: catalogDocumentLinkSourceEnum("link_source")
      .notNull()
      .default("manual"),
    createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    catalogDocumentLinksUnique: uniqueIndex(
      "material_catalog_document_links_unique",
    ).on(table.documentId, table.materialId),
    catalogDocumentLinksMaterialIdx: index(
      "material_catalog_document_links_material_idx",
    ).on(table.materialId),
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
    templateConfigJson: jsonb("template_config_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({
        organizationLine1: "UBND TỈNH ĐỒNG NAI",
        organizationLine2: "TRƯỜNG CAO ĐẲNG KỸ THUẬT - CÔNG NGHỆ ĐỒNG NAI",
        departmentLine: "KHOA / PHÒNG BAN",
        rightHeaderLine1: "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM",
        rightHeaderLine2: "Độc lập - Tự do - Hạnh phúc",
        schoolYearLabel: "Năm học 2026 - 2027",
        siteLabel: "Cơ sở",
        thvtTitle: "BẢNG TỔNG HỢP VẬT TƯ THỰC HÀNH",
        purchaseRequestTitle: "BẢNG ĐỀ NGHỊ MUA VẬT TƯ THỰC HÀNH",
        inspectionTitle: "BIÊN BẢN KIỂM TRA VẬT TƯ THỰC HÀNH CUỐI HỌC KỲ",
        requestRecipients: ["Ban Giám hiệu", "Phòng Đào tạo", "Phòng TCKT"],
        basisParagraphs: [
          "Căn cứ vào kế hoạch giảng dạy, định mức vật tư và nhu cầu thực hành.",
          "Căn cứ vào số lượng máy móc, trang thiết bị hiện có tại đơn vị.",
          "Đơn vị kính đề nghị mua các vật tư phục vụ công tác đào tạo theo bảng dưới đây.",
        ],
        signerLabels: ["Người lập", "Đơn vị", "Phòng vật tư", "Hiệu trưởng"],
      }),
    selectedSheetTemplateIds: jsonb("selected_sheet_template_ids")
      .$type<string[]>()
      .notNull()
      .default([
        "thvt",
        "purchase_request",
        "inspection_term_1",
        "inspection_term_2",
        "evidence",
      ]),
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
    materialId: integer("material_id").references(() => materials.id, {
      onDelete: "set null",
    }),
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
    term: text("term").notNull().default("term_1"),
    qtyTotal: numeric("qty_total", {
      precision: 12,
      scale: 2,
      mode: "number",
    }),
    qtyInStock: numeric("qty_in_stock", {
      precision: 12,
      scale: 2,
      mode: "number",
    }),
    depreciation: numeric("depreciation", {
      precision: 10,
      scale: 2,
      mode: "number",
    })
      .notNull()
      .default(1),
    reusePct: integer("reuse_pct").notNull().default(0),
    inspectionQtyTerm1: numeric("inspection_qty_term_1", {
      precision: 12,
      scale: 2,
      mode: "number",
    }),
    inspectionQtyTerm2: numeric("inspection_qty_term_2", {
      precision: 12,
      scale: 2,
      mode: "number",
    }),
    unitPrice: bigint("unit_price", { mode: "number" }),
    includedInExport: boolean("included_in_export").notNull().default(true),
    searchKeywords: jsonb("search_keywords")
      .$type<string[]>()
      .notNull()
      .default([]),
    sortOrder: integer("sort_order").notNull().default(0),
    selectedCandidateId: integer("selected_candidate_id").references(
      (): AnyPgColumn => webProductCandidates.id,
      { onDelete: "set null" },
    ),
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

export const shopScrapeJobs = pgTable(
  "shop_scrape_jobs",
  {
    id: uuid("id").primaryKey(),
    url: text("url").notNull(),
    normalizedUrl: text("normalized_url").notNull(),
    status: shopJobStatusEnum("status").notNull().default("queued"),
    scrapeMode: text("scrape_mode").notNull().default("limited"),
    maxPages: integer("max_pages"),
    maxProducts: integer("max_products"),
    method: text("method").notNull().default("auto"),
    detailEnrichment: text("detail_enrichment").notNull().default("none"),
    currentUrls: jsonb("current_urls").$type<string[]>().notNull().default([]),
    pagesVisited: jsonb("pages_visited")
      .$type<string[]>()
      .notNull()
      .default([]),
    failedPages: jsonb("failed_pages")
      .$type<Array<{ url: string; message: string }>>()
      .notNull()
      .default([]),
    queueLength: integer("queue_length").notNull().default(0),
    productCount: integer("product_count").notNull().default(0),
    message: text("message"),
    stopReason: text("stop_reason"),
    error: text("error"),
    products: jsonb("products").$type<unknown[]>().notNull().default([]),
    durationMs: integer("duration_ms"),
    startedAt: timestamp("started_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", {
      mode: "string",
      withTimezone: true,
    }),
    lastProgressAt: timestamp("last_progress_at", {
      mode: "string",
      withTimezone: true,
    }),
    expiresAt: timestamp("expires_at", { mode: "string", withTimezone: true }),
    updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
    tenantId: text("tenant_id").references((): AnyPgColumn => tenant.id, {
      onDelete: "set null",
    }),
  },
  (table) => ({
    statusStartedAtIdx: index("shop_scrape_jobs_status_started_at_idx").on(
      table.status,
      table.startedAt,
    ),
    activeUrlUnique: uniqueIndex("shop_scrape_jobs_active_url_unique")
      .on(table.normalizedUrl)
      .where(sql`${table.status} in ('queued', 'running')`),
    shopScrapeJobsTenantIdx: index("shop_scrape_jobs_tenant_id_idx").on(
      table.tenantId,
    ),
  }),
);

export const shopImportJobs = pgTable(
  "shop_import_jobs",
  {
    id: uuid("id").primaryKey(),
    scrapeJobId: uuid("scrape_job_id")
      .notNull()
      .references(() => shopScrapeJobs.id, { onDelete: "cascade" }),
    status: shopJobStatusEnum("status").notNull().default("queued"),
    processed: integer("processed").notNull().default(0),
    total: integer("total").notNull().default(0),
    created: integer("created").notNull().default(0),
    updated: integer("updated").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    productSourceUrls: jsonb("product_source_urls").$type<string[] | null>(),
    items: jsonb("items").$type<unknown[]>().notNull().default([]),
    currentProductName: text("current_product_name"),
    currentSourceUrl: text("current_source_url"),
    error: text("error"),
    durationMs: integer("duration_ms"),
    startedAt: timestamp("started_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", {
      mode: "string",
      withTimezone: true,
    }),
    lastProgressAt: timestamp("last_progress_at", {
      mode: "string",
      withTimezone: true,
    }),
    expiresAt: timestamp("expires_at", { mode: "string", withTimezone: true }),
    updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
    tenantId: text("tenant_id").references((): AnyPgColumn => tenant.id, {
      onDelete: "set null",
    }),
  },
  (table) => ({
    scrapeJobIdx: index("shop_import_jobs_scrape_job_id_idx").on(
      table.scrapeJobId,
    ),
    statusStartedAtIdx: index("shop_import_jobs_status_started_at_idx").on(
      table.status,
      table.startedAt,
    ),
    shopImportJobsTenantIdx: index("shop_import_jobs_tenant_id_idx").on(
      table.tenantId,
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

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const excelResearchJobStatusEnum = pgEnum("excel_research_job_status", [
  "draft",
  "queued",
  "running",
  "paused",
  "awaiting_review",
  "exporting",
  "completed",
  "failed",
  "cancelled",
]);

export const excelResearchRowStatusEnum = pgEnum("excel_research_row_status", [
  "pending",
  "processing",
  "matched",
  "needs_review",
  "approved",
  "skipped",
  "error",
]);

export const excelResearchEvidenceTypeEnum = pgEnum(
  "excel_research_evidence_type",
  [
    "catalog_match",
    "web_search",
    "page_scrape",
    "pdf_found",
    "pdf_generated",
    "ai_extraction",
  ],
);

export const excelResearchArtifactKindEnum = pgEnum(
  "excel_research_artifact_kind",
  [
    "original_xlsx",
    "enriched_xlsx",
    "review_report_json",
    "review_report_xlsx",
    "export_zip",
    "pdf_found",
    "pdf_generated",
  ],
);

export const excelResearchJobs = pgTable(
  "excel_research_jobs",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    status: excelResearchJobStatusEnum("status").notNull().default("draft"),
    sourceFileName: text("source_file_name").notNull(),
    sheetName: text("sheet_name").notNull(),
    headerRowIndex: integer("header_row_index").notNull(),
    columnMappingJson: jsonb("column_mapping_json")
      .$type<Record<string, string | null>>()
      .notNull()
      .default({}),
    configJson: jsonb("config_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    totalRows: integer("total_rows").notNull().default(0),
    processedRows: integer("processed_rows").notNull().default(0),
    matchedRows: integer("matched_rows").notNull().default(0),
    needsReviewRows: integer("needs_review_rows").notNull().default(0),
    errorRows: integer("error_rows").notNull().default(0),
    pdfsFoundCount: integer("pdfs_found_count").notNull().default(0),
    pdfsGeneratedCount: integer("pdfs_generated_count").notNull().default(0),
    currentBatchId: uuid("current_batch_id"),
    message: text("message"),
    error: text("error"),
    startedAt: timestamp("started_at", { mode: "string", withTimezone: true }),
    finishedAt: timestamp("finished_at", {
      mode: "string",
      withTimezone: true,
    }),
    lastProgressAt: timestamp("last_progress_at", {
      mode: "string",
      withTimezone: true,
    }),
    expiresAt: timestamp("expires_at", { mode: "string", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
    tenantId: text("tenant_id").references((): AnyPgColumn => tenant.id, {
      onDelete: "set null",
    }),
  },
  (table) => ({
    statusStartedAtIdx: index("excel_research_jobs_status_started_at_idx").on(
      table.status,
      table.startedAt,
    ),
    updatedAtIdx: index("excel_research_jobs_updated_at_idx").on(
      table.updatedAt,
    ),
    excelResearchJobsTenantIdx: index("excel_research_jobs_tenant_id_idx").on(
      table.tenantId,
    ),
  }),
);

export const excelResearchJobRows = pgTable(
  "excel_research_job_rows",
  {
    id: serial("id").primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => excelResearchJobs.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),
    status: excelResearchRowStatusEnum("status").notNull().default("pending"),
    productName: text("product_name").notNull(),
    inputFieldsJson: jsonb("input_fields_json")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    originalCellsJson: jsonb("original_cells_json")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    matchedMaterialId: integer("matched_material_id").references(
      () => materials.id,
      { onDelete: "set null" },
    ),
    selectedCandidateId: integer("selected_candidate_id"),
    confidenceScore: numeric("confidence_score", { precision: 4, scale: 3 }),
    fillPlanJson: jsonb("fill_plan_json").$type<unknown[]>().notNull().default([]),
    excelUpdatesJson: jsonb("excel_updates_json")
      .$type<unknown[]>()
      .notNull()
      .default([]),
    resultJson: jsonb("result_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    errorMessage: text("error_message"),
    attemptCount: integer("attempt_count").notNull().default(0),
    processingToken: uuid("processing_token"),
    processingStartedAt: timestamp("processing_started_at", {
      mode: "string",
      withTimezone: true,
    }),
    reviewedAt: timestamp("reviewed_at", {
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
    jobRowUnique: uniqueIndex("excel_research_job_rows_job_row_unique").on(
      table.jobId,
      table.rowNumber,
    ),
    jobStatusIdx: index("excel_research_job_rows_job_status_idx").on(
      table.jobId,
      table.status,
    ),
  }),
);

export const excelResearchRowEvidence = pgTable(
  "excel_research_row_evidence",
  {
    id: serial("id").primaryKey(),
    jobRowId: integer("job_row_id")
      .notNull()
      .references(() => excelResearchJobRows.id, { onDelete: "cascade" }),
    evidenceType: excelResearchEvidenceTypeEnum("evidence_type").notNull(),
    provider: text("provider").notNull().default(""),
    query: text("query"),
    title: text("title"),
    url: text("url"),
    domain: text("domain"),
    snippet: text("snippet"),
    rawEvidence: text("raw_evidence"),
    imageUrl: text("image_url"),
    materialId: integer("material_id").references(() => materials.id, {
      onDelete: "set null",
    }),
    extractedJson: jsonb("extracted_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    confidenceScore: integer("confidence_score"),
    matchReasonsJson: jsonb("match_reasons_json")
      .$type<unknown>()
      .notNull()
      .default([]),
    isSelected: boolean("is_selected").notNull().default(false),
    artifactId: integer("artifact_id"),
    fetchedAt: timestamp("fetched_at", { mode: "string", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    jobRowIdx: index("excel_research_row_evidence_job_row_idx").on(
      table.jobRowId,
    ),
  }),
);

export const excelResearchFileArtifacts = pgTable(
  "excel_research_file_artifacts",
  {
    id: serial("id").primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => excelResearchJobs.id, { onDelete: "cascade" }),
    jobRowId: integer("job_row_id").references(() => excelResearchJobRows.id, {
      onDelete: "set null",
    }),
    kind: excelResearchArtifactKindEnum("kind").notNull(),
    localFilePath: text("local_file_path").notNull(),
    fileName: text("file_name").notNull(),
    fileSize: bigint("file_size", { mode: "number" }),
    mimeType: text("mime_type"),
    checksum: text("checksum"),
    sourceUrl: text("source_url"),
    metadataJson: jsonb("metadata_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    jobKindIdx: index("excel_research_file_artifacts_job_kind_idx").on(
      table.jobId,
      table.kind,
    ),
  }),
);

export const excelResearchChangeLog = pgTable(
  "excel_research_change_log",
  {
    id: serial("id").primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => excelResearchJobs.id, { onDelete: "cascade" }),
    jobRowId: integer("job_row_id").references(() => excelResearchJobRows.id, {
      onDelete: "set null",
    }),
    rowNumber: integer("row_number"),
    event: text("event").notNull(),
    actor: text("actor").notNull().default("system"),
    field: text("field"),
    before: text("before"),
    after: text("after"),
    action: text("action"),
    payloadJson: jsonb("payload_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    at: timestamp("at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    jobAtIdx: index("excel_research_change_log_job_at_idx").on(
      table.jobId,
      table.at,
    ),
  }),
);

export const materialMatchDecisions = pgTable(
  "material_match_decisions",
  {
    id: serial("id").primaryKey(),
    scrapedProductHash: text("scraped_product_hash").notNull(),
    matchedMaterialId: integer("matched_material_id").references(
      () => materials.id,
      { onDelete: "set null" },
    ),
    matchMethod: text("match_method").notNull().default("trigram"),
    confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),
    reasoning: text("reasoning").notNull().default(""),
    candidatesJson: jsonb("candidates_json")
      .$type<
        Array<{
          materialId: number;
          name: string;
          unit: string;
          score: number;
        }>
      >()
      .notNull()
      .default([]),
    status: text("status").notNull().default("pending"),
    scrapedName: text("scraped_name").notNull().default(""),
    scrapedUnit: text("scraped_unit").notNull().default(""),
    scrapedSourceUrl: text("scraped_source_url").notNull().default(""),
    reviewedAt: timestamp("reviewed_at", {
      mode: "string",
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    hashUniqueIdx: uniqueIndex("material_match_decisions_hash_unique").on(
      table.scrapedProductHash,
    ),
    statusIdx: index("material_match_decisions_status_idx").on(table.status),
    materialIdx: index("material_match_decisions_material_idx").on(
      table.matchedMaterialId,
    ),
  }),
);

export const materialEnrichmentJobs = pgTable(
  "material_enrichment_jobs",
  {
    id: uuid("id").primaryKey(),
    status: shopJobStatusEnum("status").notNull().default("queued"),
    optionsJson: jsonb("options_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    materialIds: jsonb("material_ids").$type<number[]>().notNull().default([]),
    filterSnapshotJson: jsonb("filter_snapshot_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    total: integer("total").notNull().default(0),
    processed: integer("processed").notNull().default(0),
    matched: integer("matched").notNull().default(0),
    needsReview: integer("needs_review").notNull().default(0),
    pdfsFound: integer("pdfs_found").notNull().default(0),
    pdfsGenerated: integer("pdfs_generated").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    currentMaterialId: integer("current_material_id"),
    currentMaterialName: text("current_material_name"),
    message: text("message"),
    error: text("error"),
    startedAt: timestamp("started_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", {
      mode: "string",
      withTimezone: true,
    }),
    lastProgressAt: timestamp("last_progress_at", {
      mode: "string",
      withTimezone: true,
    }),
    expiresAt: timestamp("expires_at", { mode: "string", withTimezone: true }),
    updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
    tenantId: text("tenant_id").references((): AnyPgColumn => tenant.id, {
      onDelete: "set null",
    }),
  },
  (table) => ({
    statusStartedAtIdx: index(
      "material_enrichment_jobs_status_started_at_idx",
    ).on(table.status, table.startedAt),
    materialEnrichmentJobsTenantIdx: index(
      "material_enrichment_jobs_tenant_id_idx",
    ).on(table.tenantId),
  }),
);

export const materialEnrichmentItems = pgTable(
  "material_enrichment_items",
  {
    id: serial("id").primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => materialEnrichmentJobs.id, { onDelete: "cascade" }),
    materialId: integer("material_id")
      .notNull()
      .references(() => materials.id, { onDelete: "cascade" }),
    originalSnapshotJson: jsonb("original_snapshot_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    resultJson: jsonb("result_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    status: text("status").notNull().default("pending"),
    committedAt: timestamp("committed_at", {
      mode: "string",
      withTimezone: true,
    }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    jobSortOrderIdx: index("material_enrichment_items_job_sort_order_idx").on(
      table.jobId,
      table.sortOrder,
    ),
    materialIdx: index("material_enrichment_items_material_idx").on(
      table.materialId,
    ),
  }),
);

export const materialWebCandidates = pgTable(
  "material_web_candidates",
  {
    id: serial("id").primaryKey(),
    enrichmentItemId: integer("enrichment_item_id")
      .notNull()
      .references(() => materialEnrichmentItems.id, { onDelete: "cascade" }),
    materialId: integer("material_id")
      .notNull()
      .references(() => materials.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("duckduckgo"),
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
    catalogPdfUrls: jsonb("catalog_pdf_urls")
      .$type<string[]>()
      .notNull()
      .default([]),
    confidenceScore: integer("confidence_score").notNull().default(0),
    matchReasons: jsonb("match_reasons")
      .$type<string[]>()
      .notNull()
      .default([]),
    isSelected: boolean("is_selected").notNull().default(false),
    sourceType: text("source_type"),
    fetchedAt: timestamp("fetched_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    enrichmentItemIdx: index(
      "material_web_candidates_enrichment_item_idx",
    ).on(table.enrichmentItemId),
    materialIdx: index("material_web_candidates_material_idx").on(
      table.materialId,
    ),
    urlIdx: index("material_web_candidates_url_idx").on(table.url),
  }),
);

export const materialEnrichmentEvents = pgTable(
  "material_enrichment_events",
  {
    id: serial("id").primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => materialEnrichmentJobs.id, { onDelete: "cascade" }),
    itemId: integer("item_id").references(() => materialEnrichmentItems.id, {
      onDelete: "cascade",
    }),
    materialId: integer("material_id").references(() => materials.id, {
      onDelete: "set null",
    }),
    field: text("field").notNull(),
    beforeValue: text("before_value"),
    afterValue: text("after_value"),
    action: text("action").notNull(),
    evidenceJson: jsonb("evidence_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    jobCreatedAtIdx: index("material_enrichment_events_job_created_at_idx").on(
      table.jobId,
      table.createdAt,
    ),
    itemIdx: index("material_enrichment_events_item_idx").on(table.itemId),
  }),
);

// ---------------------------------------------------------------------------
// Auth + multi-tenancy foundation
//
// Tables below are managed by Better Auth (the drizzle adapter maps each model
// field to the matching property key on these tables). Column shapes mirror
// Better Auth 1.6.x `getAuthTables()` core schema plus the `admin` plugin
// fields (role/banned/banReason/banExpires on user, impersonatedBy on session).
// Better Auth generates string ids, so primary keys are text, not serial.
// ---------------------------------------------------------------------------

export const roleEnum = pgEnum("user_role", [
  "admin",
  "manager",
  "staff",
  "customer",
]);

// A tenant is a customer organization. Internal staff/manager/admin users have
// a null tenantId; customer users belong to exactly one tenant. Owned-data
// tables carry a nullable tenantId so this additive migration never locks out
// existing single-tenant rows (a later backfill assigns a host tenant).
export const tenant = pgTable(
  "tenant",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    tenantSlugUnique: uniqueIndex("tenant_slug_unique").on(table.slug),
  }),
);

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: roleEnum("role").notNull().default("customer"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires", { mode: "date" }),
  tenantId: text("tenant_id").references(() => tenant.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    token: text("token").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonated_by"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    sessionTokenUnique: uniqueIndex("session_token_unique").on(table.token),
    sessionUserIdx: index("session_user_id_idx").on(table.userId),
  }),
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      mode: "date",
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      mode: "date",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    accountUserIdx: index("account_user_id_idx").on(table.userId),
  }),
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    verificationIdentifierIdx: index("verification_identifier_idx").on(
      table.identifier,
    ),
  }),
);
