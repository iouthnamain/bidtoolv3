import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "~/env";
import * as schema from "./schema";

function resolveDatabaseUrl() {
  const databaseUrl = env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not configured. Set a Postgres connection URL before using database-backed features.",
    );
  }

  try {
    const url = new URL(databaseUrl);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      throw new Error("Unsupported protocol");
    }
  } catch {
    throw new Error(
      "DATABASE_URL is not a valid Postgres connection URL. Check the Vercel environment variable value.",
    );
  }

  return databaseUrl;
}

const globalForDb = globalThis as unknown as {
  client: postgres.Sql | undefined;
  db: ReturnType<typeof createDb> | undefined;
};

let productionClient: postgres.Sql | undefined;
let productionDb: ReturnType<typeof createDb> | undefined;

function createClient() {
  return postgres(resolveDatabaseUrl(), {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });
}

function createDb() {
  const client = globalForDb.client ?? productionClient ?? createClient();

  if (env.NODE_ENV !== "production") {
    globalForDb.client = client;
  } else {
    productionClient = client;
  }

  return drizzle(client, { schema });
}

function getDb() {
  const database = globalForDb.db ?? productionDb ?? createDb();

  if (env.NODE_ENV !== "production") {
    globalForDb.db = database;
  } else {
    productionDb = database;
  }

  return database;
}

export const db = new Proxy({} as ReturnType<typeof createDb>, {
  get(_target, property): unknown {
    return Reflect.get(getDb(), property) as unknown;
  },
});
