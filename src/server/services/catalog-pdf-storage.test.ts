import { mkdir, mkdtemp, open, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchPublicContent = vi.hoisted(() => vi.fn());
vi.mock("~/server/services/public-content-client", () => ({
  fetchPublicContent,
  PUBLIC_CONTENT_PDF_MAX_BYTES: 50 * 1024 * 1024,
}));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});

import {
  assertValidCatalogPdf,
  CatalogPdfStorageError,
  decodeCatalogPdfBase64,
  deleteCatalogPdfFiles,
  downloadCatalogPdfFromUrl,
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
    fetchPublicContent.mockReset();
    vi.mocked(open).mockReset();
    root = await mkdtemp(path.join(tmpdir(), "catalog-pdf-test-"));
    vi.stubEnv("BIDTOOL_CATALOG_PDF_DIR", root);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
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
      expect(stored.localFilePath).not.toBe(path.join("7", "cat.pdf"));
      expect(stored.fileName).toBe("cat.pdf");
      expect(stored.fileSize).toBeGreaterThan(0);
      expect(stored.checksum).toMatch(/^[0-9a-f]{64}$/);

      const read = await readCatalogPdfFile(stored.localFilePath);
      expect(read.toString("latin1")).toContain("abc");
    });

    it("preserves previous bytes when staging the same display filename", async () => {
      const first = await saveCatalogPdfFile(9, "cat.pdf", makePdf("v1"));
      const second = await saveCatalogPdfFile(9, "cat.pdf", makePdf("v2"));
      expect(second.localFilePath).not.toBe(first.localFilePath);
      expect(await readCatalogPdfFile(first.localFilePath)).toEqual(
        makePdf("v1"),
      );
      expect(await readCatalogPdfFile(second.localFilePath)).toEqual(
        makePdf("v2"),
      );
      expect(await readdir(path.join(root, "9"))).toHaveLength(2);
    });

    it("changes the checksum when the bytes change", async () => {
      const first = await saveCatalogPdfFile(11, "c.pdf", makePdf("one"));
      const second = await saveCatalogPdfFile(11, "c.pdf", makePdf("two"));
      expect(first.checksum).not.toBe(second.checksum);
    });

    it.each(["partial write", "file sync", "directory sync"])(
      "preserves a legacy current file on %s failure and removes the new file",
      async (failure) => {
        await mkdir(path.join(root, "13"));
        const old = makePdf("current legacy bytes");
        await writeFile(path.join(root, "13", "cat.pdf"), old);
        const actual =
          await vi.importActual<typeof import("node:fs/promises")>(
            "node:fs/promises",
          );
        vi.mocked(open).mockImplementation(async (...args) => {
          const handle = await actual.open(...args);
          if (args[1] === "wx" && failure === "partial write") {
            const write = handle.writeFile.bind(handle);
            vi.spyOn(handle, "writeFile").mockImplementationOnce(async () => {
              await write(Buffer.from("%PDF-partial"));
              throw new Error("injected ENOSPC after partial write");
            });
          }
          if (
            (args[1] === "wx" && failure === "file sync") ||
            (args[1] === "r" && failure === "directory sync")
          ) {
            vi.spyOn(handle, "sync").mockRejectedValueOnce(
              new Error("injected EIO"),
            );
          }
          return handle;
        });
        await expect(
          saveCatalogPdfFile(13, "cat.pdf", makePdf("replacement")),
        ).rejects.toThrow(/injected/);
        expect(await readCatalogPdfFile("13/cat.pdf")).toEqual(old);
        expect(await readdir(path.join(root, "13"))).toEqual(["cat.pdf"]);
      },
    );

    it("validates before creating any document directory", async () => {
      await expect(
        saveCatalogPdfFile(14, "bad.pdf", Buffer.from("not PDF")),
      ).rejects.toThrow(CatalogPdfStorageError);
      expect(await readdir(root)).toEqual([]);
    });
  });

  describe("readCatalogPdfFile", () => {
    it("still reads the legacy document/filename layout", async () => {
      await mkdir(path.join(root, "15"));
      await writeFile(path.join(root, "15", "old.pdf"), makePdf("legacy"));
      expect(await readCatalogPdfFile("15/old.pdf")).toEqual(makePdf("legacy"));
    });
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

  describe("downloadCatalogPdfFromUrl", () => {
    it("uses the bounded public content client and validates the PDF header", async () => {
      fetchPublicContent.mockResolvedValueOnce({
        status: 200,
        finalUrl: "https://example.com/catalog.pdf",
        contentType: "application/pdf",
        body: makePdf("downloaded"),
      });

      await expect(
        downloadCatalogPdfFromUrl("https://example.com/catalog.pdf"),
      ).resolves.toEqual(makePdf("downloaded"));
      expect(fetchPublicContent).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://example.com/catalog.pdf",
          kind: "pdf",
          timeoutMs: 60_000,
          headers: { Accept: "application/pdf,*/*" },
        }),
      );
    });
  });
});
