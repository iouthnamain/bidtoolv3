import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { afterEach, expect, test } from "vitest";

import * as schema from "~/server/db/schema";
import {
  isMaterialRevisionConflict,
  updateLockedMaterial,
  updateMaterial,
} from "~/server/services/material-write";
import { createDatabaseFixture } from "../fixtures/remediation/database";

let fixture: Awaited<ReturnType<typeof createDatabaseFixture>> | undefined;
const materialIds: number[] = [];

afterEach(async () => {
  if (!fixture) return;
  const database = drizzle(fixture.first, { schema });
  if (materialIds.length > 0) {
    await database
      .delete(schema.materials)
      .where(eq(schema.materials.id, materialIds[0]!));
  }
  materialIds.length = 0;
  await fixture.cleanup();
  fixture = undefined;
});

test("serializes stale material writes and preserves unrelated metadata", async () => {
  fixture = await createDatabaseFixture();
  const first = drizzle(fixture.first, { schema });
  const second = drizzle(fixture.second, { schema });
  const [seed] = await first
    .insert(schema.materials)
    .values({
      name: "R5 concurrency fixture",
      unit: "m",
      metadataJson: {
        materialProfile: { source: "profile-search" },
        futureWriter: { nested: { keep: true } },
      },
    })
    .returning();
  if (!seed) throw new Error("R5 fixture seed failed.");
  materialIds.push(seed.id);

  let releaseFirst!: () => void;
  const firstRelease = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let firstLocked!: () => void;
  const firstLock = new Promise<void>((resolve) => {
    firstLocked = resolve;
  });
  const firstWrite = first.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(schema.materials)
      .where(eq(schema.materials.id, seed.id))
      .for("update");
    if (!locked) throw new Error("R5 fixture lock failed.");
    firstLocked();
    await firstRelease;
    return updateLockedMaterial(
      tx,
      locked,
      { defaultUnitPrice: 1000 },
      { expectedRevision: seed.revision },
    );
  });
  await firstLock;
  const staleWrite = updateMaterial(
    second,
    seed.id,
    { defaultUnitPrice: 2000 },
    { expectedRevision: seed.revision },
  ).catch((error: unknown) => error);
  releaseFirst();
  const committed = await firstWrite;
  expect(committed.revision).toBe(seed.revision + 1);
  expect(committed.metadataJson).toMatchObject({
    materialProfile: { source: "profile-search" },
    futureWriter: { nested: { keep: true } },
  });

  const stale = await staleWrite;
  expect(isMaterialRevisionConflict(stale)).toBe(true);

  const [current] = await second
    .select()
    .from(schema.materials)
    .where(eq(schema.materials.id, seed.id));
  expect(current?.revision).toBe(seed.revision + 1);
  expect(current?.defaultUnitPrice).toBe(1000);
});
