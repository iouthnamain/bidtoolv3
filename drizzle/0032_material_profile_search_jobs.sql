CREATE TABLE IF NOT EXISTS "material_profile_search_jobs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "excel_workspaces"("id") ON DELETE CASCADE,
  "status" "shop_job_status" DEFAULT 'queued' NOT NULL,
  "mode" text NOT NULL,
  "requested_item_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "total" integer DEFAULT 0 NOT NULL,
  "processed" integer DEFAULT 0 NOT NULL,
  "found" integer DEFAULT 0 NOT NULL,
  "partial" integer DEFAULT 0 NOT NULL,
  "failed" integer DEFAULT 0 NOT NULL,
  "skipped" integer DEFAULT 0 NOT NULL,
  "current_item_id" integer REFERENCES "excel_workspace_items"("id") ON DELETE SET NULL,
  "current_row_index" integer,
  "current_product_name" text,
  "message" text,
  "error" text,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "last_progress_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "material_profile_search_jobs_workspace_updated_at_idx"
  ON "material_profile_search_jobs" ("workspace_id", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "material_profile_search_jobs_status_started_at_idx"
  ON "material_profile_search_jobs" ("status", "started_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "material_profile_search_runs" (
  "id" serial PRIMARY KEY NOT NULL,
  "job_id" uuid NOT NULL REFERENCES "material_profile_search_jobs"("id") ON DELETE CASCADE,
  "workspace_id" integer NOT NULL REFERENCES "excel_workspaces"("id") ON DELETE CASCADE,
  "item_id" integer NOT NULL REFERENCES "excel_workspace_items"("id") ON DELETE CASCADE,
  "original_row_index" integer NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "mode" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "is_current" boolean DEFAULT false NOT NULL,
  "source_web_run_id" integer REFERENCES "material_profile_search_runs"("id") ON DELETE SET NULL,
  "input_snapshot_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "queries_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "web_links_status" text DEFAULT 'idle' NOT NULL,
  "ai_search_status" text DEFAULT 'idle' NOT NULL,
  "web_link_results_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "ai_search_candidates_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "recommended_candidate_key" text,
  "warnings_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "error_message" text,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "material_profile_search_runs_job_sort_order_idx"
  ON "material_profile_search_runs" ("job_id", "sort_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "material_profile_search_runs_workspace_item_updated_at_idx"
  ON "material_profile_search_runs" ("workspace_id", "item_id", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "material_profile_search_runs_workspace_current_idx"
  ON "material_profile_search_runs" ("workspace_id", "is_current");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "material_profile_search_runs_current_item_unique"
  ON "material_profile_search_runs" ("item_id")
  WHERE "is_current" = true;
--> statement-breakpoint
WITH legacy_items AS (
  SELECT
    item."id",
    item."workspace_id",
    item."original_row_index",
    item."sort_order",
    item."product_name",
    item."spec_text",
    item."unit",
    item."vendor_hint",
    item."origin_hint",
    item."original_data_json",
    item."review_decision_json"
  FROM "excel_workspace_items" item
  WHERE jsonb_typeof(item."review_decision_json") = 'object'
    AND (
      item."review_decision_json" ? 'webLinkResults'
      OR item."review_decision_json" ? 'aiSearchCandidates'
      OR item."review_decision_json" ? 'aiSearchResult'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "material_profile_search_runs" run
      WHERE run."item_id" = item."id"
    )
),
workspace_jobs AS (
  INSERT INTO "material_profile_search_jobs" (
    "id",
    "workspace_id",
    "status",
    "mode",
    "requested_item_ids",
    "total",
    "processed",
    "found",
    "message",
    "started_at",
    "finished_at",
    "last_progress_at",
    "created_at",
    "updated_at"
  )
  SELECT
    gen_random_uuid(),
    legacy_items."workspace_id",
    'completed'::"shop_job_status",
    CASE
      WHEN bool_or(
        legacy_items."review_decision_json" ? 'aiSearchCandidates'
        OR legacy_items."review_decision_json" ? 'aiSearchResult'
      ) THEN 'ai'
      ELSE 'web'
    END,
    jsonb_agg(legacy_items."id" ORDER BY legacy_items."sort_order"),
    count(*)::integer,
    count(*)::integer,
    count(*)::integer,
    'Đã nhập lịch sử tìm kiếm từ dữ liệu duyệt cũ.',
    now(),
    now(),
    now(),
    now(),
    now()
  FROM legacy_items
  GROUP BY legacy_items."workspace_id"
  RETURNING "id", "workspace_id"
)
INSERT INTO "material_profile_search_runs" (
  "job_id",
  "workspace_id",
  "item_id",
  "original_row_index",
  "sort_order",
  "mode",
  "status",
  "is_current",
  "input_snapshot_json",
  "queries_json",
  "web_links_status",
  "ai_search_status",
  "web_link_results_json",
  "ai_search_candidates_json",
  "recommended_candidate_key",
  "warnings_json",
  "started_at",
  "finished_at",
  "created_at",
  "updated_at"
)
SELECT
  workspace_jobs."id",
  legacy_items."workspace_id",
  legacy_items."id",
  legacy_items."original_row_index",
  legacy_items."sort_order",
  CASE
    WHEN legacy_items."review_decision_json" ? 'aiSearchCandidates'
      OR legacy_items."review_decision_json" ? 'aiSearchResult'
    THEN 'ai'
    ELSE 'web'
  END,
  'completed',
  true,
  jsonb_build_object(
    'name', legacy_items."product_name",
    'specText', legacy_items."spec_text",
    'unit', legacy_items."unit",
    'manufacturer', legacy_items."vendor_hint",
    'originCountry', legacy_items."origin_hint",
    'originalDataJson', legacy_items."original_data_json"
  ),
  '[]'::jsonb,
  CASE
    WHEN jsonb_typeof(legacy_items."review_decision_json"->'webLinksStatus') = 'string'
      THEN trim(both '"' from (legacy_items."review_decision_json"->'webLinksStatus')::text)
    WHEN jsonb_typeof(legacy_items."review_decision_json"->'webLinkResults') = 'array'
      AND jsonb_array_length(legacy_items."review_decision_json"->'webLinkResults') > 0
      THEN 'done'
    ELSE 'idle'
  END,
  CASE
    WHEN jsonb_typeof(legacy_items."review_decision_json"->'aiSearchStatus') = 'string'
      THEN trim(both '"' from (legacy_items."review_decision_json"->'aiSearchStatus')::text)
    WHEN jsonb_typeof(legacy_items."review_decision_json"->'aiSearchCandidates') = 'array'
      AND jsonb_array_length(legacy_items."review_decision_json"->'aiSearchCandidates') > 0
      THEN 'done'
    WHEN jsonb_typeof(legacy_items."review_decision_json"->'aiSearchResult') = 'object'
      THEN 'done'
    ELSE 'idle'
  END,
  CASE
    WHEN jsonb_typeof(legacy_items."review_decision_json"->'webLinkResults') = 'array'
      THEN legacy_items."review_decision_json"->'webLinkResults'
    ELSE '[]'::jsonb
  END,
  CASE
    WHEN jsonb_typeof(legacy_items."review_decision_json"->'aiSearchCandidates') = 'array'
      THEN legacy_items."review_decision_json"->'aiSearchCandidates'
    WHEN jsonb_typeof(legacy_items."review_decision_json"->'aiSearchResult') = 'object'
      THEN jsonb_build_array(legacy_items."review_decision_json"->'aiSearchResult')
    ELSE '[]'::jsonb
  END,
  CASE
    WHEN jsonb_typeof(legacy_items."review_decision_json"->'selectedSearchCandidateKey') = 'string'
      THEN trim(both '"' from (legacy_items."review_decision_json"->'selectedSearchCandidateKey')::text)
    WHEN legacy_items."review_decision_json" ? 'aiSearchResult'
      OR legacy_items."review_decision_json" ? 'aiSearchCandidates'
      THEN 'ai:0'
    ELSE NULL
  END,
  '[]'::jsonb,
  now(),
  now(),
  now(),
  now()
FROM legacy_items
JOIN workspace_jobs
  ON workspace_jobs."workspace_id" = legacy_items."workspace_id";
