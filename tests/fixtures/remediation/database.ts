import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { requireTestDatabase } from "./test-target";

export async function createDatabaseFixture() {
  const databaseUrl = requireTestDatabase();
  const schema = `fixture_${randomUUID().replaceAll("-", "")}`;
  const first = postgres(databaseUrl, { max: 1, connect_timeout: 5 });
  const second = postgres(databaseUrl, { max: 1, connect_timeout: 5 });
  try {
    await first`create schema ${first(schema)}`;
  } catch (error) {
    await Promise.all([first.end(), second.end()]);
    throw error;
  }
  return {
    first,
    second,
    schema,
    async cleanup() {
      try {
        await first`drop schema ${first(schema)} cascade`;
      } finally {
        await Promise.all([first.end(), second.end()]);
      }
    },
  };
}

export function barrier(participants: number) {
  let arrived = 0;
  let release: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    arrived += 1;
    if (arrived === participants) release();
    await gate;
  };
}
