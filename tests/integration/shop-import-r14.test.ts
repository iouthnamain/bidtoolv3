import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, inArray } from "drizzle-orm";
import { afterEach, expect, test } from "vitest";

import * as schema from "~/server/db/schema";
import type { ScrapedShopProduct } from "~/server/services/shop-material-scraper";
import { importScrapedProducts } from "~/server/services/shop-product-importer";
import { recoverInterruptedImportJobsForTests } from "~/server/services/job-scheduler";
import { createDatabaseFixture } from "../fixtures/remediation/database";

let fixture: Awaited<ReturnType<typeof createDatabaseFixture>> | undefined;
let importJobIds: string[] = [];
let scrapeJobIds: string[] = [];
let materialIds: number[] = [];
const catalogUrl = `https://example.com/r14-${randomUUID()}.pdf`;

function product(name: string): ScrapedShopProduct {
  return {
    name,
    unit: "cái",
    category: "R14",
    specText: "fixture",
    manufacturer: "R14",
    originCountry: "Việt Nam",
    price: 1000,
    priceText: "1.000 đ",
    currency: "VND",
    sourceUrl: `https://example.com/r14/${encodeURIComponent(name)}`,
    imageUrl: null,
    sku: name,
    model: null,
    availability: null,
    shopCategory: null,
    catalogPdfUrls: [catalogUrl],
  };
}

async function createJob() {
  if (!fixture) throw new Error("R14 fixture is not ready.");
  const database = drizzle(fixture.first, { schema });
  const scrapeJobId = randomUUID();
  const importJobId = randomUUID();
  await database.insert(schema.shopScrapeJobs).values({
    id: scrapeJobId,
    url: `https://example.com/r14/${scrapeJobId}`,
    normalizedUrl: `https://example.com/r14/${scrapeJobId}`,
    status: "completed",
  });
  await database.insert(schema.shopImportJobs).values({
    id: importJobId,
    scrapeJobId,
    status: "running",
  });
  scrapeJobIds.push(scrapeJobId);
  importJobIds.push(importJobId);
  return { database, importJobId };
}

afterEach(async () => {
  if (!fixture) return;
  const database = drizzle(fixture.first, { schema });
  if (materialIds.length > 0) {
    await database
      .delete(schema.materials)
      .where(inArray(schema.materials.id, materialIds));
  }
  if (importJobIds.length > 0) {
    await database
      .delete(schema.shopImportJobs)
      .where(inArray(schema.shopImportJobs.id, importJobIds));
  }
  if (scrapeJobIds.length > 0) {
    await database
      .delete(schema.shopScrapeJobs)
      .where(inArray(schema.shopScrapeJobs.id, scrapeJobIds));
  }
  await database
    .delete(schema.materialCatalogDocuments)
    .where(eq(schema.materialCatalogDocuments.sourceUrl, catalogUrl));
  importJobIds = [];
  scrapeJobIds = [];
  materialIds = [];
  await fixture.cleanup();
  fixture = undefined;
});

test("restarts twice without duplicating products and keeps separate jobs independent", async () => {
  fixture = await createDatabaseFixture();
  const { database, importJobId } = await createJob();
  const products = [product("R14-A"), product("R14-B")];
  const beforeCommit = new AbortController();
  beforeCommit.abort();
  await expect(
    importScrapedProducts(database, products, {
      importJobId,
      mode: "create_all",
      signal: beforeCommit.signal,
    }),
  ).rejects.toThrow("Đã hủy job nhập catalog.");

  const firstResume = new AbortController();
  await expect(
    importScrapedProducts(database, products, {
      importJobId,
      mode: "create_all",
      signal: firstResume.signal,
      onProgress: (progress) => {
        if (progress.created === 1 && progress.processed === 1) {
          firstResume.abort();
        }
      },
    }),
  ).rejects.toThrow("Đã hủy job nhập catalog.");

  const secondResume = new AbortController();
  await expect(
    importScrapedProducts(database, products, {
      importJobId,
      mode: "create_all",
      signal: secondResume.signal,
      onProgress: (progress) => {
        if (progress.created === 1 && progress.processed === 1) {
          secondResume.abort();
        }
      },
    }),
  ).rejects.toThrow("Đã hủy job nhập catalog.");

  const resumed = await importScrapedProducts(database, products, {
    importJobId,
    mode: "create_all",
  });
  expect(resumed).toMatchObject({ created: 2, updated: 0, failed: 0 });

  const resumedAgain = await importScrapedProducts(database, products, {
    importJobId,
    mode: "create_all",
  });
  expect(resumedAgain).toMatchObject({ created: 2, updated: 0, failed: 0 });

  const rows = await database
    .select({ id: schema.materials.id })
    .from(schema.materials)
    .where(
      and(eq(schema.materials.name, "R14-A"), eq(schema.materials.unit, "cái")),
    );
  materialIds.push(...rows.map((row) => row.id));
  expect(rows).toHaveLength(1);

  const secondJob = await createJob();
  const separate = await importScrapedProducts(
    secondJob.database,
    [products[0]!],
    { importJobId: secondJob.importJobId, mode: "create_all" },
  );
  expect(separate).toMatchObject({ created: 1, failed: 0 });
  const all = await secondJob.database
    .select({ id: schema.materials.id })
    .from(schema.materials)
    .where(eq(schema.materials.name, "R14-A"));
  materialIds.push(...all.map((row) => row.id));
  expect(all).toHaveLength(2);

  const ledger = await database
    .select()
    .from(schema.shopImportItems)
    .where(eq(schema.shopImportItems.importJobId, importJobId));
  expect(ledger).toHaveLength(2);
  expect(ledger.every((row) => row.status === "created")).toBe(true);
});

test("fails a legacy interrupted job without ledger evidence", async () => {
  fixture = await createDatabaseFixture();
  const { database, importJobId } = await createJob();
  await recoverInterruptedImportJobsForTests(new Date().toISOString());
  const [job] = await database
    .select({
      status: schema.shopImportJobs.status,
      error: schema.shopImportJobs.error,
    })
    .from(schema.shopImportJobs)
    .where(eq(schema.shopImportJobs.id, importJobId));
  expect(job?.status).toBe("failed");
  expect(job?.error).toContain("không tự động chạy lại");
});
