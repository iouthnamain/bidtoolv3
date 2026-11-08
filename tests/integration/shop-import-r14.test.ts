import { randomUUID } from "node:crypto";

import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import * as schema from "~/server/db/schema";
import type { ShopImportJobProgress } from "~/server/services/shop-import-jobs";
import type { ScrapedShopProduct } from "~/server/services/shop-material-scraper";
import {
  barrier,
  createDatabaseFixture,
} from "../fixtures/remediation/database";

const context = vi.hoisted(() => ({
  database: undefined as ReturnType<typeof drizzle<typeof schema>> | undefined,
}));
vi.mock("~/server/db", () => ({
  db: new Proxy(
    {},
    {
      get(_target, key) {
        if (!context.database) throw new Error("R14 database is not ready");
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
  resolveScrapeJobTtlDays: async () => 7,
  resolveAiProvider: () => {
    throw new Error("Paid AI forbidden in R14 tests");
  },
}));

import { cancelShopImportJob } from "~/server/services/shop-import-jobs";
import {
  recoverInterruptedImportJobsForTests,
  runShopImportJobForTests,
  stopJobSchedulerForTests,
} from "~/server/services/job-scheduler";
import { importScrapedProducts } from "~/server/services/shop-product-importer";

type Database = ReturnType<typeof drizzle<typeof schema>>;
let fixture: Awaited<ReturnType<typeof createDatabaseFixture>>;
let database: Database;
let second: Database;

beforeEach(async () => {
  fixture = await createDatabaseFixture();
  // Exercise migrated table definitions and indexes in an owned schema. Trigger
  // faults and cleanup cannot affect another integration file's rows.
  for (const table of [
    "shop_scrape_jobs",
    "shop_import_jobs",
    "materials",
    "shop_import_items",
    "material_catalog_documents",
    "material_catalog_document_links",
  ]) {
    await fixture.first`create table ${fixture.first(`${fixture.schema}.${table}`)}
      (like ${fixture.first(`public.${table}`)} including all)`;
  }
  await fixture.first`set search_path to ${fixture.first(fixture.schema)}, public`;
  await fixture.second`set search_path to ${fixture.second(fixture.schema)}, public`;
  database = drizzle(fixture.first, { schema });
  second = drizzle(fixture.second, { schema });
  context.database = database;
});

afterEach(async () => {
  stopJobSchedulerForTests();
  vi.restoreAllMocks();
  context.database = undefined;
  await fixture?.cleanup();
});

function product(label: string): ScrapedShopProduct {
  const token = `${label}-${randomUUID()}`;
  return {
    name: token,
    unit: "cái",
    category: "R14",
    specText: "fixture",
    manufacturer: "R14",
    originCountry: "Việt Nam",
    price: 1000,
    priceText: "1.000 đ",
    currency: "VND",
    sourceUrl: `https://example.com/r14/${token}`,
    imageUrl: null,
    sku: token,
    model: null,
    availability: null,
    shopCategory: null,
    catalogPdfUrls: [`https://example.com/r14/${token}.pdf`],
  };
}

async function createJob(products: ScrapedShopProduct[]) {
  const scrapeJobId = randomUUID();
  const importJobId = randomUUID();
  await database.insert(schema.shopScrapeJobs).values({
    id: scrapeJobId,
    url: `https://example.com/${scrapeJobId}`,
    normalizedUrl: `https://example.com/${scrapeJobId}`,
    status: "completed",
    products,
  });
  await database.insert(schema.shopImportJobs).values({
    id: importJobId,
    scrapeJobId,
    status: "running",
    total: products.length,
  });
  return importJobId;
}

async function jobRow(id: string) {
  const [job] = await database
    .select()
    .from(schema.shopImportJobs)
    .where(eq(schema.shopImportJobs.id, id));
  if (!job) throw new Error("R14 job missing");
  return job;
}

async function ledger(id: string) {
  return database
    .select()
    .from(schema.shopImportItems)
    .where(eq(schema.shopImportItems.importJobId, id))
    .orderBy(asc(schema.shopImportItems.id));
}

function run(
  id: string,
  products: ScrapedShopProduct[],
  db = database,
  extra: Partial<Parameters<typeof importScrapedProducts>[2]> = {},
) {
  return importScrapedProducts(db, products, {
    importJobId: id,
    mode: "create_all",
    ...extra,
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function restartTwice(
  id: string,
  products: ScrapedShopProduct[],
  status: "created" | "updated" | "skipped" = "created",
) {
  for (let restart = 0; restart < 2; restart += 1) {
    await database
      .update(schema.shopImportJobs)
      .set({ status: "running" })
      .where(eq(schema.shopImportJobs.id, id));
    await recoverInterruptedImportJobsForTests(new Date().toISOString());
    expect((await jobRow(id)).status).toBe("queued");
    await database
      .update(schema.shopImportJobs)
      .set({ status: "running" })
      .where(eq(schema.shopImportJobs.id, id));
    await runShopImportJobForTests(await jobRow(id));
    expect(await jobRow(id)).toMatchObject({
      status: "completed",
      processed: products.length,
      total: products.length,
      created: status === "created" ? products.length : 0,
      updated: status === "updated" ? products.length : 0,
      skipped: status === "skipped" ? products.length : 0,
      failed: 0,
    });
    expect(await database.select().from(schema.materials)).toHaveLength(
      status === "skipped" ? 0 : products.length,
    );
    expect(await ledger(id)).toHaveLength(products.length);
  }
}

async function installFault(
  stage: "material" | "document-link",
  sourceUrl: string,
) {
  const connection = fixture.first;
  const sequence = `${fixture.schema}.fault_hits`;
  await connection`create sequence ${connection(sequence)}`;
  await connection.unsafe(`create function "${fixture.schema}".fail_import() returns trigger
    language plpgsql as $$ begin
      if (TG_TABLE_NAME = 'materials' and NEW.source_url = TG_ARGV[0]) then
        perform nextval(TG_ARGV[1]::regclass);
        raise exception 'R14 material fault';
      end if;
      return NEW;
    end $$`);
  if (stage === "document-link") {
    await connection.unsafe(`create or replace function "${fixture.schema}".fail_import() returns trigger
      language plpgsql as $$ begin
        if exists (select 1 from materials where id = NEW.material_id and source_url = TG_ARGV[0]) then
          perform nextval(TG_ARGV[1]::regclass);
          raise exception 'R14 document link fault';
        end if;
        return NEW;
      end $$`);
  }
  const table =
    stage === "material" ? "materials" : "material_catalog_document_links";
  // CREATE TRIGGER arguments are SQL literals rather than bind parameters.
  const sourceLiteral = sourceUrl.replaceAll("'", "''");
  await connection.unsafe(`create trigger r14_fault before insert on "${fixture.schema}"."${table}"
    for each row execute function "${fixture.schema}".fail_import('${sourceLiteral}', '${sequence}')`);
  return async () => {
    const [hit] =
      await connection`select is_called from ${connection(sequence)}`;
    expect(hit?.is_called).toBe(true);
    await connection`drop trigger r14_fault on ${connection(table)}`;
  };
}

test.each(["material", "document-link"] as const)(
  "rolls back the material and related writes at the %s fault, then restarts twice",
  async (stage) => {
    const products = [product(stage)];
    const id = await createJob(products);
    const clearFault = await installFault(stage, products[0]!.sourceUrl);
    expect(await run(id, products)).toMatchObject({ created: 0, failed: 1 });
    expect(await database.select().from(schema.materials)).toHaveLength(0);
    expect(
      await database.select().from(schema.materialCatalogDocuments),
    ).toHaveLength(0);
    expect(
      await database.select().from(schema.materialCatalogDocumentLinks),
    ).toHaveLength(0);
    expect(await ledger(id)).toMatchObject([
      { status: "failed", materialId: null },
    ]);
    await clearFault();
    await restartTwice(id, products);
    expect(
      await database.select().from(schema.materialCatalogDocuments),
    ).toHaveLength(1);
    expect(
      await database.select().from(schema.materialCatalogDocumentLinks),
    ).toHaveLength(1);
  },
);

test("recovers a material/ledger commit lost before the first progress flush", async () => {
  const products = [product("commit-before-flush"), product("pending")];
  const id = await createJob(products);
  await expect(
    run(id, products, database, {
      onProgress(progress) {
        if (progress.created === 1)
          throw new Error("R14 crash before progress flush");
      },
    }),
  ).rejects.toThrow("R14 crash before progress flush");
  expect(await jobRow(id)).toMatchObject({ processed: 0, created: 0 });
  expect(await ledger(id)).toContainEqual(
    expect.objectContaining({ status: "created" }),
  );
  expect(await database.select().from(schema.materials)).toHaveLength(1);
  await restartTwice(id, products);
});

test.each(["created", "updated", "skipped"] as const)(
  "a late concurrent failure cannot downgrade a committed %s outcome",
  async (status) => {
    const source = product(`late-${status}`);
    if (status === "skipped") source.name = "";
    if (status === "updated") {
      await database.insert(schema.materials).values({
        name: source.name,
        unit: "cái",
        sourceUrl: source.sourceUrl,
      });
    }
    const products = [source];
    const id = await createJob(products);
    const rolledBack = deferred();
    const releaseFailure = deferred();
    const transaction = database.transaction.bind(database);
    const fault = new Error("R14 delayed failure after rollback");
    vi.spyOn(database, "transaction").mockImplementationOnce(
      async (callback, config) => {
        try {
          await transaction(async (tx) => {
            await callback(tx);
            throw fault;
          }, config);
        } catch (error) {
          rolledBack.resolve();
          await releaseFailure.promise;
          throw error;
        }
        throw new Error("R14 expected transaction rollback");
      },
    );
    const extra = {
      mode:
        status === "updated"
          ? ("match_existing" as const)
          : ("create_all" as const),
    };
    const progress: ShopImportJobProgress[] = [];
    const late = run(id, products, database, {
      ...extra,
      onProgress: (value) => progress.push(value),
    });
    await rolledBack.promise;
    try {
      expect(await run(id, products, second, extra)).toMatchObject({
        [status]: 1,
        failed: 0,
      });
    } finally {
      releaseFailure.resolve();
    }
    expect(await late).toMatchObject({ [status]: 1, failed: 0 });
    expect(progress.at(-1)).toMatchObject({
      [status]: 1,
      failed: 0,
      processed: 1,
    });
    expect(await ledger(id)).toMatchObject([{ status }]);
    await restartTwice(id, products, status);
    const rows = await database.select().from(schema.materials);
    expect(rows).toHaveLength(status === "skipped" ? 0 : 1);
    if (status === "updated") expect(rows[0]?.revision).toBe(1);
  },
);

test("preserves success when COMMIT succeeds but its caller observes a connection error", async () => {
  const products = [product("ambiguous-commit")];
  const id = await createJob(products);
  const transaction = database.transaction.bind(database);
  vi.spyOn(database, "transaction").mockImplementationOnce(
    async (callback, config) => {
      await transaction(callback, config);
      throw new Error("R14 connection lost after COMMIT");
    },
  );
  expect(await run(id, products)).toMatchObject({ created: 1, failed: 0 });
  expect(await ledger(id)).toMatchObject([{ status: "created" }]);
  await restartTwice(id, products);
});

test("two independent concurrent retries create one material for the job", async () => {
  const products = [product("concurrent")];
  const id = await createJob(products);
  const [{ pid: firstPid } = {}] =
    await fixture.first`select pg_backend_pid() as pid`;
  const [{ pid: secondPid } = {}] =
    await fixture.second`select pg_backend_pid() as pid`;
  expect(firstPid).not.toBe(secondPid);
  const meet = barrier(2);
  for (const connection of [database, second]) {
    const transaction = connection.transaction.bind(connection);
    vi.spyOn(connection, "transaction").mockImplementationOnce(
      async (callback, config) => {
        await meet();
        return transaction(callback, config);
      },
    );
  }
  const results = await Promise.all([
    run(id, products),
    run(id, products, second),
  ]);
  expect(results).toMatchObject([
    { created: 1, failed: 0 },
    { created: 1, failed: 0 },
  ]);
  expect(await database.select().from(schema.materials)).toHaveLength(1);
  expect(await ledger(id)).toMatchObject([{ status: "created" }]);
});

test("concurrent import jobs reread one winning catalog document", async () => {
  const firstProduct = product("catalog-race-first");
  const secondProduct = product("catalog-race-second");
  const sharedPdf = "https://example.com/r14/shared-catalog.pdf";
  firstProduct.catalogPdfUrls = [sharedPdf];
  secondProduct.catalogPdfUrls = [sharedPdf];
  const firstJob = await createJob([firstProduct]);
  const secondJob = await createJob([secondProduct]);
  const meet = barrier(2);
  for (const connection of [database, second]) {
    const transaction = connection.transaction.bind(connection);
    vi.spyOn(connection, "transaction").mockImplementationOnce(
      async (callback, config) => {
        await meet();
        return transaction(callback, config);
      },
    );
  }

  const results = await Promise.all([
    run(firstJob, [firstProduct]),
    run(secondJob, [secondProduct], second),
  ]);
  expect(results).toMatchObject([
    { created: 1, failed: 0 },
    { created: 1, failed: 0 },
  ]);
  expect(await database.select().from(schema.materials)).toHaveLength(2);
  expect(
    await database.select().from(schema.materialCatalogDocuments),
  ).toMatchObject([{ sourceUrl: sharedPdf }]);
  expect(
    await database.select().from(schema.materialCatalogDocumentLinks),
  ).toHaveLength(2);
  expect(await ledger(firstJob)).toMatchObject([{ status: "created" }]);
  expect(await ledger(secondJob)).toMatchObject([{ status: "created" }]);
});

test("progress uses bounded ledger snapshots as the product count grows", async () => {
  const products = Array.from({ length: 12 }, (_, index) =>
    product(`bounded-progress-${index}`),
  );
  const id = await createJob(products);
  const snapshots: string[] = [];
  const observed = drizzle(fixture.first, {
    schema,
    logger: {
      logQuery(query) {
        if (
          query.startsWith("select ") &&
          query.includes('from "shop_import_items"') &&
          !query.includes('"product_key" =')
        ) {
          snapshots.push(query);
        }
      },
    },
  });
  const counts: number[] = [];
  expect(
    await run(id, [...products, products[0]!], observed, {
      onProgress(progress) {
        counts.push(progress.created);
        expect(progress).toMatchObject({
          processed: progress.created,
          total: products.length,
          failed: 0,
        });
        expect(progress.items).toHaveLength(progress.created);
      },
    }),
  ).toMatchObject({ created: products.length, failed: 0 });
  expect(counts[0]).toBe(0);
  expect(counts.at(-1)).toBe(products.length);
  expect(new Set(counts).size).toBe(products.length + 1);
  // Initial and final snapshots; product transactions read only their own row.
  expect(snapshots).toHaveLength(2);
  expect(await ledger(id)).toHaveLength(products.length);
  expect(await database.select().from(schema.materials)).toHaveLength(
    products.length,
  );
});

test("resume starts from all durable counts and cancellation preserves them", async () => {
  const products = [
    product("resumed-commit"),
    product("cancel-during-documents"),
    product("already-committed"),
    product("pending-last"),
  ];
  const id = await createJob(products);
  await run(id, [products[2]!]);
  await recoverInterruptedImportJobsForTests(new Date().toISOString());
  expect(await jobRow(id)).toMatchObject({
    status: "queued",
    created: 1,
    processed: 1,
  });
  const abort = new AbortController();
  let relatedWrites = 0;
  const resumed = drizzle(fixture.second, {
    schema,
    logger: {
      logQuery(query) {
        if (query.startsWith('insert into "material_catalog_document_links"')) {
          relatedWrites += 1;
          // Let one resumed product commit, then abort during the next one's
          // real document writes. Its whole product transaction must roll back.
          if (relatedWrites === 2) abort.abort();
        }
      },
    },
  });
  await database
    .update(schema.shopImportJobs)
    .set({ status: "running" })
    .where(eq(schema.shopImportJobs.id, id));
  const progress: ShopImportJobProgress[] = [];
  await expect(
    run(id, products, resumed, {
      signal: abort.signal,
      onProgress(value) {
        progress.push(value);
      },
    }),
  ).rejects.toThrow("Đã hủy job nhập catalog.");
  expect(progress[0]).toMatchObject({
    created: 1,
    failed: 0,
    processed: 1,
    total: products.length,
  });
  expect(progress.at(-1)).toMatchObject({
    created: 2,
    processed: 2,
    failed: 0,
  });
  expect(relatedWrites).toBe(2);
  const staleRunning = await jobRow(id);
  await cancelShopImportJob(id);
  await runShopImportJobForTests(staleRunning);
  await recoverInterruptedImportJobsForTests(new Date().toISOString());
  expect(await jobRow(id)).toMatchObject({
    status: "cancelled",
    created: 2,
    processed: 2,
    total: products.length,
    items: expect.arrayContaining([
      expect.objectContaining({
        sourceUrl: products[2]!.sourceUrl,
        materialId: expect.any(Number),
        action: "created",
      }),
    ]),
  });
  expect(await database.select().from(schema.materials)).toHaveLength(2);
  expect(
    await database.select().from(schema.materialCatalogDocuments),
  ).toHaveLength(2);
  expect(
    await database.select().from(schema.materialCatalogDocumentLinks),
  ).toHaveLength(2);
  expect(await ledger(id)).toMatchObject([
    { status: "created" },
    { status: "created" },
    { status: "processing" },
    { status: "processing" },
  ]);
});

test("separate intentional jobs can each create the same product", async () => {
  const products = [product("intentional")];
  for (let index = 0; index < 2; index += 1) {
    const id = await createJob(products);
    expect(await run(id, products)).toMatchObject({ created: 1, failed: 0 });
  }
  expect(await database.select().from(schema.materials)).toHaveLength(2);
});

test("legacy interrupted jobs fail visibly twice and keep their partial evidence", async () => {
  const id = await createJob([product("legacy")]);
  const item = {
    name: "previous",
    sourceUrl: "https://example.com/old",
    action: "created",
  };
  await database
    .update(schema.shopImportJobs)
    .set({ created: 1, processed: 1, items: [item] })
    .where(eq(schema.shopImportJobs.id, id));
  for (let restart = 0; restart < 2; restart += 1) {
    await recoverInterruptedImportJobsForTests(new Date().toISOString());
    expect(await jobRow(id)).toMatchObject({
      status: "failed",
      created: 1,
      processed: 1,
      items: [item],
      error: expect.stringContaining("không tự động chạy lại"),
    });
  }
  expect(await database.select().from(schema.materials)).toHaveLength(0);
});
