import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";

import type postgres from "postgres";
import { afterEach, beforeEach, expect, test } from "vitest";

import { profileCandidateSearchGeneration } from "~/lib/materials/profile-candidate-capture";
import {
  advanceMaterialProfileScrapeJobs,
  cancelMaterialProfileScrapeJob,
  MaterialProfileScrapeJobError,
} from "~/server/services/material-profile-scrape-jobs";
import { createDatabaseFixture } from "../fixtures/remediation/database";

let fixture: Awaited<ReturnType<typeof createDatabaseFixture>>;
let workspaceId: number | undefined;
let childId: string | undefined;

beforeEach(async () => {
  fixture = await createDatabaseFixture();
});

afterEach(async () => {
  try {
    if (workspaceId !== undefined) {
      await fixture.second`delete from excel_workspaces where id = ${workspaceId}`;
    }
    if (childId !== undefined) {
      await fixture.second`delete from shop_scrape_jobs where id = ${childId}`;
    }
  } finally {
    workspaceId = undefined;
    childId = undefined;
    await fixture.cleanup();
  }
});

async function seed(status: "running" | "awaiting_review") {
  const { second } = fixture;
  const [workspace] = await second<{ id: number }[]>`
    insert into excel_workspaces (name) values ('Scrape lock test') returning id`;
  if (!workspace) throw new Error("Failed to create the workspace.");
  workspaceId = workspace.id;
  const [item] = await second<{ id: number }[]>`
    insert into excel_workspace_items (workspace_id, original_row_index, product_name)
    values (${workspace.id}, 1, 'Valve') returning id`;
  if (!item) throw new Error("Failed to create the workspace item.");

  const jobId = randomUUID();
  childId = randomUUID();
  const url = "https://example.com/valve";
  await second`
    insert into shop_scrape_jobs (id, url, normalized_url, status, products, product_count)
    values (${childId}, ${url}, ${url}, 'completed', ${second.json([
      { name: "Valve", sourceUrl: url, specText: "100 mm", unit: "each" },
    ])}, 1)`;
  await second`
    insert into material_profile_scrape_jobs (id, workspace_id, status, total)
    values (${jobId}, ${workspace.id}, ${status}, 1)`;
  const runStatus =
    status === "running" ? status : "awaiting_product_selection";
  await second`
    insert into material_profile_scrape_runs (
      id, job_id, workspace_id, item_id, original_row_index, status, source_url,
      input_snapshot_json, shop_scrape_job_id
    ) values (
      ${randomUUID()}, ${jobId}, ${workspace.id}, ${item.id}, 1, ${runStatus}, ${url},
      ${second.json({ searchGeneration: profileCandidateSearchGeneration(undefined) })}, ${childId}
    )`;
  return { workspaceId: workspace.id, jobId };
}

async function waitForBlockedTransaction(tx: postgres.TransactionSql) {
  const deadline = Date.now() + 3_000;
  // Release the fixture only after PostgreSQL sees the service's competing lock.
  while (Date.now() < deadline) {
    const [row] = await tx<{ blocked: boolean }[]>`
      select exists (
        select from pg_locks
        where not granted and pg_backend_pid() = any(pg_blocking_pids(pid))
      ) as blocked`;
    if (row?.blocked) return;
    await setTimeout(10);
  }
  throw new Error(
    "The competing transaction never waited for the fixture lock.",
  );
}

test("auto-capture can race a workbook replacement without a deadlock", async () => {
  const { workspaceId } = await seed("running");
  let capture: Promise<unknown> | undefined;
  try {
    await fixture.first.begin(async (tx) => {
      await tx`select id from excel_workspace_items where workspace_id = ${workspaceId} order by id for update`;
      capture = advanceMaterialProfileScrapeJobs().catch(
        (error: unknown) => error,
      );
      await waitForBlockedTransaction(tx);
      await tx`delete from excel_workspace_items where workspace_id = ${workspaceId}`;
    });
  } finally {
    await capture;
  }
  expect(await capture).toBeUndefined();
});

test("cancellation can race a delete of the scrape job without a deadlock", async () => {
  const { workspaceId, jobId } = await seed("awaiting_review");
  let cancellation: Promise<unknown> | undefined;
  try {
    await fixture.first.begin(async (tx) => {
      await tx`select id from material_profile_scrape_jobs where id = ${jobId} for update`;
      cancellation = cancelMaterialProfileScrapeJob(jobId, workspaceId).catch(
        (error: unknown) => error,
      );
      await waitForBlockedTransaction(tx);
      await tx`delete from material_profile_scrape_jobs where id = ${jobId}`;
    });
  } finally {
    await cancellation;
  }
  const result = await cancellation;
  expect(result).toBeInstanceOf(MaterialProfileScrapeJobError);
  expect(result).toMatchObject({ code: "NOT_FOUND" });
});
