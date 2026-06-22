import { describe, expect, it } from "vitest";

import {
  formatDate,
  formatDateTime,
  formatDateTimeShort,
  formatLogTimestamp,
  formatNumber,
} from "./datetime";

describe("formatDateTime", () => {
  it("returns 'Chưa có' for null/undefined/empty", () => {
    expect(formatDateTime(null)).toBe("Chưa có");
    expect(formatDateTime(undefined)).toBe("Chưa có");
    expect(formatDateTime("")).toBe("Chưa có");
  });

  it("returns the input when the date is invalid", () => {
    expect(formatDateTime("not-a-date")).toBe("not-a-date");
  });

  it("formats a valid ISO timestamp", () => {
    const result = formatDateTime("2026-05-07T10:30:00.000Z");
    expect(result).not.toBe("Chưa có");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("formatLogTimestamp", () => {
  it("uses local time with milliseconds", () => {
    const date = new Date("2026-05-07T10:30:45.123Z");
    const result = formatLogTimestamp(date);
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
  });
});

describe("formatDateTimeShort", () => {
  it("returns dash for empty values", () => {
    expect(formatDateTimeShort(null)).toBe("-");
    expect(formatDateTimeShort("")).toBe("-");
  });
});

describe("formatDate", () => {
  it("returns 'Chưa có' for empty input", () => {
    expect(formatDate(null)).toBe("Chưa có");
    expect(formatDate("")).toBe("Chưa có");
  });

  it("returns input when invalid", () => {
    expect(formatDate("garbage")).toBe("garbage");
  });
});

describe("formatNumber", () => {
  it("formats integers using vi-VN locale", () => {
    expect(formatNumber(1234567)).toMatch(/1.234.567|1,234,567/);
  });

  it("returns '0' for null/undefined/NaN", () => {
    expect(formatNumber(null)).toBe("0");
    expect(formatNumber(undefined)).toBe("0");
    expect(formatNumber(Number.NaN)).toBe("0");
  });
});
