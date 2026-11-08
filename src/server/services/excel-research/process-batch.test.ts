import { describe, expect, it } from "vitest";

import { isExcelProcessingRowOrphaned } from "./process-batch";

describe("Excel startup recovery", () => {
  const now = Date.parse("2026-11-05T12:00:00.000Z");

  it("reclaims fresh and timestamp-less rows only during startup", () => {
    expect(
      isExcelProcessingRowOrphaned("2026-11-05T11:59:30.000Z", now, true),
    ).toBe(true);
    expect(isExcelProcessingRowOrphaned(null, now, true)).toBe(true);
    expect(isExcelProcessingRowOrphaned("2026-11-05T11:59:30.000Z", now)).toBe(
      false,
    );
    expect(isExcelProcessingRowOrphaned(null, now)).toBe(false);
  });

  it("keeps the ten-minute maintenance guard", () => {
    expect(isExcelProcessingRowOrphaned("2026-11-05T11:50:00.001Z", now)).toBe(
      false,
    );
    expect(isExcelProcessingRowOrphaned("2026-11-05T11:49:59.000Z", now)).toBe(
      true,
    );
  });
});
