import { describe, expect, it } from "vitest";

import { restoredMaterialProfileStep } from "~/lib/materials/profile-workflow-step";

describe("material profile restored step", () => {
  it("restores matched workspaces with unresolved review work to step 3", () => {
    expect(
      restoredMaterialProfileStep({
        sheetCount: 1,
        itemCount: 6,
        unresolvedReviewCount: 6,
        workspaceStatus: "matched",
      }),
    ).toBe(3);
  });

  it("restores fully reviewed matched workspaces to step 4", () => {
    expect(
      restoredMaterialProfileStep({
        sheetCount: 1,
        itemCount: 6,
        unresolvedReviewCount: 0,
      }),
    ).toBe(4);
  });

  it("keeps previously exported workspaces on step 4", () => {
    expect(
      restoredMaterialProfileStep({
        sheetCount: 1,
        itemCount: 6,
        unresolvedReviewCount: 2,
        workspaceStatus: "catalog_generated",
      }),
    ).toBe(4);
  });
});
