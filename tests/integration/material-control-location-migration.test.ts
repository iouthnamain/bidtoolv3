import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { createDatabaseFixture } from "../fixtures/remediation/database";

test("0044 repairs shared location codes without changing references", async () => {
  const { first, schema, cleanup } = await createDatabaseFixture();
  try {
    const migration = await readFile(
      new URL("../../drizzle/0044_white_starjammers.sql", import.meta.url),
      "utf8",
    );
    const longCode = "đ".repeat(120);

    await first.begin(async (tx) => {
      await tx`set local search_path to ${tx(schema)}`;
      await tx`
        create table material_control_locations (
          id integer primary key,
          project_id integer,
          code text not null
        )
      `;
      await tx`
        create unique index material_control_locations_project_code_unique
          on material_control_locations (project_id, code)
      `;
      await tx`
        create table material_control_stock_movements (
          destination_location_id integer references material_control_locations(id),
          movement_type text not null,
          quantity numeric not null,
          constraint material_control_stock_movements_quantity_positive
            check (quantity > 0)
        )
      `;
      await tx`
        insert into material_control_locations values
          (1, null, 'KHO'), (2, null, 'KHO'), (3, null, 'KHO-2'),
          (4, 1, 'KHO'), (5, null, ${longCode}), (6, null, ${longCode})
      `;
      await tx`insert into material_control_stock_movements values (2, 'receipt', 1)`;

      for (const statement of migration.split("--> statement-breakpoint")) {
        await tx.unsafe(statement);
      }

      const locations =
        await tx`select id, code from material_control_locations order by id`;
      expect(locations).toEqual([
        { id: 1, code: "KHO" },
        { id: 2, code: "KHO-2-1" },
        { id: 3, code: "KHO-2" },
        { id: 4, code: "KHO" },
        { id: 5, code: longCode },
        { id: 6, code: `${longCode.slice(0, 118)}-6` },
      ]);
      const movements =
        await tx`select destination_location_id from material_control_stock_movements`;
      expect(movements).toEqual([{ destination_location_id: 2 }]);
      const duplicate = await tx`
        insert into material_control_locations values (7, null, 'KHO')
        on conflict do nothing returning id
      `;
      expect(duplicate).toHaveLength(0);
    });
  } finally {
    await cleanup();
  }
});
