import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertValidCatalogPdf,
  CatalogPdfStorageError,
  decodeCatalogPdfBase64,
  deleteCatalogPdfFiles,
  readCatalogPdfFile,
  sanitizeCatalogPdfFileName,
  saveCatalogPdfFile,
} from "./catalog-pdf-storage";

function makePdf(body = "test") {
  return Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from(body)]);
}

describe("catalog pdf storage", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "catalog-pdf-test-"));
    vi.stubEnv("BIDTOOL_CATALOG_PDF_DIR", root);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  describe("sanitizeCatalogPdfFileName", () => {
    it("strips path components and forces a .pdf extension", () => {
      expect(sanitizeCatalogPdfFileName("../../etc/passwd")).toBe("passwd.pdf");
      expect(sanitizeCatalogPdfFileName("Báo giá 2026.pdf")).toBe(
        "Báo giá 2026.pdf",
      );
      expect(sanitizeCatalogPdfFileName("   ")).toBe("catalog.pdf");
    });
  });

  describe("assertValidCatalogPdf", () => {
    it("rejects empty buffers and non-PDF content", () => {
      expect(() => assertValidCatalogPdf(Buffer.alloc(0))).toThrow(
        CatalogPdfStorageError,
      );
      expect(() => assertValidCatalogPdf(Buffer.from("not a pdf"))).toThrow(
        CatalogPdfStorageError,
      );
      expect(() => assertValidCatalogPdf(makePdf())).not.toThrow();
    });
  });

  describe("decodeCatalogPdfBase64", () => {
    it("decodes a data URL payload", () => {
      const base64 = makePdf("hello").toString("base64");
      const decoded = decodeCatalogPdfBase64(
        `data:application/pdf;base64,${base64}`,
      );
      expect(decoded.toString("latin1")).toContain("%PDF-");
    });

    it("throws on empty data", () => {
      expect(() => decodeCatalogPdfBase64("")).toThrow(CatalogPdfStorageError);
    });
  });

  describe("saveCatalogPdfFile", () => {
    it("writes the file and returns metadata with a checksum", async () => {
      const stored = await saveCatalogPdfFile(7, "cat.pdf", makePdf("abc"));
      expect(stored.localFilePath).toBe(path.join("7", "cat.pdf"));
      expect(stored.fileSize).toBeGreaterThan(0);
      expect(stored.checksum).toMatch(/^[0-9a-f]{64}$/);

      const read = await readCatalogPdfFile(stored.localFilePath);
      expect(read.toString("latin1")).toContain("abc");
    });

    it("does not leave an orphan when the document dir is cleared before a reupload with a new name", async () => {
      await saveCatalogPdfFile(9, "old-name.pdf", makePdf("v1"));

      // Mirrors the reuploadPdf flow: clear the document dir, then save again.
      await deleteCatalogPdfFiles(9);
      const replaced = await saveCatalogPdfFile(9, "new-name.pdf", makePdf("v2"));

      const filesInDir = await readdir(path.join(root, "9"));
      expect(filesInDir).toEqual(["new-name.pdf"]);

      const read = await readCatalogPdfFile(replaced.localFilePath);
      expect(read.toString("latin1")).toContain("v2");
    });

    it("changes the checksum when the bytes change", async () => {
      const first = await saveCatalogPdfFile(11, "c.pdf", makePdf("one"));
      const second = await saveCatalogPdfFile(11, "c.pdf", makePdf("two"));
      expect(first.checksum).not.toBe(second.checksum);
    });
  });

  describe("readCatalogPdfFile", () => {
    it("rejects path traversal outside the storage root", async () => {
      await expect(
        readCatalogPdfFile("../../../etc/passwd"),
      ).rejects.toBeInstanceOf(CatalogPdfStorageError);
    });
  });

  describe("deleteCatalogPdfFiles", () => {
    it("is a no-op when the directory does not exist", async () => {
      await expect(deleteCatalogPdfFiles(404)).resolves.toBeUndefined();
    });
  });
});
