import "server-only";

import postgres from "postgres";

import { hasDatabaseUrl } from "~/server/runtime";
import {
  getSchedulerState,
  schedulerRequiredForRuntime,
} from "~/server/services/scheduler-state";
import { createLogger } from "~/server/lib/logger";

const log = createLogger("api-ready");
const READINESS_DEADLINE_MS = 2_000;
// Keep this marker aligned with the latest committed drizzle/meta/_journal.json
// entry. Readiness reports a schema mismatch; it never applies migrations.
const EXPECTED_MIGRATION_CREATED_AT = 1_793_768_680_943;

type CheckStatus = "ok" | "failed" | "disabled" | "timeout";

export type ReadinessResponse = {
  ok: boolean;
  service: "bidtoolv3";
  timestamp: string;
  checks: {
    database: CheckStatus;
    migration: CheckStatus;
    scheduler: CheckStatus;
  };
};

let inFlightReadiness: Promise<ReadinessResponse> | null = null;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("readiness_timeout")),
      timeoutMs,
    );
    timer.unref?.();
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

async function checkDatabaseAndMigration() {
  if (!hasDatabaseUrl()) {
    return { database: false, migration: false };
  }
  const client = postgres(process.env.DATABASE_URL!, {
    max: 1,
    connect_timeout: 1,
    idle_timeout: 1,
  });
  try {
    await client`set statement_timeout = '1000ms'`;
    await client`select 1`;
    const rows = await client<{ created_at: number | string }[]>`
      select created_at
      from drizzle.__drizzle_migrations
      order by id desc
      limit 1
    `;
    return {
      database: true,
      migration: Number(rows[0]?.created_at) === EXPECTED_MIGRATION_CREATED_AT,
    };
  } finally {
    await client.end({ timeout: 1 });
  }
}

async function evaluateReadiness(): Promise<ReadinessResponse> {
  const checks: ReadinessResponse["checks"] = {
    database: "failed",
    migration: "failed",
    scheduler: schedulerRequiredForRuntime() ? "failed" : "disabled",
  };

  try {
    const result = await checkDatabaseAndMigration();
    checks.database = result.database ? "ok" : "failed";
    checks.migration = result.migration ? "ok" : "failed";
  } catch (error) {
    log.warn("readiness_dependency_failed", { error });
  }

  if (schedulerRequiredForRuntime()) {
    const scheduler = getSchedulerState();
    checks.scheduler =
      scheduler.state === "ready" && scheduler.lastError === null
        ? "ok"
        : "failed";
    if (checks.scheduler !== "ok") {
      log.warn("readiness_scheduler_failed", {
        state: scheduler.state,
        lastError: scheduler.lastError,
      });
    }
  }

  return {
    ok: Object.values(checks).every(
      (status) => status === "ok" || status === "disabled",
    ),
    service: "bidtoolv3",
    timestamp: new Date().toISOString(),
    checks,
  };
}

export async function getReadinessStatus() {
  inFlightReadiness ??= withTimeout(evaluateReadiness(), READINESS_DEADLINE_MS)
    .catch((error) => {
      log.warn("readiness_timeout", { error });
      return {
        ok: false,
        service: "bidtoolv3" as const,
        timestamp: new Date().toISOString(),
        checks: {
          database: "timeout" as const,
          migration: "timeout" as const,
          scheduler: schedulerRequiredForRuntime()
            ? ("timeout" as const)
            : ("disabled" as const),
        },
      };
    })
    .finally(() => {
      inFlightReadiness = null;
    });
  return inFlightReadiness;
}
