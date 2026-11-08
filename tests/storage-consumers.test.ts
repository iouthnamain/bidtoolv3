import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("~/server/services/app-settings", () => ({
  resolveExcelResearchDir: vi.fn(async () => null),
}));
import { resolveExcelResearchDir } from "~/server/services/app-settings";
import {
  readCatalogPdfFile,
  saveCatalogPdfFile,
} from "~/server/services/catalog-pdf-storage";
import {
  readExcelResearchArtifact,
  saveOriginalWorkbook,
  saveResearchPdf,
} from "~/server/services/excel-research-storage";

let root: string;
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  if (root) await rm(root, { force: true, recursive: true });
});
test("PDF and research consumers write/read bytes under the data root", async () => {
  root = await mkdtemp(path.join(tmpdir(), "bidtool-storage-consumers-"));
  vi.stubEnv("BIDTOOL_DATA_DIR", root);
  vi.stubEnv("BIDTOOL_CATALOG_PDF_DIR", "");
  const pdf = Buffer.from("%PDF-1.4\nfixture");
  const stored = await saveCatalogPdfFile(1, "a.pdf", pdf);
  expect(await readCatalogPdfFile(stored.localFilePath)).toEqual(pdf);
  expect(await readFile(path.join(root, "catalog-pdfs", stored.localFilePath))).toEqual(pdf);
  const workbook = await saveOriginalWorkbook(
    "job",
    "source.xlsx",
    Buffer.from("workbook"),
  );
  expect(await readExcelResearchArtifact(workbook.localFilePath)).toEqual(
    Buffer.from("workbook"),
  );
  const generated = await saveResearchPdf("job", "generated.pdf", pdf);
  expect(
    await readFile(path.join(root, "excel-research", generated.localFilePath)),
  ).toEqual(pdf);
  vi.mocked(resolveExcelResearchDir).mockResolvedValue(
    path.join(root, "explicit-research"),
  );
  await saveOriginalWorkbook("job", "override.xlsx", Buffer.from("override"));
  expect(
    await readFile(
      path.join(root, "explicit-research/job/original/override.xlsx"),
      "utf8",
    ),
  ).toBe("override");
});
