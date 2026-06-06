import { describe, expect, it } from "vitest";

import {
  emptySearchCriteria,
  isValidDateFilterValue,
  normalizeSearchCriteria,
  parseCsvList,
  parseMinMatch,
  parsePositiveId,
  parsePositiveInt,
} from "./search-criteria";

describe("parseCsvList", () => {
  it("splits and trims CSV input", () => {
    expect(parseCsvList("a, b,  c")).toEqual(["a", "b", "c"]);
  });

  it("filters empty entries", () => {
    expect(parseCsvList("a,, ,b")).toEqual(["a", "b"]);
  });

  it("returns empty array for empty input", () => {
    expect(parseCsvList("")).toEqual([]);
  });
});

describe("parsePositiveInt", () => {
  it("returns the parsed integer", () => {
    expect(parsePositiveInt("42", 1)).toBe(42);
  });

  it("returns fallback for null", () => {
    expect(parsePositiveInt(null, 7)).toBe(7);
  });

  it("returns fallback for non-positive", () => {
    expect(parsePositiveInt("0", 5)).toBe(5);
    expect(parsePositiveInt("-3", 5)).toBe(5);
  });

  it("returns fallback for non-numeric", () => {
    expect(parsePositiveInt("abc", 9)).toBe(9);
  });
});

describe("parsePositiveId", () => {
  it("returns parsed positive id", () => {
    expect(parsePositiveId("123")).toBe(123);
  });

  it("returns null for invalid input", () => {
    expect(parsePositiveId(null)).toBeNull();
    expect(parsePositiveId("0")).toBeNull();
    expect(parsePositiveId("-1")).toBeNull();
    expect(parsePositiveId("abc")).toBeNull();
  });
});

describe("parseMinMatch", () => {
  it("clamps to 0-100", () => {
    expect(parseMinMatch("50")).toBe(50);
    expect(parseMinMatch("150")).toBe(100);
    expect(parseMinMatch("-10")).toBe(0);
  });

  it("returns 0 for null/garbage", () => {
    expect(parseMinMatch(null)).toBe(0);
    expect(parseMinMatch("garbage")).toBe(0);
  });
});

describe("isValidDateFilterValue", () => {
  it("accepts YYYY-MM-DD", () => {
    expect(isValidDateFilterValue("2026-05-07")).toBe(true);
  });

  it("rejects malformed input", () => {
    expect(isValidDateFilterValue("2026-5-7")).toBe(false);
    expect(isValidDateFilterValue("not-a-date")).toBe(false);
    expect(isValidDateFilterValue("2026-13-01")).toBe(false);
  });
});

describe("normalizeSearchCriteria", () => {
  it("returns defaults for an empty input", () => {
    const normalized = normalizeSearchCriteria({});
    expect(normalized.keyword).toBe("");
    expect(normalized.classifyIds).toEqual([]);
    expect(normalized.minMatchScore).toBe(0);
    expect(normalized.budgetMin).toBeNull();
  });

  it("clamps minMatchScore to 0-100", () => {
    expect(normalizeSearchCriteria({ minMatchScore: 200 }).minMatchScore).toBe(
      100,
    );
    expect(normalizeSearchCriteria({ minMatchScore: -5 }).minMatchScore).toBe(
      0,
    );
  });

  it("dedupes and sorts classifyIds", () => {
    const result = normalizeSearchCriteria({
      classifyIds: [3, 1, 1, 2, -1, 0],
    });
    expect(result.classifyIds).toEqual([1, 2, 3]);
  });

  it("rounds budget values to non-negative integers", () => {
    const result = normalizeSearchCriteria({
      budgetMin: -5.7,
      budgetMax: 99.4,
    });
    expect(result.budgetMin).toBe(0);
    expect(result.budgetMax).toBe(99);
  });

  it("normalizes empty input as empty criteria", () => {
    const normalized = normalizeSearchCriteria({});
    expect(normalized).toEqual(emptySearchCriteria);
  });
});
