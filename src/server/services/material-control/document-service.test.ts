import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __documentServiceInternals,
  deleteMaterialControlDocumentFile,
  MATERIAL_CONTROL_MAX_FILE_SIZE,
  readMaterialControlDocumentFile,
  storeMaterialControlDocumentFile,
} from "~/server/services/material-control/document-service";

const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("material-control document storage", () => {
  it("sanitizes names and creates project-scoped relative paths", () => {
    expect(
      __documentServiceInternals.safeFileName("../../Phiếu giao.pdf"),
    ).toBe("Phiếu giao.pdf");
    expect(__documentServiceInternals.safeFileName("C:\\temp\\a.txt")).toBe(
      "a.txt",
    );
    expect(
      __documentServiceInternals.relativeFilePath(
        12,
        "attachment-key",
        "a.txt",
      ),
    ).toBe("projects/12/attachments/attachment-key/a.txt");
  });

  it("rejects traversal and invalid base64 before touching disk", () => {
    expect(() =>
      __documentServiceInternals.absolutePath("../../outside.txt"),
    ).toThrow("Đường dẫn tệp không hợp lệ");
    expect(() =>
      __documentServiceInternals.decodeBase64("not base64!"),
    ).toThrow("Không đọc được dữ liệu tệp");
  });

  it("publishes, reads, and deletes a file under the configured root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "material-control-doc-"));
    roots.push(root);
    vi.stubEnv("BIDTOOL_MATERIAL_CONTROL_DIR", root);
    const relativePath = "projects/7/attachments/key/receipt.txt";
    const bytes = Buffer.from("delivery-note");

    await storeMaterialControlDocumentFile(relativePath, bytes);
    await expect(
      readMaterialControlDocumentFile(relativePath),
    ).resolves.toEqual(bytes);
    await expect(readFile(path.join(root, relativePath), "utf8")).resolves.toBe(
      "delivery-note",
    );

    await deleteMaterialControlDocumentFile(relativePath);
    await expect(
      readMaterialControlDocumentFile(relativePath),
    ).rejects.toThrow();
  });

  it("enforces the file size limit in the storage boundary", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "material-control-doc-"));
    roots.push(root);
    vi.stubEnv("BIDTOOL_MATERIAL_CONTROL_DIR", root);
    await expect(
      storeMaterialControlDocumentFile(
        "projects/1/attachments/key/large.bin",
        Buffer.alloc(MATERIAL_CONTROL_MAX_FILE_SIZE + 1),
      ),
    ).rejects.toThrow("Tệp vượt quá giới hạn");
  });
});
