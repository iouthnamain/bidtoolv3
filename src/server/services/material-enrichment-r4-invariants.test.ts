import { describe, expect, test } from "vitest";
import { assertEnrichmentWorkSet } from "~/server/services/material-enrichment-runner";

describe("persisted enrichment work invariants", () => {
  test.each(["auto", "review", "committed", "rejected", "failed", "skipped"])(
    "%s is terminal work",
    (status) => {
      expect(() =>
        assertEnrichmentWorkSet(
          { total: 1, materialIds: [7] },
          [{ materialId: 7, status }],
          true,
        ),
      ).not.toThrow();
    },
  );
  test.each(["pending", "processing"])(
    "%s can run but cannot complete",
    (status) => {
      const job = { total: 1, materialIds: [7] };
      const items = [{ materialId: 7, status }];
      expect(() => assertEnrichmentWorkSet(job, items)).not.toThrow();
      expect(() => assertEnrichmentWorkSet(job, items, true)).toThrow(
        "chưa kết thúc",
      );
    },
  );
  test.each([
    { total: 0, materialIds: [] },
    { total: 1, materialIds: [7, 7] },
    { total: 2, materialIds: [7, 7] },
    { total: 1, materialIds: [8] },
    { total: 1, materialIds: [-7] },
  ])("rejects malformed expected set $materialIds / $total", (job) => {
    expect(() =>
      assertEnrichmentWorkSet(job, [{ materialId: 7, status: "auto" }], true),
    ).toThrow("tạo job mới");
  });
  test("does not accept a partial work set or unknown status", () => {
    const job = { total: 1, materialIds: [7] };
    expect(() => assertEnrichmentWorkSet(job, [], true)).toThrow("tạo job mới");
    expect(() =>
      assertEnrichmentWorkSet(
        job,
        [{ materialId: 7, status: "unknown" }],
        true,
      ),
    ).toThrow("tạo job mới");
  });
});
