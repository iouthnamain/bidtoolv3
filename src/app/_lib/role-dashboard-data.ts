import { and, count, desc, eq, isNull, sql } from "drizzle-orm";

import { env } from "~/env";
import type { Role } from "~/lib/permissions";
import { db } from "~/server/db";
import {
  excelResearchJobs,
  materialCatalogDocumentLinks,
  materialCatalogDocuments,
  materialEnrichmentJobs,
  materials,
  notifications,
  shopImportJobs,
  shopScrapeJobs,
  tenant,
  tenderPackages,
  user,
  workflowRuns,
  workflows,
} from "~/server/db/schema";
import { getVersionStatus } from "~/server/services/version-info";

type CountRow = { value: number };

export type DashboardMetric = {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "neutral" | "success" | "warning" | "critical" | "info";
};

export type DashboardQueueItem = {
  id: string;
  title: string;
  meta: string;
  href?: string;
  tone?: "neutral" | "success" | "warning" | "critical" | "info";
};

export type GovernanceMetrics = {
  totalUsers: number;
  usersByRole: Record<Role, number>;
  bannedUsers: number;
  tenantlessCustomers: number;
  totalTenants: number;
};

export type OperationsMetrics = {
  totalPackages: number;
  totalMaterials: number;
  pricedMaterials: number;
  catalogLinkedMaterials: number;
  totalCatalogDocuments: number;
  localCatalogDocuments: number;
  totalWorkflows: number;
  activeWorkflows: number;
  failedWorkflowRuns: number;
  unreadAlerts: number;
  activeJobs: number;
  failedJobs: number;
};

export type RoleDashboardSnapshot = {
  authEnabled: boolean;
  version: {
    current: string;
    latest: string | null;
    surface: string;
    updateAvailable: boolean;
  } | null;
  governance: GovernanceMetrics;
  operations: OperationsMetrics;
  attentionQueue: DashboardQueueItem[];
  recentAlerts: DashboardQueueItem[];
  isDegraded: boolean;
};

const emptyGovernance: GovernanceMetrics = {
  totalUsers: 0,
  usersByRole: { admin: 0, manager: 0, staff: 0, customer: 0 },
  bannedUsers: 0,
  tenantlessCustomers: 0,
  totalTenants: 0,
};

const emptyOperations: OperationsMetrics = {
  totalPackages: 0,
  totalMaterials: 0,
  pricedMaterials: 0,
  catalogLinkedMaterials: 0,
  totalCatalogDocuments: 0,
  localCatalogDocuments: 0,
  totalWorkflows: 0,
  activeWorkflows: 0,
  failedWorkflowRuns: 0,
  unreadAlerts: 0,
  activeJobs: 0,
  failedJobs: 0,
};

function numberValue(rows: CountRow[]): number {
  return Number(rows[0]?.value ?? 0);
}

async function safe<T, F>(task: Promise<T>, fallback: F): Promise<T | F> {
  try {
    return await task;
  } catch {
    return fallback;
  }
}

async function getGovernanceMetrics(): Promise<GovernanceMetrics> {
  const [roleRows, bannedRows, tenantlessRows, tenantRows] = await Promise.all([
    db
      .select({ role: user.role, value: sql<number>`count(*)::int`.as("value") })
      .from(user)
      .groupBy(user.role),
    db
      .select({ value: sql<number>`count(*)::int`.as("value") })
      .from(user)
      .where(eq(user.banned, true)),
    db
      .select({ value: sql<number>`count(*)::int`.as("value") })
      .from(user)
      .where(and(eq(user.role, "customer"), isNull(user.tenantId))),
    db.select({ value: count() }).from(tenant),
  ]);

  const usersByRole: GovernanceMetrics["usersByRole"] = {
    admin: 0,
    manager: 0,
    staff: 0,
    customer: 0,
  };

  for (const row of roleRows) {
    usersByRole[row.role] = Number(row.value ?? 0);
  }

  return {
    totalUsers: Object.values(usersByRole).reduce((sum, value) => sum + value, 0),
    usersByRole,
    bannedUsers: numberValue(bannedRows),
    tenantlessCustomers: numberValue(tenantlessRows),
    totalTenants: Number(tenantRows[0]?.value ?? 0),
  };
}

async function getOperationsMetrics(): Promise<OperationsMetrics> {
  const [
    packageRows,
    materialRows,
    catalogLinkedRows,
    catalogRows,
    workflowRows,
    failedWorkflowRows,
    alertRows,
    scrapeActiveRows,
    scrapeFailedRows,
    importActiveRows,
    importFailedRows,
    excelActiveRows,
    excelFailedRows,
    enrichmentActiveRows,
    enrichmentFailedRows,
  ] = await Promise.all([
    db.select({ value: count() }).from(tenderPackages),
    db
      .select({
        total: sql<number>`count(*)::int`,
        priced:
          sql<number>`count(*) filter (where ${materials.defaultUnitPrice} is not null)::int`,
      })
      .from(materials)
      .where(isNull(materials.deletedAt)),
    db
      .select({
        value:
          sql<number>`count(distinct ${materialCatalogDocumentLinks.materialId})::int`.as(
            "value",
          ),
      })
      .from(materialCatalogDocumentLinks),
    db
      .select({
        total: sql<number>`count(*)::int`,
        local:
          sql<number>`count(*) filter (where ${materialCatalogDocuments.localFilePath} is not null)::int`,
      })
      .from(materialCatalogDocuments)
      .where(isNull(materialCatalogDocuments.deletedAt)),
    db
      .select({
        total: sql<number>`count(*)::int`,
        active:
          sql<number>`count(*) filter (where ${workflows.isActive} = true)::int`,
      })
      .from(workflows),
    db
      .select({ value: sql<number>`count(*)::int`.as("value") })
      .from(workflowRuns)
      .where(eq(workflowRuns.status, "failed")),
    db
      .select({ value: sql<number>`count(*)::int`.as("value") })
      .from(notifications)
      .where(eq(notifications.isRead, false)),
    db
      .select({ value: sql<number>`count(*)::int`.as("value") })
      .from(shopScrapeJobs)
      .where(sql`${shopScrapeJobs.status} in ('queued', 'running')`),
    db
      .select({ value: sql<number>`count(*)::int`.as("value") })
      .from(shopScrapeJobs)
      .where(eq(shopScrapeJobs.status, "failed")),
    db
      .select({ value: sql<number>`count(*)::int`.as("value") })
      .from(shopImportJobs)
      .where(sql`${shopImportJobs.status} in ('queued', 'running')`),
    db
      .select({ value: sql<number>`count(*)::int`.as("value") })
      .from(shopImportJobs)
      .where(eq(shopImportJobs.status, "failed")),
    db
      .select({ value: sql<number>`count(*)::int`.as("value") })
      .from(excelResearchJobs)
      .where(sql`${excelResearchJobs.status} in ('queued', 'running', 'paused')`),
    db
      .select({ value: sql<number>`count(*)::int`.as("value") })
      .from(excelResearchJobs)
      .where(eq(excelResearchJobs.status, "failed")),
    db
      .select({ value: sql<number>`count(*)::int`.as("value") })
      .from(materialEnrichmentJobs)
      .where(sql`${materialEnrichmentJobs.status} in ('queued', 'running')`),
    db
      .select({ value: sql<number>`count(*)::int`.as("value") })
      .from(materialEnrichmentJobs)
      .where(eq(materialEnrichmentJobs.status, "failed")),
  ]);

  const activeJobs =
    numberValue(scrapeActiveRows) +
    numberValue(importActiveRows) +
    numberValue(excelActiveRows) +
    numberValue(enrichmentActiveRows);
  const failedJobs =
    numberValue(scrapeFailedRows) +
    numberValue(importFailedRows) +
    numberValue(excelFailedRows) +
    numberValue(enrichmentFailedRows);

  return {
    totalPackages: Number(packageRows[0]?.value ?? 0),
    totalMaterials: Number(materialRows[0]?.total ?? 0),
    pricedMaterials: Number(materialRows[0]?.priced ?? 0),
    catalogLinkedMaterials: numberValue(catalogLinkedRows),
    totalCatalogDocuments: Number(catalogRows[0]?.total ?? 0),
    localCatalogDocuments: Number(catalogRows[0]?.local ?? 0),
    totalWorkflows: Number(workflowRows[0]?.total ?? 0),
    activeWorkflows: Number(workflowRows[0]?.active ?? 0),
    failedWorkflowRuns: numberValue(failedWorkflowRows),
    unreadAlerts: numberValue(alertRows),
    activeJobs,
    failedJobs,
  };
}

async function getAttentionQueue(): Promise<DashboardQueueItem[]> {
  const [failedRuns, tenantlessRows, alerts] = await Promise.all([
    db
      .select({
        id: workflowRuns.id,
        workflowId: workflows.id,
        name: workflows.name,
        message: workflowRuns.message,
        startedAt: workflowRuns.startedAt,
      })
      .from(workflowRuns)
      .innerJoin(workflows, eq(workflowRuns.workflowId, workflows.id))
      .where(eq(workflowRuns.status, "failed"))
      .orderBy(desc(workflowRuns.startedAt))
      .limit(4),
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
      })
      .from(user)
      .where(and(eq(user.role, "customer"), isNull(user.tenantId)))
      .limit(3),
    db
      .select({
        id: notifications.id,
        title: notifications.title,
        severity: notifications.severity,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(eq(notifications.isRead, false))
      .orderBy(desc(notifications.createdAt))
      .limit(4),
  ]);

  return [
    ...failedRuns.map((run): DashboardQueueItem => ({
      id: `workflow-${run.id}`,
      title: run.name,
      meta: run.message || `Workflow lỗi lúc ${run.startedAt}`,
      href: `/workflows/${run.workflowId}`,
      tone: "critical",
    })),
    ...tenantlessRows.map((row): DashboardQueueItem => ({
      id: `tenantless-${row.id}`,
      title: row.name || row.email,
      meta: "Customer chưa được gán tenant",
      href: "/settings/users",
      tone: "warning",
    })),
    ...alerts.map((alert): DashboardQueueItem => ({
      id: `alert-${alert.id}`,
      title: alert.title,
      meta: `Thông báo ${alert.severity} · ${alert.createdAt}`,
      href: "/notifications",
      tone: alert.severity === "high" ? "critical" : "info",
    })),
  ].slice(0, 8);
}

async function getRecentAlerts(): Promise<DashboardQueueItem[]> {
  const rows = await db
    .select({
      id: notifications.id,
      title: notifications.title,
      body: notifications.body,
      severity: notifications.severity,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .orderBy(desc(notifications.createdAt))
    .limit(6);

  return rows.map((row) => ({
    id: `notification-${row.id}`,
    title: row.title,
    meta: row.body || row.createdAt,
    href: "/notifications",
    tone: row.severity === "high" ? "critical" : "neutral",
  }));
}

export async function getRoleDashboardSnapshot(): Promise<RoleDashboardSnapshot> {
  const [version, governance, operations, attentionQueue, recentAlerts] =
    await Promise.all([
      safe(getVersionStatus(), null),
      safe(getGovernanceMetrics(), emptyGovernance),
      safe(getOperationsMetrics(), emptyOperations),
      safe(getAttentionQueue(), []),
      safe(getRecentAlerts(), []),
    ]);

  return {
    authEnabled: env.AUTH_ENABLED === "true",
    version: version
      ? {
          current: version.current,
          latest: version.latest ?? null,
          surface: version.surface,
          updateAvailable: version.updateAvailable,
        }
      : null,
    governance,
    operations,
    attentionQueue,
    recentAlerts,
    isDegraded: !version,
  };
}
