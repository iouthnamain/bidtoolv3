import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

describe("GET /api/ready", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 503 when the database is not configured while liveness stays independent", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      service: "bidtoolv3",
      checks: {
        database: "failed",
        migration: "failed",
        scheduler: "failed",
      },
    });
  });
});
