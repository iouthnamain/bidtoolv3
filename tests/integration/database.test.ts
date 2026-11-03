import postgres from "postgres";
import { requireTestDatabase } from "../fixtures/remediation/test-target";
import { expect, test } from "vitest";
import {
  barrier,
  createDatabaseFixture,
} from "../fixtures/remediation/database";

test("migrations provision the application schema on PostgreSQL 16", async () => {
  const fixture = await createDatabaseFixture();
  try {
    const [row] = await fixture.first`
      select current_database() as database, current_user as role,
        current_setting('server_version_num')::int as version,
        to_regclass('public.excel_workspace_items')::text as items,
        to_regclass('public.material_profile_promotion_ledger')::text as ledger
    `;
    expect(row).toMatchObject({
      role: "bidtool_test",
      items: "excel_workspace_items",
      ledger: "material_profile_promotion_ledger",
    });
    expect(row?.database).toMatch(/^bidtool_test_/);
    expect(row?.version).toBeGreaterThanOrEqual(160000);
    expect(row?.version).toBeLessThan(170000);
  } finally {
    await fixture.cleanup();
  }
});

test("independent transactions synchronize before updating one owned row", async () => {
  const { first, second, schema, cleanup } = await createDatabaseFixture();
  const table = `${schema}.counter`;
  try {
    await first`create table ${first(table)} (id int primary key, value int not null)`;
    await first`insert into ${first(table)} values (1, 0)`;
    const meet = barrier(2);
    const pids: number[] = [];
    await Promise.all(
      [first, second].map((connection) =>
        connection.begin(async (tx) => {
          const [row] = await tx<
            { pid: number }[]
          >`select pg_backend_pid() as pid`;
          if (!row) throw new Error("No PostgreSQL backend.");
          pids.push(row.pid);
          await meet();
          await tx`update ${tx(table)} set value = value + 1 where id = 1`;
        }),
      ),
    );
    expect(new Set(pids).size).toBe(2);
    const [row] = await first`select value from ${first(table)} where id = 1`;
    expect(row?.value).toBe(2);
  } finally {
    await cleanup();
  }
  // Verify the owned schema was removed after both fixture connections closed.
  const inspector = postgres(requireTestDatabase(), { max: 1 });
  try {
    const [row] =
      await inspector`select to_regnamespace(${schema})::text as schema`;
    expect(row?.schema).toBeNull();
  } finally {
    await inspector.end();
  }
});
