import "server-only";

import { and, desc, eq, gte, lt, sql } from "drizzle-orm";

import { createLogger } from "~/server/lib/logger";
import { db } from "~/server/db";
import { searchAuditLogs } from "~/server/db/schema";
import { hasDatabaseUrl } from "~/server/runtime";
import {
  resolveSearchAuditRetentionDays,
  type SearchDomainPolicy,
} from "~/server/services/app-settings";

const log = createLogger("search-audit");

export type SearchAuditStatus = "success" | "no_results" | "error" | "skipped";

export type SearchAuditFeature =
  | "material_enrichment"
  | "excel_research"
  | "interactive"
  | "profile_search"
  | "test";

export type SearchAuditTopResult = {
  title: string;
  url: string;
  domain: string;
  rankScore: number;
  reasons: string[];
};

type SearchAuditEvent = {
  feature: SearchAuditFeature;
  provider?: string;
  query: string;
  engines: string[];
  language: string;
  resultCount: number;
  selectedResultCount?: number;
  durationMs: number;
  status: SearchAuditStatus;
  warnings?: string[];
  errorText?: string;
  topResults?: SearchAuditTopResult[];
  rankingPolicy: SearchDomainPolicy;
};

function normalizeQuery(query: string) {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}...`;
}

function auditEnabled() {
  return hasDatabaseUrl();
}

let lastCleanupAt = 0;

export async function cleanupSearchAuditLogs(): Promise<number> {
  if (!auditEnabled()) return 0;

  const retentionDays = await resolveSearchAuditRetentionDays();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(searchAuditLogs)
    .where(lt(searchAuditLogs.createdAt, cutoff.toISOString()))
    .returning({ id: searchAuditLogs.id });

  return deleted.length;
}

async function cleanupSearchAuditLogsOccasionally() {
  const now = Date.now();
  if (now - lastCleanupAt < 60 * 60 * 1000) return;
  lastCleanupAt = now;
  try {
    await cleanupSearchAuditLogs();
  } catch (error) {
    log.warn("search_audit_cleanup_failed", { error });
  }
}

export async function recordSearchAuditLog(event: SearchAuditEvent) {
  if (!auditEnabled()) return;

  try {
    await cleanupSearchAuditLogsOccasionally();
    await db.insert(searchAuditLogs).values({
      feature: event.feature,
      provider: event.provider ?? "searxng",
      query: event.query,
      normalizedQuery: normalizeQuery(event.query),
      engines: event.engines.join(","),
      language: event.language,
      resultCount: event.resultCount,
      selectedResultCount: event.selectedResultCount ?? 0,
      durationMs: Math.max(0, Math.round(event.durationMs)),
      status: event.status,
      warningText: truncateText((event.warnings ?? []).join(" | "), 2000),
      errorText: truncateText(event.errorText ?? "", 2000),
      topResultsJson: (event.topResults ?? []).slice(0, 8).map((result) => ({
        title: truncateText(result.title, 240),
        url: truncateText(result.url, 500),
        domain: result.domain,
        rankScore: result.rankScore,
        reasons: result.reasons.slice(0, 8),
      })),
      rankingPolicyJson: event.rankingPolicy,
    });
  } catch (error) {
    log.warn("search_audit_insert_failed", { error });
  }
}

export async function listSearchAuditLogs(input: {
  limit: number;
  status?: SearchAuditStatus;
  feature?: SearchAuditFeature;
}) {
  if (!auditEnabled()) return [];

  const conditions = [
    input.status ? eq(searchAuditLogs.status, input.status) : undefined,
    input.feature ? eq(searchAuditLogs.feature, input.feature) : undefined,
  ].filter(Boolean);

  return db
    .select({
      id: searchAuditLogs.id,
      feature: searchAuditLogs.feature,
      provider: searchAuditLogs.provider,
      query: searchAuditLogs.query,
      engines: searchAuditLogs.engines,
      language: searchAuditLogs.language,
      resultCount: searchAuditLogs.resultCount,
      selectedResultCount: searchAuditLogs.selectedResultCount,
      durationMs: searchAuditLogs.durationMs,
      status: searchAuditLogs.status,
      warningText: searchAuditLogs.warningText,
      errorText: searchAuditLogs.errorText,
      topResultsJson: searchAuditLogs.topResultsJson,
      createdAt: searchAuditLogs.createdAt,
    })
    .from(searchAuditLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(searchAuditLogs.createdAt), desc(searchAuditLogs.id))
    .limit(input.limit);
}

export async function getSearchAuditSummary() {
  if (!auditEnabled()) {
    return {
      total24h: 0,
      success24h: 0,
      noResults24h: 0,
      errors24h: 0,
      medianDurationMs24h: 0,
      avgDurationMs24h: 0,
    };
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [row] = await db
    .select({
      total24h: sql<number>`count(*)::int`,
      success24h: sql<number>`count(*) filter (where ${searchAuditLogs.status} = 'success')::int`,
      noResults24h: sql<number>`count(*) filter (where ${searchAuditLogs.status} = 'no_results')::int`,
      errors24h: sql<number>`count(*) filter (where ${searchAuditLogs.status} = 'error')::int`,
      medianDurationMs24h: sql<number>`coalesce(percentile_cont(0.5) within group (order by ${searchAuditLogs.durationMs}), 0)::int`,
      avgDurationMs24h: sql<number>`coalesce(avg(${searchAuditLogs.durationMs}), 0)::int`,
    })
    .from(searchAuditLogs)
    .where(gte(searchAuditLogs.createdAt, since));

  return {
    total24h: row?.total24h ?? 0,
    success24h: row?.success24h ?? 0,
    noResults24h: row?.noResults24h ?? 0,
    errors24h: row?.errors24h ?? 0,
    medianDurationMs24h: row?.medianDurationMs24h ?? 0,
    avgDurationMs24h: row?.avgDurationMs24h ?? 0,
  };
}
