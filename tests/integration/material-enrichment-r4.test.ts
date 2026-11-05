import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  barrier,
  createDatabaseFixture,
} from "../fixtures/remediation/database";
import * as schema from "~/server/db/schema";

const context = vi.hoisted(() => ({
  database: undefined as ReturnType<typeof drizzle<typeof schema>> | undefined,
}));
vi.mock("~/server/db", () => ({
  db: new Proxy(
    {},
    {
      get(_target, key) {
        if (!context.database)
          throw new Error("R4 fixture database not initialized");
        const value: unknown = Reflect.get(context.database, key);
        return typeof value === "function"
          ? value.bind(context.database)
          : value;
      },
    },
  ),
}));
vi.mock("~/server/services/app-settings", async (original) => ({
  ...(await original<typeof import("~/server/services/app-settings")>()),
  resolveEnrichmentItemConcurrency: async () => 1,
  resolveEnrichmentMaxConcurrentJobs: async () => 1,
  resolveScrapeMaxConcurrentJobs: async () => 0,
  resolveImportMaxConcurrentJobs: async () => 0,
  resolveExcelResearchMaxConcurrentJobs: async () => 0,
  resolveScrapeJobTtlDays: async () => 7,
  resolveAiProvider: vi.fn(() => {
    throw new Error("Paid AI forbidden in R4 tests");
  }),
}));
vi.mock("~/server/services/material-web-search", () => ({
  searchWebForProduct: vi.fn(() => {
    throw new Error("External search forbidden in R4 tests");
  }),
}));
vi.mock("~/server/services/material-enrichment-extract", () => ({
  extractProductFromSources: vi.fn(() => {
    throw new Error("Paid AI forbidden in R4 tests");
  }),
}));
vi.mock("~/server/services/material-profile-scrape-jobs", () => ({
  advanceMaterialProfileScrapeJobs: async () => {},
}));
vi.mock("~/server/services/material-profile-material-batches", () => ({
  resumeMaterialProfileSaveBatches: async () => {},
}));

import {
  startMaterialEnrichmentJob,
  cancelMaterialEnrichmentJob,
} from "~/server/services/material-enrichment-jobs";
import { processEnrichmentJob } from "~/server/services/material-enrichment-runner";
import {
  runJobSchedulerTickForTests,
  stopJobSchedulerForTests,
} from "~/server/services/job-scheduler";

let fixture: Awaited<ReturnType<typeof createDatabaseFixture>>;
let database: ReturnType<typeof drizzle<typeof schema>>;
let materialIds: number[];
let jobIds: string[];
const filters = { categories: [], manufacturers: [], origins: [], units: [] };

beforeEach(async () => {
  fixture = await createDatabaseFixture();
  database = drizzle(fixture.first, { schema });
  context.database = database;
  materialIds = [];
  jobIds = [];
});
afterEach(async () => {
  stopJobSchedulerForTests();
  vi.restoreAllMocks();
  // Only this test's seeded materials/jobs and trigger objects are removed.
  for (const id of jobIds)
    await database
      .delete(schema.materialEnrichmentJobs)
      .where(eq(schema.materialEnrichmentJobs.id, id));
  for (const id of materialIds) {
    // Include a parent left behind if a regression makes enqueue throw after insert.
    await fixture.first`delete from material_enrichment_jobs where material_ids @> ${JSON.stringify([id])}::text::jsonb`;
    await database.delete(schema.materials).where(eq(schema.materials.id, id));
  }
  await fixture.cleanup();
});
async function material(deleted = false) {
  const [row] = await database
    .insert(schema.materials)
    .values({
      name: `R4 ${randomUUID()}`,
      unit: "m",
      category: "Đủ thông tin",
      deletedAt: deleted ? new Date().toISOString() : null,
    })
    .returning();
  if (!row) throw new Error("Seed failed");
  materialIds.push(row.id);
  return row;
}
async function enqueue(ids: number[]) {
  const job = await startMaterialEnrichmentJob({
    materialIds: ids,
    filterOptions: filters,
    options: { skipWellFilled: true, fields: ["category"] },
  });
  jobIds.push(job.id);
  return job;
}
async function jobRow(id: string) {
  const [job] = await database
    .select()
    .from(schema.materialEnrichmentJobs)
    .where(eq(schema.materialEnrichmentJobs.id, id));
  if (!job) throw new Error("Missing test job");
  return job;
}

// Terminal NOTIFY is a commit barrier: no sleeps or status polling.
async function runScheduled(id: string) {
  const channel = `r4_${randomUUID().replaceAll("-", "")}`;
  let complete!: () => void;
  const completed = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const listener = await fixture.second.listen(channel, () => complete());
  const fn = `${fixture.schema}.notify_terminal`;
  const trigger = `r4_${fixture.schema}`;
  await fixture.first
    .unsafe(`create function ${fn}() returns trigger language plpgsql as $$ begin
    if new.id = '${id}'::uuid and new.status in ('completed', 'failed', 'cancelled') then perform pg_notify('${channel}', new.status::text); end if;
    return new; end $$`);
  await fixture.first.unsafe(
    `create trigger ${trigger} after update on material_enrichment_jobs for each row execute function ${fn}()`,
  );
  try {
    await runJobSchedulerTickForTests();
    await completed;
    return await jobRow(id);
  } finally {
    await fixture.first.unsafe(
      `drop trigger ${trigger} on material_enrichment_jobs`,
    );
    await listener.unlisten();
  }
}

test("enqueue derives parent snapshot and children from the same active selection", async () => {
  const active = await material();
  const deleted = await material(true);
  const job = await enqueue([active.id, active.id, deleted.id, 2147483647]);
  expect(job).toMatchObject({
    status: "queued",
    materialIds: [active.id],
    total: 1,
  });
  const items = await database
    .select()
    .from(schema.materialEnrichmentItems)
    .where(eq(schema.materialEnrichmentItems.jobId, job.id));
  expect(items.map((item) => item.materialId)).toEqual(job.materialIds);
  await expect(enqueue([deleted.id, 2147483647])).rejects.toThrow(
    "Không tìm thấy",
  );
});

test("a database child-insertion failure rolls back the parent and every child", async () => {
  const first = await material();
  const second = await material();
  const constraint = `r4_${fixture.schema}`;
  await fixture.first.unsafe(
    `alter table material_enrichment_items add constraint ${constraint} check (material_id <> ${second.id}) not valid`,
  );
  try {
    await expect(enqueue([first.id, second.id])).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: constraint },
    });
    const rows =
      await fixture.second`select id from material_enrichment_jobs where material_ids @> ${JSON.stringify([first.id])}::text::jsonb`;
    expect(rows).toHaveLength(0);
    expect(
      await fixture.second`select id from material_enrichment_items where material_id in (${first.id}, ${second.id})`,
    ).toHaveLength(0);
  } finally {
    await fixture.first.unsafe(
      `alter table material_enrichment_items drop constraint ${constraint}`,
    );
  }
});

test("a scheduler connection cannot claim an enqueue until commit; the response also waits", async () => {
  const row = await material();
  const meet = barrier(2);
  let release!: () => void;
  const commitGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const realTransaction = database.transaction.bind(database);
  vi.spyOn(database, "transaction").mockImplementation((callback) =>
    realTransaction(async (tx) => {
      const result = await callback(tx);
      await meet();
      await commitGate;
      return result;
    }),
  );
  let returned = false;
  const pending = enqueue([row.id]).then((job) => {
    returned = true;
    return job;
  });
  try {
    await meet();
    // Same row lock / SKIP LOCKED protocol used by claimNextEnrichmentJob.
    const claimed = await fixture.second.begin(
      async (tx) => tx`
      select id from material_enrichment_jobs where status = 'queued'
      and material_ids @> ${JSON.stringify([row.id])}::text::jsonb
      for update skip locked
    `,
    );
    expect(claimed).toHaveLength(0);
    expect(returned).toBe(false);
    expect(
      await fixture.second`select id from material_enrichment_items where material_id = ${row.id}`,
    ).toHaveLength(0);
  } finally {
    release();
    await pending;
  }
  const job = await pending;
  expect(returned).toBe(true);
  expect(
    await fixture.second`select id from material_enrichment_jobs where id = ${job.id} and status = 'queued' for update skip locked`,
  ).toHaveLength(1);
  expect(
    await fixture.second`select id from material_enrichment_items where job_id = ${job.id}`,
  ).toHaveLength(job.total);
});

test.each([
  "no children",
  "wrong material",
  "duplicate children",
  "bad total",
  "unknown status",
])("legacy %s fails visibly without executing enrichment", async (kind) => {
  const first = await material();
  const second = await material();
  const job = await enqueue([first.id]);
  if (kind === "no children")
    await database
      .delete(schema.materialEnrichmentItems)
      .where(eq(schema.materialEnrichmentItems.jobId, job.id));
  if (kind === "wrong material")
    await database
      .update(schema.materialEnrichmentItems)
      .set({ materialId: second.id })
      .where(eq(schema.materialEnrichmentItems.jobId, job.id));
  if (kind === "duplicate children")
    await database
      .insert(schema.materialEnrichmentItems)
      .values({ jobId: job.id, materialId: first.id });
  if (kind === "bad total")
    await database
      .update(schema.materialEnrichmentJobs)
      .set({ total: 2 })
      .where(eq(schema.materialEnrichmentJobs.id, job.id));
  if (kind === "unknown status")
    await database
      .update(schema.materialEnrichmentItems)
      .set({ status: "mystery" })
      .where(eq(schema.materialEnrichmentItems.jobId, job.id));
  const result = await runScheduled(job.id);
  expect(result.status).toBe("failed");
  expect(result.error).toContain("tạo job mới");
  expect(result.finishedAt).not.toBeNull();
  const { resolveAiProvider } = await import("~/server/services/app-settings");
  expect(resolveAiProvider).not.toHaveBeenCalled();
});

test("normal skipped work completes and terminal failed/rejected outcomes stay visible", async () => {
  const rows = await Promise.all(Array.from({ length: 7 }, () => material()));
  const job = await enqueue(rows.map((row) => row.id));
  const statuses = [
    "auto",
    "review",
    "committed",
    "rejected",
    "failed",
    "skipped",
  ];
  for (const [index, status] of statuses.entries()) {
    await database
      .update(schema.materialEnrichmentItems)
      .set({ status, resultJson: { catalogPdfUrls: [] } })
      .where(
        eq(schema.materialEnrichmentItems.materialId, rows[index]?.id ?? -1),
      );
  }
  const result = await runScheduled(job.id);
  expect(result).toMatchObject({
    status: "completed",
    processed: 7,
    matched: 2,
    needsReview: 1,
    failed: 1,
  });
  const items = await database
    .select()
    .from(schema.materialEnrichmentItems)
    .where(eq(schema.materialEnrichmentItems.jobId, job.id));
  expect(items.map((item) => item.status)).toContain("failed");
  expect(items.filter((item) => item.status === "skipped")).toHaveLength(2);
});

test("cancelled jobs retain cancellation and pending work without AI calls", async () => {
  const row = await material();
  const job = await enqueue([row.id]);
  await cancelMaterialEnrichmentJob(job.id);
  await expect(processEnrichmentJob(job.id)).rejects.toThrow(
    "không còn hoạt động",
  );
  expect((await jobRow(job.id)).status).toBe("cancelled");
  const [item] = await database
    .select()
    .from(schema.materialEnrichmentItems)
    .where(eq(schema.materialEnrichmentItems.jobId, job.id));
  expect(item?.status).toBe("pending");
});

test("persisted unfinished work appearing during execution cannot complete", async () => {
  const row = await material();
  const job = await enqueue([row.id]);
  const fn = `${fixture.schema}.leave_pending`;
  const trigger = `r4_${fixture.schema}`;
  await fixture.first
    .unsafe(`create function ${fn}() returns trigger language plpgsql as $$ begin
    if new.material_id = ${row.id} and new.status = 'skipped' then new.status := 'pending'; end if;
    return new; end $$`);
  await fixture.first.unsafe(
    `create trigger ${trigger} before update on material_enrichment_items for each row execute function ${fn}()`,
  );
  try {
    const result = await runScheduled(job.id);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("chưa kết thúc");
    expect(result.processed).toBe(0);
  } finally {
    await fixture.first.unsafe(
      `drop trigger ${trigger} on material_enrichment_items`,
    );
  }
});

test("cancellation during item completion cannot turn into job success", async () => {
  const row = await material();
  const job = await enqueue([row.id]);
  const fn = `${fixture.schema}.cancel_on_item`;
  const trigger = `r4_${fixture.schema}`;
  await fixture.first
    .unsafe(`create function ${fn}() returns trigger language plpgsql as $$ begin
    if new.material_id = ${row.id} and new.status = 'skipped' then
      update material_enrichment_jobs set status = 'cancelled' where id = new.job_id;
    end if;
    return new; end $$`);
  await fixture.first.unsafe(
    `create trigger ${trigger} after update on material_enrichment_items for each row execute function ${fn}()`,
  );
  try {
    await expect(processEnrichmentJob(job.id)).rejects.toThrow(
      "không còn hoạt động",
    );
    expect((await jobRow(job.id)).status).toBe("cancelled");
  } finally {
    await fixture.first.unsafe(
      `drop trigger ${trigger} on material_enrichment_items`,
    );
  }
});
