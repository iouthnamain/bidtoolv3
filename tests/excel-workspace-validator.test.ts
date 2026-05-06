import { describe, expect, it } from "vitest";

import type { StandardSheetTemplateId } from "~/lib/excel-workspace-standard";
import {
  validateWorkspaceForStandardExport,
  type ValidatableWorkspaceItem,
} from "~/server/services/excel-workspace-validator";

function workspace(templateIds: StandardSheetTemplateId[] = ["thvt"]) {
  return { selectedSheetTemplateIds: templateIds };
}

function item(
  patch: Partial<ValidatableWorkspaceItem> = {},
): ValidatableWorkspaceItem {
  return {
    id: 1,
    productName: "Dây điện",
    unit: "m",
    term: "term_1",
    qtyTotal: 10,
    qtyInStock: 2,
    reusePct: 0,
    inspectionQtyTerm1: 1,
    inspectionQtyTerm2: 1,
    unitPrice: 4000,
    selectedCandidateId: 1,
    includedInExport: true,
    ...patch,
  };
}

function codesFor(
  input: Parameters<typeof validateWorkspaceForStandardExport>[0],
) {
  return validateWorkspaceForStandardExport(input).map((issue) => issue.code);
}

function errorsFor(
  input: Parameters<typeof validateWorkspaceForStandardExport>[0],
) {
  return validateWorkspaceForStandardExport(input)
    .filter((issue) => issue.severity === "error")
    .map((issue) => issue.code);
}

describe("standard workspace export validation", () => {
  it("blocks an empty workspace", () => {
    expect(errorsFor({ workspace: workspace(), items: [] })).toContain(
      "EMPTY_WORKSPACE",
    );
  });

  it("blocks missing templates", () => {
    expect(errorsFor({ workspace: workspace([]), items: [item()] })).toContain(
      "NO_SELECTED_TEMPLATES",
    );
  });

  it("blocks missing required material fields and invalid quantities", () => {
    const codes = errorsFor({
      workspace: workspace(),
      items: [
        item({
          productName: "",
          unit: "",
          qtyTotal: 0,
          qtyInStock: 4,
          reusePct: 101,
        }),
      ],
    });

    expect(codes).toEqual(
      expect.arrayContaining([
        "MISSING_MATERIAL_NAME",
        "MISSING_UNIT",
        "INVALID_QTY_TOTAL",
        "STOCK_OVERFLOW",
        "INVALID_REUSE_PCT",
      ]),
    );
  });

  it("blocks a selected inspection template that would export no rows", () => {
    expect(
      errorsFor({
        workspace: workspace(["inspection_term_1"]),
        items: [item({ inspectionQtyTerm1: null })],
      }),
    ).toContain("EMPTY_TEMPLATE_SHEET");
  });

  it("treats missing evidence and duplicate material terms as warnings", () => {
    const issues = validateWorkspaceForStandardExport({
      workspace: workspace(),
      items: [
        item({ id: 1, selectedCandidateId: null }),
        item({ id: 2, selectedCandidateId: null }),
      ],
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          code: "MISSING_EVIDENCE",
        }),
        expect.objectContaining({
          severity: "warning",
          code: "DUPLICATE_MATERIAL_TERM",
        }),
      ]),
    );
    expect(issues.some((issue) => issue.severity === "error")).toBe(false);
  });

  it("warns when no purchase quantity remains", () => {
    expect(
      codesFor({
        workspace: workspace(["thvt"]),
        items: [item({ qtyTotal: 2, qtyInStock: 2 })],
      }),
    ).toContain("NO_PURCHASE");
  });
});
