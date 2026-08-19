import { describe, expect, it } from "vitest";

import { materialProfileRouter } from "~/server/api/routers/material-profile";

describe("material profile export API", () => {
  it("exposes only immutable Step 4 export procedures", () => {
    const procedures = materialProfileRouter._def.procedures;

    expect(procedures).toHaveProperty("createExportRevision");
    expect(procedures).toHaveProperty("listExportRevisions");
    expect(procedures).toHaveProperty("downloadExportRevision");
    expect(procedures).not.toHaveProperty("export");
    expect(procedures).not.toHaveProperty("exportDownloadBundle");
  });
});
