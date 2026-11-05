import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import {
  relocatedProfileWorkbook,
  resolveDataRoot,
  resolveStorageDirectory,
} from "~/server/services/data-root";

afterEach(() => vi.unstubAllEnvs());
test("source defaults stay in project data; data root is trimmed and explicit directories win", () => {
  vi.stubEnv("BIDTOOL_DATA_DIR", "");
  expect(resolveDataRoot()).toBe(path.join(process.cwd(), "data"));
  vi.stubEnv("BIDTOOL_DATA_DIR", " /durable/files ");
  for (const tree of [
    "catalog-pdfs",
    "excel-research",
    "material-profiles",
  ] as const) {
    expect(resolveStorageDirectory(tree)).toBe(
      path.join("/durable/files", tree),
    );
    expect(resolveStorageDirectory(tree, " /override ")).toBe("/override");
    expect(resolveStorageDirectory(tree, "relative")).toBe(
      path.resolve("relative"),
    );
  }
});
test("legacy standalone profile cache can be found after moving to userData", () => {
  expect(
    relocatedProfileWorkbook(
      "/old/app/data/material-profiles/7/a.xlsx",
      "/user/data/material-profiles",
    ),
  ).toBe("/user/data/material-profiles/7/a.xlsx");
  expect(
    relocatedProfileWorkbook(
      "C:\\old\\data\\material-profiles\\7\\a.xlsx",
      "/user/data/material-profiles",
    ),
  ).toBe("/user/data/material-profiles/7/a.xlsx");
  expect(
    relocatedProfileWorkbook(
      "/data/material-profiles/../../../etc/passwd",
      "/user/data/material-profiles",
    ),
  ).toBeNull();
  expect(
    relocatedProfileWorkbook(
      "/explicit/workbook.xlsx",
      "/user/data/material-profiles",
    ),
  ).toBeNull();
});
