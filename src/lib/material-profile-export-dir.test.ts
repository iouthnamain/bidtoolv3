import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { buildMaterialProfileRevisionZip } from "~/lib/material-profile-export-dir";

describe("material profile revision ZIP", () => {
  it("contains exactly the frozen workbook, manifest, and warnings at the root", async () => {
    const zipBytes = await buildMaterialProfileRevisionZip({
      revision: {
        id: "11111111-1111-4111-8111-111111111111",
        workspaceId: 1,
        revisionNumber: 2,
        excelFileName: "IB-001-ban-xuat-002.xlsx",
        summary: {
          totalRows: 1,
          ready: 1,
          needs_review: 0,
          skipped: 0,
          excluded: 0,
        },
        createdAt: "2026-08-20T09:30:00.000Z",
      },
      zipFileName: "IB-001-ban-xuat-002.zip",
      files: [
        {
          fileName: "IB-001-ban-xuat-002.xlsx",
          encoding: "base64",
          content: Buffer.from("xlsx-bytes").toString("base64"),
        },
        {
          fileName: "manifest.json",
          encoding: "utf8",
          content: '{"schemaVersion":1}\n',
        },
        {
          fileName: "warnings.csv",
          encoding: "utf8",
          content: '"status"\r\n',
        },
      ],
    });
    const zip = await JSZip.loadAsync(zipBytes);

    expect(Object.keys(zip.files).sort()).toEqual([
      "IB-001-ban-xuat-002.xlsx",
      "manifest.json",
      "warnings.csv",
    ]);
    expect(await zip.file("manifest.json")?.async("string")).toBe(
      '{"schemaVersion":1}\n',
    );
    expect(await zip.file("warnings.csv")?.async("string")).toBe(
      '"status"\r\n',
    );
  });
});
