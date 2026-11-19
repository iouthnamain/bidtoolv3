import { afterEach, expect, test } from "vitest";

import { GET } from "~/app/api/ready/route";
import {
  resetSchedulerStateForTests,
  setSchedulerState,
} from "~/server/services/scheduler-state";

afterEach(resetSchedulerStateForTests);

test("reports ready against a database migrated from the current journal", async () => {
  setSchedulerState("ready");

  const response = await GET();

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    ok: true,
    checks: { database: "ok", migration: "ok", scheduler: "ok" },
  });
});
