import { randomUUID } from "node:crypto";

import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import * as schema from "~/server/db/schema";
import { resetStaleExcelResearchRows } from "~/server/services/excel-research/process-batch";
import { createDatabaseFixture } from "../fixtures/remediation/database";

const context = vi.hoisted(() => ({
  database: undefined as ReturnType<typeof drizzle<typeof schema>> | undefined,
}));
vi.mock("~/server/db", () => ({
  db: new Proxy(
    {},
    {
      get(_target, key) {
        if (!context.database) throw new Error("R6 database is not ready");
        const value: unknown = Reflect.get(context.database, key);
        return typeof value === "function"
          ? value.bind(context.database)
          : value;
      },
    },
  ),
}));

let fixture: Awaited<ReturnType<typeof createDatabaseFixture>>;
let database: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(async () => {
  fixture = await createDatabaseFixture();
  for (const table of ["excel_research_jobs", "excel_research_job_rows"]) {
    await fixture.first`create table ${fixture.first(`${fixture.schema}.${table}`)}
      (like ${fixture.first(`public.${table}`)} including all)`;
  }
  await fixture.first`set search_path to ${fixture.first(fixture.schema)}, public`;
  database = drizzle(fixture.first, { schema });
  context.database = database;
});

afterEach(async () => {
  context.database = undefined;
  await fixture?.cleanup();
});

async function createRows() {
  const jobId = randomUUID();
  await database.insert(schema.excelResearchJobs).values({
    id: jobId,
    name: "R6 orphan recovery",
    status: "running",
    sourceFileName: "r6.xlsx",
    sheetName: "Sheet1",
    headerRowIndex: 1,
  });
  const [fresh, missing, old] = await database
    .insert(schema.excelResearchJobRows)
    .values([
      { jobId, rowNumber: 1, productName: "fresh", status: "processing" },
      { jobId, rowNumber: 2, productName: "missing", status: "processing" },
      { jobId, rowNumber: 3, productName: "old", status: "processing" },
    ])
    .returning();
  await database
    .update(schema.excelResearchJobRows)
    .set({
      processingStartedAt: new Date(Date.now() - 11 * 60_000).toISOString(),
    })
    .where(eq(schema.excelResearchJobRows.id, old!.id));
  await database
    .update(schema.excelResearchJobRows)
    .set({ processingStartedAt: new Date().toISOString() })
    .where(eq(schema.excelResearchJobRows.id, fresh!.id));
  return { jobId, fresh: fresh!.id, missing: missing!.id, old: old!.id };
}

test("startup recovers fresh and missing timestamps while maintenance keeps the age guard", async () => {
  const ids = await createRows();

  await resetStaleExcelResearchRows({ startup: true });
  expect(
    await database
      .select({ status: schema.excelResearchJobRows.status })
      .from(schema.excelResearchJobRows)
      .where(eq(schema.excelResearchJobRows.jobId, ids.jobId)),
  ).toEqual([
    { status: "pending" },
    { status: "pending" },
    { status: "pending" },
  ]);

  await database
    .update(schema.excelResearchJobRows)
    .set({
      status: "processing",
      processingStartedAt: new Date().toISOString(),
    })
    .where(eq(schema.excelResearchJobRows.id, ids.fresh));
  await database
    .update(schema.excelResearchJobRows)
    .set({ status: "processing", processingStartedAt: null })
    .where(eq(schema.excelResearchJobRows.id, ids.missing));
  await database
    .update(schema.excelResearchJobRows)
    .set({
      status: "processing",
      processingStartedAt: new Date(Date.now() - 11 * 60_000).toISOString(),
    })
    .where(eq(schema.excelResearchJobRows.id, ids.old));

  await resetStaleExcelResearchRows();
  expect(
    await database
      .select({
        id: schema.excelResearchJobRows.id,
        status: schema.excelResearchJobRows.status,
      })
      .from(schema.excelResearchJobRows)
      .where(eq(schema.excelResearchJobRows.jobId, ids.jobId))
      .orderBy(asc(schema.excelResearchJobRows.rowNumber)),
  ).toEqual([
    { id: ids.fresh, status: "processing" },
    { id: ids.missing, status: "processing" },
    { id: ids.old, status: "pending" },
  ]);
});
