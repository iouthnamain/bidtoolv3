import { describe, expect, it } from "vitest";

import { progressPercent, progressWidth } from "./scrape-job-utils";

describe("scrape progress helpers", () => {
  it("reports bounded percentages for known limits", () => {
    expect(progressPercent(25, 100)).toBe(25);
    expect(progressPercent(120, 100)).toBe(100);
    expect(progressPercent(1, 0)).toBe(0);
  });

  it("uses an indeterminate width only while active", () => {
    expect(progressWidth(null, true)).toBe("55%");
    expect(progressWidth(null, false)).toBe("100%");
    expect(progressWidth(42, true)).toBe("42%");
  });
});
