import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, ilike, inArray, isNull, or } from "drizzle-orm";

import { db } from "~/server/db";
import {
  materialControlLocations,
  materialControlPlans,
  materialControlProjects,
  materialControlProjectSources,
  materialControlRequirements,
} from "~/server/db/schema";

type AppDb = typeof db;

export type MaterialControlProjectStatus =
  | "draft"
  | "active"
  | "on_hold"
  | "completed"
  | "archived";
export type MaterialControlProjectSourceType =
  | "tender_package"
  | "tender_plan"
  | "investment_project"
  | "manual";
export type MaterialControlLocationType =
  | "warehouse"
  | "site"
  | "zone"
  | "transit"
  | "installed"
  | "waste"
  | "virtual";
export type MaterialControlPlanStatus =
  | "draft"
  | "active"
  | "completed"
  | "archived";

export class MaterialControlServiceError extends TRPCError {
  constructor(
    readonly serviceCode: "NOT_FOUND" | "CONFLICT" | "BAD_REQUEST",
    message: string,
  ) {
    super({ code: serviceCode, message });
    this.name = "MaterialControlServiceError";
  }
}

export type ProjectSourceInput = Readonly<{
  sourceType: MaterialControlProjectSourceType;
  tenderPackageId?: number | null;
  tenderPlanId?: number | null;
  investmentProjectId?: number | null;
  externalReference?: string | null;
  label?: string;
  sourceUrl?: string | null;
}>;

export type ProjectSourceView = Readonly<{
  id: number;
  sourceType: MaterialControlProjectSourceType;
  tenderPackageId: number | null;
  tenderPlanId: number | null;
  investmentProjectId: number | null;
  externalReference: string | null;
  label: string;
  sourceUrl: string | null;
  createdAt: string;
}>;

export type ProjectView = Readonly<{
  id: number;
  code: string | null;
  name: string;
  status: MaterialControlProjectStatus;
  description: string;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  actualStartAt: string | null;
  actualEndAt: string | null;
  notes: string;
  sources: readonly ProjectSourceView[];
  createdAt: string;
  updatedAt: string;
}>;

export type CreateProjectInput = Readonly<{
  code?: string | null;
  name: string;
  status?: MaterialControlProjectStatus;
  description?: string;
  plannedStartAt?: string | Date | null;
  plannedEndAt?: string | Date | null;
  actualStartAt?: string | Date | null;
  actualEndAt?: string | Date | null;
  notes?: string;
  sources?: readonly ProjectSourceInput[];
  sourceLinks?: readonly ProjectSourceInput[];
}>;

export type UpdateProjectInput = Readonly<{
  id: number;
  code?: string | null;
  name?: string;
  status?: MaterialControlProjectStatus;
  description?: string;
  plannedStartAt?: string | Date | null;
  plannedEndAt?: string | Date | null;
  actualStartAt?: string | Date | null;
  actualEndAt?: string | Date | null;
  notes?: string;
  sources?: readonly ProjectSourceInput[];
  sourceLinks?: readonly ProjectSourceInput[];
}>;

export type ListProjectsInput = Readonly<{
  status?: MaterialControlProjectStatus;
  keyword?: string;
  limit?: number;
  offset?: number;
}>;

export type CreateLocationInput = Readonly<{
  projectId?: number | null;
  parentId?: number | null;
  code: string;
  name: string;
  type: MaterialControlLocationType;
  isVirtual?: boolean;
  notes?: string;
}>;

export type UpdateLocationInput = Readonly<{
  id: number;
  projectId?: number | null;
  parentId?: number | null;
  code?: string;
  name?: string;
  type?: MaterialControlLocationType;
  isVirtual?: boolean;
  notes?: string;
}>;

export type LocationView = Readonly<{
  id: number;
  projectId: number | null;
  parentId: number | null;
  code: string;
  name: string;
  type: MaterialControlLocationType;
  isVirtual: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
}>;

export type CreatePlanInput = Readonly<{
  projectId: number;
  name: string;
  status?: MaterialControlPlanStatus;
  plannedStartAt?: string | Date | null;
  plannedEndAt?: string | Date | null;
  notes?: string;
}>;

export type UpdatePlanInput = Readonly<{
  id: number;
  name?: string;
  status?: MaterialControlPlanStatus;
  plannedStartAt?: string | Date | null;
  plannedEndAt?: string | Date | null;
  notes?: string;
}>;

export type PlanView = Readonly<{
  id: number;
  projectId: number;
  name: string;
  status: MaterialControlPlanStatus;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  notes: string;
  requirementCount: number;
  totalRequiredQuantity: number;
  createdAt: string;
  updatedAt: string;
}>;

type ProjectRow = typeof materialControlProjects.$inferSelect;
type SourceRow = typeof materialControlProjectSources.$inferSelect;
type LocationRow = typeof materialControlLocations.$inferSelect;
type PlanRow = typeof materialControlPlans.$inferSelect;

function fail(
  code: "NOT_FOUND" | "CONFLICT" | "BAD_REQUEST",
  message: string,
): never {
  throw new MaterialControlServiceError(code, message);
}

function stringValue(value: string | undefined, label: string): string {
  const result = value?.trim() ?? "";
  if (!result) fail("BAD_REQUEST", `${label} không được để trống.`);
  return result;
}

function optionalText(value: string | null | undefined): string | null {
  const result = value?.trim();
  if (!result) return null;
  return result;
}

export function normalizeOptionalDate(
  value: string | Date | null | undefined,
  label: string,
): string | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    fail("BAD_REQUEST", `${label} phải là ngày hợp lệ.`);
  }
  return parsed.toISOString();
}

function validateDateRange(
  start: string | null,
  end: string | null,
  label: string,
): void {
  if (start && end && Date.parse(start) > Date.parse(end)) {
    fail("BAD_REQUEST", `${label} bắt đầu phải trước hoặc bằng ngày kết thúc.`);
  }
}

function normalizeProjectDates(input: {
  plannedStartAt?: string | Date | null;
  plannedEndAt?: string | Date | null;
  actualStartAt?: string | Date | null;
  actualEndAt?: string | Date | null;
}) {
  const plannedStartAt = normalizeOptionalDate(
    input.plannedStartAt,
    "Ngày bắt đầu dự kiến",
  );
  const plannedEndAt = normalizeOptionalDate(
    input.plannedEndAt,
    "Ngày kết thúc dự kiến",
  );
  const actualStartAt = normalizeOptionalDate(
    input.actualStartAt,
    "Ngày bắt đầu thực tế",
  );
  const actualEndAt = normalizeOptionalDate(
    input.actualEndAt,
    "Ngày kết thúc thực tế",
  );
  validateDateRange(plannedStartAt, plannedEndAt, "Khoảng thời gian dự kiến");
  validateDateRange(actualStartAt, actualEndAt, "Khoảng thời gian thực tế");
  return { plannedStartAt, plannedEndAt, actualStartAt, actualEndAt };
}

function normalizeSource(input: ProjectSourceInput) {
  const source = {
    sourceType: input.sourceType,
    tenderPackageId: input.tenderPackageId ?? null,
    tenderPlanId: input.tenderPlanId ?? null,
    investmentProjectId: input.investmentProjectId ?? null,
    externalReference: optionalText(input.externalReference),
    label: input.label?.trim() ?? "",
    sourceUrl: optionalText(input.sourceUrl),
  };
  const ids = [
    source.tenderPackageId,
    source.tenderPlanId,
    source.investmentProjectId,
  ];
  if (ids.some((id) => id !== null && (!Number.isInteger(id) || id <= 0))) {
    fail("BAD_REQUEST", "Liên kết nguồn phải dùng mã số dương hợp lệ.");
  }
  if (source.sourceType === "tender_package") {
    if (
      !source.tenderPackageId ||
      source.tenderPlanId ||
      source.investmentProjectId ||
      source.externalReference
    ) {
      fail("BAD_REQUEST", "Nguồn gói thầu cần tenderPackageId duy nhất.");
    }
  } else if (source.sourceType === "tender_plan") {
    if (
      !source.tenderPlanId ||
      source.tenderPackageId ||
      source.investmentProjectId ||
      source.externalReference
    ) {
      fail("BAD_REQUEST", "Nguồn kế hoạch mời thầu cần tenderPlanId duy nhất.");
    }
  } else if (source.sourceType === "investment_project") {
    if (
      !source.investmentProjectId ||
      source.tenderPackageId ||
      source.tenderPlanId ||
      source.externalReference
    ) {
      fail(
        "BAD_REQUEST",
        "Nguồn dự án đầu tư cần investmentProjectId duy nhất.",
      );
    }
  } else if (
    source.sourceType === "manual" &&
    (!source.externalReference ||
      source.tenderPackageId ||
      source.tenderPlanId ||
      source.investmentProjectId)
  ) {
    fail("BAD_REQUEST", "Nguồn thủ công cần externalReference duy nhất.");
  }
  return source;
}

function sourceRows(sources: readonly ProjectSourceInput[] | undefined) {
  return (sources ?? []).map(normalizeSource);
}

function sourceView(row: SourceRow): ProjectSourceView {
  return {
    id: row.id,
    sourceType: row.sourceType,
    tenderPackageId: row.tenderPackageId,
    tenderPlanId: row.tenderPlanId,
    investmentProjectId: row.investmentProjectId,
    externalReference: row.externalReference,
    label: row.label,
    sourceUrl: row.sourceUrl,
    createdAt: row.createdAt,
  };
}

function projectView(
  row: ProjectRow,
  sources: readonly SourceRow[],
): ProjectView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    description: row.description,
    plannedStartAt: row.plannedStartAt,
    plannedEndAt: row.plannedEndAt,
    actualStartAt: row.actualStartAt,
    actualEndAt: row.actualEndAt,
    notes: row.notes,
    sources: sources.map(sourceView),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function locationView(row: LocationRow): LocationView {
  return {
    id: row.id,
    projectId: row.projectId,
    parentId: row.parentId,
    code: row.code,
    name: row.name,
    type: row.type,
    isVirtual: row.isVirtual,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function projectById(database: AppDb, id: number): Promise<ProjectRow> {
  const [row] = await database
    .select()
    .from(materialControlProjects)
    .where(eq(materialControlProjects.id, id))
    .limit(1);
  if (!row) fail("NOT_FOUND", "Dự án không tồn tại.");
  return row;
}

async function projectSources(database: AppDb, projectId: number) {
  return database
    .select()
    .from(materialControlProjectSources)
    .where(eq(materialControlProjectSources.projectId, projectId))
    .orderBy(asc(materialControlProjectSources.id));
}

function inputSources(
  sources: readonly ProjectSourceInput[] | undefined,
  sourceLinks: readonly ProjectSourceInput[] | undefined,
) {
  return sourceRows(sources ?? sourceLinks);
}

function uniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

export async function createProject(
  input: CreateProjectInput,
  database: AppDb = db,
): Promise<ProjectView> {
  const name = stringValue(input.name, "Tên dự án");
  const dates = normalizeProjectDates(input);
  const sources = inputSources(input.sources, input.sourceLinks);
  const code = optionalText(input.code);
  try {
    const result = await database.transaction(async (tx) => {
      const [row] = await tx
        .insert(materialControlProjects)
        .values({
          code,
          name,
          status: input.status ?? "draft",
          description: input.description?.trim() ?? "",
          ...dates,
          notes: input.notes?.trim() ?? "",
        })
        .returning();
      if (!row) fail("BAD_REQUEST", "Không tạo được dự án.");
      const insertedSources = sources.length
        ? await tx
            .insert(materialControlProjectSources)
            .values(sources.map((source) => ({ ...source, projectId: row.id })))
            .returning()
        : [];
      return { row, sources: insertedSources };
    });
    return projectView(result.row, result.sources);
  } catch (error) {
    if (error instanceof MaterialControlServiceError) throw error;
    if (uniqueViolation(error)) {
      fail("CONFLICT", "Mã dự án hoặc liên kết nguồn đã tồn tại.");
    }
    throw error;
  }
}

export async function getProject(
  id: number,
  database: AppDb = db,
): Promise<ProjectView> {
  const row = await projectById(database, id);
  return projectView(row, await projectSources(database, id));
}

export async function listProjects(
  input: ListProjectsInput = {},
  database: AppDb = db,
): Promise<readonly ProjectView[]> {
  const keyword = input.keyword?.trim();
  const rows = await database
    .select()
    .from(materialControlProjects)
    .where(
      and(
        input.status
          ? eq(materialControlProjects.status, input.status)
          : undefined,
        keyword
          ? or(
              ilike(materialControlProjects.name, `%${keyword}%`),
              ilike(materialControlProjects.code, `%${keyword}%`),
            )
          : undefined,
      ),
    )
    .orderBy(
      desc(materialControlProjects.updatedAt),
      desc(materialControlProjects.id),
    )
    .limit(input.limit ?? 100)
    .offset(input.offset ?? 0);
  if (rows.length === 0) return [];
  const sources = await database
    .select()
    .from(materialControlProjectSources)
    .where(
      inArray(
        materialControlProjectSources.projectId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(materialControlProjectSources.id));
  const byProject = new Map<number, SourceRow[]>();
  for (const source of sources) {
    const current = byProject.get(source.projectId) ?? [];
    current.push(source);
    byProject.set(source.projectId, current);
  }
  return rows.map((row) => projectView(row, byProject.get(row.id) ?? []));
}

export async function updateProject(
  input: UpdateProjectInput,
  database: AppDb = db,
): Promise<ProjectView> {
  const sourcesProvided =
    input.sources !== undefined || input.sourceLinks !== undefined;
  const dates = normalizeProjectDates(input);
  try {
    await database.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(materialControlProjects)
        .where(eq(materialControlProjects.id, input.id))
        .limit(1);
      if (!current) fail("NOT_FOUND", "Dự án không tồn tại.");
      const nextPlannedStartAt =
        input.plannedStartAt === undefined
          ? current.plannedStartAt
          : dates.plannedStartAt;
      const nextPlannedEndAt =
        input.plannedEndAt === undefined
          ? current.plannedEndAt
          : dates.plannedEndAt;
      const nextActualStartAt =
        input.actualStartAt === undefined
          ? current.actualStartAt
          : dates.actualStartAt;
      const nextActualEndAt =
        input.actualEndAt === undefined
          ? current.actualEndAt
          : dates.actualEndAt;
      validateDateRange(
        nextPlannedStartAt,
        nextPlannedEndAt,
        "Khoảng thời gian dự kiến",
      );
      validateDateRange(
        nextActualStartAt,
        nextActualEndAt,
        "Khoảng thời gian thực tế",
      );
      const nextName =
        input.name === undefined
          ? current.name
          : stringValue(input.name, "Tên dự án");
      const [updated] = await tx
        .update(materialControlProjects)
        .set({
          code:
            input.code === undefined ? current.code : optionalText(input.code),
          name: nextName,
          status: input.status ?? current.status,
          description:
            input.description === undefined
              ? current.description
              : input.description.trim(),
          plannedStartAt: nextPlannedStartAt,
          plannedEndAt: nextPlannedEndAt,
          actualStartAt: nextActualStartAt,
          actualEndAt: nextActualEndAt,
          notes: input.notes === undefined ? current.notes : input.notes.trim(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(materialControlProjects.id, input.id))
        .returning();
      if (!updated) fail("NOT_FOUND", "Dự án không tồn tại.");
      if (sourcesProvided) {
        await tx
          .delete(materialControlProjectSources)
          .where(eq(materialControlProjectSources.projectId, input.id));
        const sources = inputSources(input.sources, input.sourceLinks);
        if (sources.length) {
          await tx
            .insert(materialControlProjectSources)
            .values(
              sources.map((source) => ({ ...source, projectId: input.id })),
            );
        }
      }
    });
    return getProject(input.id, database);
  } catch (error) {
    if (error instanceof MaterialControlServiceError) throw error;
    if (uniqueViolation(error)) {
      fail("CONFLICT", "Mã dự án hoặc liên kết nguồn đã tồn tại.");
    }
    throw error;
  }
}

export async function deleteProject(
  id: number,
  database: AppDb = db,
): Promise<{ id: number }> {
  return database.transaction(async (tx) => {
    const deleted = await tx
      .delete(materialControlProjects)
      .where(eq(materialControlProjects.id, id))
      .returning({ id: materialControlProjects.id });
    if (!deleted[0]) fail("NOT_FOUND", "Dự án không tồn tại.");
    return deleted[0];
  });
}

export async function addProjectSource(
  projectId: number,
  input: ProjectSourceInput,
  database: AppDb = db,
): Promise<ProjectSourceView> {
  const source = normalizeSource(input);
  try {
    return await database.transaction(async (tx) => {
      const [project] = await tx
        .select({ id: materialControlProjects.id })
        .from(materialControlProjects)
        .where(eq(materialControlProjects.id, projectId))
        .limit(1);
      if (!project) fail("NOT_FOUND", "Dự án không tồn tại.");
      const [row] = await tx
        .insert(materialControlProjectSources)
        .values({ ...source, projectId })
        .returning();
      if (!row) fail("BAD_REQUEST", "Không thêm được liên kết nguồn.");
      return sourceView(row);
    });
  } catch (error) {
    if (error instanceof MaterialControlServiceError) throw error;
    if (uniqueViolation(error)) fail("CONFLICT", "Liên kết nguồn đã tồn tại.");
    throw error;
  }
}

export async function removeProjectSource(
  projectId: number,
  sourceId: number,
  database: AppDb = db,
): Promise<{ id: number }> {
  return database.transaction(async (tx) => {
    const deleted = await tx
      .delete(materialControlProjectSources)
      .where(
        and(
          eq(materialControlProjectSources.id, sourceId),
          eq(materialControlProjectSources.projectId, projectId),
        ),
      )
      .returning({ id: materialControlProjectSources.id });
    if (!deleted[0]) fail("NOT_FOUND", "Liên kết nguồn không tồn tại.");
    return deleted[0];
  });
}

async function assertProjectAndParent(
  tx: Parameters<Parameters<AppDb["transaction"]>[0]>[0],
  locationId: number | null,
  projectId: number | null,
  parentId: number | null,
): Promise<void> {
  if (projectId !== null) {
    const [project] = await tx
      .select({ id: materialControlProjects.id })
      .from(materialControlProjects)
      .where(eq(materialControlProjects.id, projectId))
      .limit(1);
    if (!project) fail("NOT_FOUND", "Dự án không tồn tại.");
  }
  if (parentId === null) return;
  if (locationId !== null && parentId === locationId) {
    fail("BAD_REQUEST", "Địa điểm không thể là cha của chính nó.");
  }
  const [parent] = await tx
    .select()
    .from(materialControlLocations)
    .where(eq(materialControlLocations.id, parentId))
    .limit(1);
  if (!parent) fail("NOT_FOUND", "Địa điểm cha không tồn tại.");
  // A project-scoped location may sit below a shared/global location (for
  // example: shared warehouse -> project site -> zone). A shared location
  // must never sit below a project-scoped location because that would make
  // ownership ambiguous for stock queries.
  if (
    parent.projectId !== null &&
    (projectId === null || parent.projectId !== projectId)
  ) {
    fail("BAD_REQUEST", "Địa điểm cha phải thuộc cùng phạm vi dự án.");
  }
  const seen = new Set<number>();
  let cursor: number | null = parent.parentId;
  while (cursor !== null) {
    if (seen.has(cursor)) fail("BAD_REQUEST", "Cây địa điểm đang bị vòng lặp.");
    seen.add(cursor);
    if (locationId !== null && cursor === locationId) {
      fail("BAD_REQUEST", "Không thể đặt hậu duệ làm địa điểm cha.");
    }
    const [ancestor] = await tx
      .select({ parentId: materialControlLocations.parentId })
      .from(materialControlLocations)
      .where(eq(materialControlLocations.id, cursor))
      .limit(1);
    cursor = ancestor?.parentId ?? null;
  }
}

export async function createLocation(
  input: CreateLocationInput,
  database: AppDb = db,
): Promise<LocationView> {
  const projectId = input.projectId ?? null;
  const parentId = input.parentId ?? null;
  const code = stringValue(input.code, "Mã địa điểm");
  const name = stringValue(input.name, "Tên địa điểm");
  try {
    return await database.transaction(async (tx) => {
      await assertProjectAndParent(tx, null, projectId, parentId);
      const [row] = await tx
        .insert(materialControlLocations)
        .values({
          projectId,
          parentId,
          code,
          name,
          type: input.type,
          isVirtual: input.isVirtual ?? false,
          notes: input.notes?.trim() ?? "",
        })
        .returning();
      if (!row) fail("BAD_REQUEST", "Không tạo được địa điểm.");
      return locationView(row);
    });
  } catch (error) {
    if (error instanceof MaterialControlServiceError) throw error;
    if (uniqueViolation(error))
      fail("CONFLICT", "Mã địa điểm đã tồn tại trong phạm vi này.");
    throw error;
  }
}

export async function listLocations(
  input: { projectId?: number | null; parentId?: number | null } = {},
  database: AppDb = db,
): Promise<readonly LocationView[]> {
  const rows = await database
    .select()
    .from(materialControlLocations)
    .where(
      and(
        input.projectId === undefined
          ? undefined
          : input.projectId === null
            ? isNull(materialControlLocations.projectId)
            : eq(materialControlLocations.projectId, input.projectId),
        input.parentId === undefined
          ? undefined
          : input.parentId === null
            ? isNull(materialControlLocations.parentId)
            : eq(materialControlLocations.parentId, input.parentId),
      ),
    )
    .orderBy(
      asc(materialControlLocations.parentId),
      asc(materialControlLocations.name),
      asc(materialControlLocations.id),
    );
  return rows.map(locationView);
}

export async function updateLocation(
  input: UpdateLocationInput,
  database: AppDb = db,
): Promise<LocationView> {
  try {
    return await database.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(materialControlLocations)
        .where(eq(materialControlLocations.id, input.id))
        .limit(1);
      if (!current) fail("NOT_FOUND", "Địa điểm không tồn tại.");
      const projectId =
        input.projectId === undefined ? current.projectId : input.projectId;
      const parentId =
        input.parentId === undefined ? current.parentId : input.parentId;
      await assertProjectAndParent(tx, current.id, projectId, parentId);
      const [row] = await tx
        .update(materialControlLocations)
        .set({
          projectId,
          parentId,
          code:
            input.code === undefined
              ? current.code
              : stringValue(input.code, "Mã địa điểm"),
          name:
            input.name === undefined
              ? current.name
              : stringValue(input.name, "Tên địa điểm"),
          type: input.type ?? current.type,
          isVirtual: input.isVirtual ?? current.isVirtual,
          notes: input.notes === undefined ? current.notes : input.notes.trim(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(materialControlLocations.id, input.id))
        .returning();
      if (!row) fail("NOT_FOUND", "Địa điểm không tồn tại.");
      return locationView(row);
    });
  } catch (error) {
    if (error instanceof MaterialControlServiceError) throw error;
    if (uniqueViolation(error))
      fail("CONFLICT", "Mã địa điểm đã tồn tại trong phạm vi này.");
    throw error;
  }
}

async function assertPlanProject(
  tx: Parameters<Parameters<AppDb["transaction"]>[0]>[0],
  projectId: number,
): Promise<void> {
  const [project] = await tx
    .select({ id: materialControlProjects.id })
    .from(materialControlProjects)
    .where(eq(materialControlProjects.id, projectId))
    .limit(1);
  if (!project) fail("NOT_FOUND", "Dự án không tồn tại.");
}

function planView(
  row: PlanRow,
  metrics?: { count: number; total: number },
): PlanView {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    status: row.status,
    plannedStartAt: row.plannedStartAt,
    plannedEndAt: row.plannedEndAt,
    notes: row.notes,
    requirementCount: metrics?.count ?? 0,
    totalRequiredQuantity: metrics?.total ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function planViews(
  database: AppDb,
  rows: readonly PlanRow[],
): Promise<readonly PlanView[]> {
  if (rows.length === 0) return [];
  const requirements = await database
    .select({
      planId: materialControlRequirements.planId,
      quantity: materialControlRequirements.quantity,
    })
    .from(materialControlRequirements)
    .where(
      inArray(
        materialControlRequirements.planId,
        rows.map((row) => row.id),
      ),
    );
  const metrics = new Map<number, { count: number; total: number }>();
  for (const requirement of requirements) {
    const current = metrics.get(requirement.planId) ?? { count: 0, total: 0 };
    current.count += 1;
    current.total += Number(requirement.quantity);
    metrics.set(requirement.planId, current);
  }
  return rows.map((row) => planView(row, metrics.get(row.id)));
}

export async function createPlan(
  input: CreatePlanInput,
  database: AppDb = db,
): Promise<PlanView> {
  const name = stringValue(input.name, "Tên kế hoạch");
  const plannedStartAt = normalizeOptionalDate(
    input.plannedStartAt,
    "Ngày bắt đầu kế hoạch",
  );
  const plannedEndAt = normalizeOptionalDate(
    input.plannedEndAt,
    "Ngày kết thúc kế hoạch",
  );
  validateDateRange(plannedStartAt, plannedEndAt, "Khoảng thời gian kế hoạch");
  try {
    const row = await database.transaction(async (tx) => {
      await assertPlanProject(tx, input.projectId);
      const [created] = await tx
        .insert(materialControlPlans)
        .values({
          projectId: input.projectId,
          name,
          status: input.status ?? "draft",
          plannedStartAt,
          plannedEndAt,
          notes: input.notes?.trim() ?? "",
        })
        .returning();
      if (!created) fail("BAD_REQUEST", "Không tạo được kế hoạch.");
      return created;
    });
    return planView(row);
  } catch (error) {
    if (error instanceof MaterialControlServiceError) throw error;
    if (uniqueViolation(error))
      fail("CONFLICT", "Tên kế hoạch đã tồn tại trong dự án.");
    throw error;
  }
}

export async function getPlan(
  id: number,
  database: AppDb = db,
): Promise<PlanView> {
  const [row] = await database
    .select()
    .from(materialControlPlans)
    .where(eq(materialControlPlans.id, id))
    .limit(1);
  if (!row) fail("NOT_FOUND", "Kế hoạch không tồn tại.");
  const [view] = await planViews(database, [row]);
  return view ?? planView(row);
}

export async function listPlans(
  input: { projectId?: number; status?: MaterialControlPlanStatus } = {},
  database: AppDb = db,
): Promise<readonly PlanView[]> {
  const rows = await database
    .select()
    .from(materialControlPlans)
    .where(
      and(
        input.projectId === undefined
          ? undefined
          : eq(materialControlPlans.projectId, input.projectId),
        input.status === undefined
          ? undefined
          : eq(materialControlPlans.status, input.status),
      ),
    )
    .orderBy(
      desc(materialControlPlans.updatedAt),
      asc(materialControlPlans.id),
    );
  return planViews(database, rows);
}

export async function updatePlan(
  input: UpdatePlanInput,
  database: AppDb = db,
): Promise<PlanView> {
  const plannedStartAt =
    input.plannedStartAt === undefined
      ? undefined
      : normalizeOptionalDate(input.plannedStartAt, "Ngày bắt đầu kế hoạch");
  const plannedEndAt =
    input.plannedEndAt === undefined
      ? undefined
      : normalizeOptionalDate(input.plannedEndAt, "Ngày kết thúc kế hoạch");
  if (plannedStartAt !== undefined && plannedEndAt !== undefined) {
    validateDateRange(
      plannedStartAt,
      plannedEndAt,
      "Khoảng thời gian kế hoạch",
    );
  }
  try {
    await database.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(materialControlPlans)
        .where(eq(materialControlPlans.id, input.id))
        .limit(1);
      if (!current) fail("NOT_FOUND", "Kế hoạch không tồn tại.");
      const nextStart =
        plannedStartAt === undefined ? current.plannedStartAt : plannedStartAt;
      const nextEnd =
        plannedEndAt === undefined ? current.plannedEndAt : plannedEndAt;
      validateDateRange(nextStart, nextEnd, "Khoảng thời gian kế hoạch");
      await tx
        .update(materialControlPlans)
        .set({
          name:
            input.name === undefined
              ? current.name
              : stringValue(input.name, "Tên kế hoạch"),
          status: input.status ?? current.status,
          plannedStartAt: nextStart,
          plannedEndAt: nextEnd,
          notes: input.notes === undefined ? current.notes : input.notes.trim(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(materialControlPlans.id, input.id));
    });
    return getPlan(input.id, database);
  } catch (error) {
    if (error instanceof MaterialControlServiceError) throw error;
    if (uniqueViolation(error))
      fail("CONFLICT", "Tên kế hoạch đã tồn tại trong dự án.");
    throw error;
  }
}

export async function deletePlan(
  id: number,
  database: AppDb = db,
): Promise<{ id: number }> {
  return database.transaction(async (tx) => {
    const deleted = await tx
      .delete(materialControlPlans)
      .where(eq(materialControlPlans.id, id))
      .returning({ id: materialControlPlans.id });
    if (!deleted[0]) fail("NOT_FOUND", "Kế hoạch không tồn tại.");
    return deleted[0];
  });
}
