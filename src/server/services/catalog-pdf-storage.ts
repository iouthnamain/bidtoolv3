import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import { CATALOG_PDF_MAX_FILE_SIZE } from "~/lib/materials/catalog-pdf";
import type { db as appDb } from "~/server/db";
import { materialCatalogDocuments } from "~/server/db/schema";
import { createLogger, traceFn } from "~/server/lib/logger";
import { resolveStorageDirectory } from "~/server/services/data-root";
import {
  fetchPublicContent,
  PUBLIC_CONTENT_PDF_MAX_BYTES,
} from "~/server/services/public-content-client";
const log = createLogger("services-catalog-pdf-storage");

const PDF_MAGIC = "%PDF-";
const DOWNLOAD_TIMEOUT_MS = 60_000;
const VERSION_GRACE_MS = 24 * 60 * 60 * 1000;
const VERSION_FILE = /^version-[0-9a-f-]{36}\.pdf$/;
// A separate advisory-lock namespace; row locks are held only for publication.
const PDF_LOCK_NAMESPACE = 0x504446;

export class CatalogPdfStorageError extends Error {}

function storageRoot() {
  return resolveStorageDirectory(
    "catalog-pdfs",
    process.env.BIDTOOL_CATALOG_PDF_DIR,
  );
}

function _sanitizeCatalogPdfFileName(fileName: string) {
  const base = path.basename(fileName.trim() || "catalog.pdf");
  const cleaned = base
    .replace(/[^\p{L}\p{N}._\- ]+/gu, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const withName = cleaned.replace(/^\.+/, "") || "catalog";
  return /\.pdf$/i.test(withName) ? withName : `${withName}.pdf`;
}

function _assertValidCatalogPdf(buffer: Buffer) {
  if (buffer.byteLength === 0) {
    throw new CatalogPdfStorageError("Tệp PDF rỗng.");
  }
  if (buffer.byteLength > CATALOG_PDF_MAX_FILE_SIZE) {
    throw new CatalogPdfStorageError(
      `Tệp PDF vượt quá giới hạn ${Math.round(CATALOG_PDF_MAX_FILE_SIZE / 1024 / 1024)} MB.`,
    );
  }
  if (buffer.subarray(0, PDF_MAGIC.length).toString("latin1") !== PDF_MAGIC) {
    throw new CatalogPdfStorageError(
      "Tệp không phải PDF hợp lệ (thiếu header %PDF).",
    );
  }
}

export type StoredCatalogPdf = {
  localFilePath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  checksum: string;
};

async function _saveCatalogPdfFile(
  documentId: number,
  fileName: string,
  buffer: Buffer,
): Promise<StoredCatalogPdf> {
  // Initial-document producers attach later without the replacement lock. Keep
  // their files outside the namespace swept by replacement garbage collection.
  return writeCatalogPdfFile(
    documentId,
    fileName,
    buffer,
    `upload-${randomUUID()}.pdf`,
  );
}

async function writeCatalogPdfFile(
  documentId: number,
  fileName: string,
  buffer: Buffer,
  physicalFileName: string,
): Promise<StoredCatalogPdf> {
  assertValidCatalogPdf(buffer);

  const safeFileName = sanitizeCatalogPdfFileName(fileName);
  if (!Number.isSafeInteger(documentId) || documentId <= 0) {
    throw new CatalogPdfStorageError("Mã tài liệu PDF không hợp lệ.");
  }
  const relativePath = path.join(String(documentId), physicalFileName);
  const absoluteDir = path.join(storageRoot(), String(documentId));
  await mkdir(absoluteDir, { recursive: true });
  const absolutePath = path.join(storageRoot(), relativePath);
  const file = await open(absolutePath, "wx");
  try {
    try {
      await file.writeFile(buffer);
      await file.sync();
    } finally {
      await file.close();
    }
    await syncDirectory(absoluteDir);
  } catch (error) {
    await rm(absolutePath, { force: true }).catch((cleanupError: unknown) => {
      log.warn("pdf_partial_file_cleanup_failed", {
        relativePath,
        cleanupError,
      });
    });
    throw error;
  }

  return {
    localFilePath: relativePath,
    fileName: safeFileName,
    fileSize: buffer.byteLength,
    mimeType: "application/pdf",
    checksum: createHash("sha256").update(buffer).digest("hex"),
  };
}

async function syncDirectory(directory: string) {
  // Windows does not support opening directories through this Node API.
  if (process.platform === "win32") return;
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

type PdfDatabase = Pick<typeof appDb, "$client">;
type PdfConnection = ReturnType<typeof drizzle>;

async function withDocumentFileLock<T>(
  database: PdfDatabase,
  documentId: number,
  action: (
    connection: Awaited<ReturnType<PdfDatabase["$client"]["reserve"]>>,
    database: PdfConnection,
  ) => Promise<T>,
) {
  const connection = await database.$client.reserve();
  try {
    await connection`select pg_advisory_lock(${PDF_LOCK_NAMESPACE}, ${documentId})`;
    // ReservedSql omits options at runtime. Drizzle needs the original client's
    // parser metadata, while queries must still use this reserved connection.
    const scoped = drizzle(
      Object.assign(connection, { options: database.$client.options }),
    );
    return await action(connection, scoped);
  } finally {
    try {
      await connection`select pg_advisory_unlock(${PDF_LOCK_NAMESPACE}, ${documentId})`;
    } catch (unlockError) {
      // A disconnected session has already lost its advisory locks. Cleanup
      // failure must not turn an acknowledged publication into a failed save.
      log.warn("pdf_writer_unlock_failed", { documentId, unlockError });
    } finally {
      connection.release();
    }
  }
}

async function removeUnreferencedFile(
  database: PdfConnection,
  filePath: string,
) {
  // Include soft-deleted rows: a retained DB reference still owns its bytes.
  const [reference] = await database
    .select({ id: materialCatalogDocuments.id })
    .from(materialCatalogDocuments)
    .where(eq(materialCatalogDocuments.localFilePath, filePath))
    .limit(1);
  if (reference) return;
  const root = storageRoot();
  const absolute = path.resolve(root, filePath);
  if (!absolute.startsWith(root + path.sep)) {
    throw new CatalogPdfStorageError("Đường dẫn tệp PDF không hợp lệ.");
  }
  await rm(absolute, { force: true });
}

async function cleanupStaleVersions(
  database: PdfConnection,
  documentId: number,
) {
  const directory = path.join(storageRoot(), String(documentId));
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  const cutoff = Date.now() - VERSION_GRACE_MS;
  for (const entry of entries) {
    if (!entry.isFile() || !VERSION_FILE.test(entry.name)) continue;
    const filePath = path.join(String(documentId), entry.name);
    if ((await stat(path.join(directory, entry.name))).mtimeMs >= cutoff)
      continue;
    await removeUnreferencedFile(database, filePath);
  }
}

/** Maintenance shares the writer lock and retains fresh or referenced versions. */
export async function cleanupStaleCatalogPdfVersions(
  database: PdfDatabase,
  documentId: number,
) {
  await withDocumentFileLock(
    database,
    documentId,
    async (_connection, scoped) => {
      await cleanupStaleVersions(scoped, documentId);
    },
  );
}

/** Keep the selected version alive until its bytes are buffered for the reader. */
export async function readPublishedCatalogPdf(
  database: PdfDatabase,
  documentId: number,
) {
  return withDocumentFileLock(
    database,
    documentId,
    async (_connection, scoped) => {
      const [document] = await scoped
        .select()
        .from(materialCatalogDocuments)
        .where(
          and(
            eq(materialCatalogDocuments.id, documentId),
            isNull(materialCatalogDocuments.deletedAt),
          ),
        )
        .limit(1);
      if (!document?.localFilePath) return null;
      try {
        return {
          document,
          file: await readCatalogPdfFile(document.localFilePath),
        };
      } catch (error) {
        if (error instanceof CatalogPdfStorageError) throw error;
        throw new CatalogPdfStorageError("Không đọc được tệp PDF.", {
          cause: error,
        });
      }
    },
  );
}

/** Write first, then publish in a short row-locked transaction on one connection. */
export async function publishCatalogPdfFile(
  database: PdfDatabase,
  documentId: number,
  fileName: string,
  buffer: Buffer,
  source: "reupload" | "download",
) {
  assertValidCatalogPdf(buffer);
  return withDocumentFileLock(
    database,
    documentId,
    async (connection, scoped) => {
      const stored = await writeCatalogPdfFile(
        documentId,
        fileName,
        buffer,
        `version-${randomUUID()}.pdf`,
      );
      let previousPath: string | null = null;
      let updated;
      try {
        // Reserved postgres-js connections have no begin() helper at runtime.
        // Explicit BEGIN/COMMIT keep every statement on this owned connection.
        await connection`begin`;
        const [document] = await scoped
          .select()
          .from(materialCatalogDocuments)
          .where(
            and(
              eq(materialCatalogDocuments.id, documentId),
              isNull(materialCatalogDocuments.deletedAt),
            ),
          )
          .for("update");
        if (!document) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Không tìm thấy tài liệu catalog.",
          });
        }
        previousPath = document.localFilePath;
        [updated] = await scoped
          .update(materialCatalogDocuments)
          .set({
            ...stored,
            sourceType:
              source === "reupload" && document.sourceType === "manual_url"
                ? "uploaded"
                : document.sourceType,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(materialCatalogDocuments.id, documentId))
          .returning();
        if (!updated) throw new Error("Không thể lưu tài liệu catalog.");
        await connection`commit`;
      } catch (error) {
        await connection`rollback`.catch((rollbackError: unknown) => {
          log.warn("pdf_publication_rollback_failed", {
            documentId,
            rollbackError,
          });
        });
        // COMMIT can succeed even when its acknowledgement is lost. If the DB is
        // unreadable, retain the version for later cleanup rather than unlink it.
        await removeUnreferencedFile(scoped, stored.localFilePath).catch(
          (cleanupError: unknown) => {
            log.warn("pdf_abandoned_version_cleanup_failed", {
              documentId,
              cleanupError,
            });
          },
        );
        throw error;
      }
      try {
        if (previousPath) await removeUnreferencedFile(scoped, previousPath);
        // The session lock covers staging through cleanup, including writers
        // paused longer than the grace period. Legacy names are never swept.
        await cleanupStaleVersions(scoped, documentId);
      } catch (cleanupError) {
        log.warn("pdf_previous_version_cleanup_failed", {
          documentId,
          cleanupError,
        });
      }
      return updated;
    },
  );
}

async function _readCatalogPdfFile(localFilePath: string) {
  const root = storageRoot();
  const absolute = path.resolve(root, localFilePath);
  if (!absolute.startsWith(root + path.sep)) {
    throw new CatalogPdfStorageError("Đường dẫn tệp PDF không hợp lệ.");
  }
  return readFile(absolute);
}

async function _deleteCatalogPdfFiles(documentId: number) {
  const absoluteDir = path.join(storageRoot(), String(documentId));
  await rm(absoluteDir, { recursive: true, force: true });
}

function _decodeCatalogPdfBase64(value: string) {
  const base64 = value.includes(",") ? (value.split(",").pop() ?? "") : value;
  const buffer = Buffer.from(base64, "base64");
  if (buffer.byteLength === 0) {
    throw new CatalogPdfStorageError("Không đọc được dữ liệu tệp PDF.");
  }
  return buffer;
}

async function _downloadCatalogPdfFromUrl(url: string): Promise<Buffer> {
  try {
    const response = await fetchPublicContent({
      url,
      kind: "pdf",
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
      maxBytes: CATALOG_PDF_MAX_FILE_SIZE,
      headers: { Accept: "application/pdf,*/*" },
    });
    if (response.body.byteLength > PUBLIC_CONTENT_PDF_MAX_BYTES) {
      throw new CatalogPdfStorageError(
        `Tệp PDF vượt quá giới hạn ${Math.round(PUBLIC_CONTENT_PDF_MAX_BYTES / 1024 / 1024)} MB.`,
      );
    }
    assertValidCatalogPdf(response.body);
    return response.body;
  } catch (error) {
    if (error instanceof CatalogPdfStorageError) throw error;
    if (
      error instanceof Error &&
      /quá thời gian|timeout/i.test(error.message)
    ) {
      throw new CatalogPdfStorageError("Tải PDF quá thời gian cho phép.");
    }
    throw new CatalogPdfStorageError("Không thể tải PDF từ URL nguồn.");
  }
}

export const sanitizeCatalogPdfFileName = traceFn(
  log,
  "sanitizeCatalogPdfFileName",
  _sanitizeCatalogPdfFileName,
);
export const assertValidCatalogPdf = traceFn(
  log,
  "assertValidCatalogPdf",
  _assertValidCatalogPdf,
);
export const saveCatalogPdfFile = traceFn(
  log,
  "saveCatalogPdfFile",
  _saveCatalogPdfFile,
);
export const readCatalogPdfFile = traceFn(
  log,
  "readCatalogPdfFile",
  _readCatalogPdfFile,
);
export const deleteCatalogPdfFiles = traceFn(
  log,
  "deleteCatalogPdfFiles",
  _deleteCatalogPdfFiles,
);
export const decodeCatalogPdfBase64 = traceFn(
  log,
  "decodeCatalogPdfBase64",
  _decodeCatalogPdfBase64,
);
export const downloadCatalogPdfFromUrl = traceFn(
  log,
  "downloadCatalogPdfFromUrl",
  _downloadCatalogPdfFromUrl,
);
