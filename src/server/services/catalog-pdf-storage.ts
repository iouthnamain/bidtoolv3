import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { CATALOG_PDF_MAX_FILE_SIZE } from "~/lib/materials/catalog-pdf";
import { createLogger, traceFn } from "~/server/lib/logger";
const log = createLogger("services-catalog-pdf-storage");

const PDF_MAGIC = "%PDF-";
const DOWNLOAD_TIMEOUT_MS = 60_000;

export class CatalogPdfStorageError extends Error {}

function storageRoot() {
  const configured = process.env.BIDTOOL_CATALOG_PDF_DIR?.trim();
  return configured && configured.length > 0
    ? path.resolve(configured)
    : path.join(process.cwd(), "data", "catalog-pdfs");
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
  assertValidCatalogPdf(buffer);

  const safeFileName = sanitizeCatalogPdfFileName(fileName);
  const relativePath = path.join(String(documentId), safeFileName);
  const absoluteDir = path.join(storageRoot(), String(documentId));
  await mkdir(absoluteDir, { recursive: true });
  await writeFile(path.join(absoluteDir, safeFileName), buffer);

  return {
    localFilePath: relativePath,
    fileName: safeFileName,
    fileSize: buffer.byteLength,
    mimeType: "application/pdf",
    checksum: createHash("sha256").update(buffer).digest("hex"),
  };
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
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new CatalogPdfStorageError("URL tài liệu không hợp lệ.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new CatalogPdfStorageError("Chỉ hỗ trợ tải PDF qua http/https.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(parsed, {
      signal: controller.signal,
      redirect: "follow",
      headers: { Accept: "application/pdf,*/*" },
    });
  } catch (error) {
    throw new CatalogPdfStorageError(
      error instanceof Error && error.name === "AbortError"
        ? "Tải PDF quá thời gian cho phép."
        : "Không thể tải PDF từ URL nguồn.",
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new CatalogPdfStorageError(
      `Nguồn trả về lỗi HTTP ${response.status}.`,
    );
  }

  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > CATALOG_PDF_MAX_FILE_SIZE) {
    throw new CatalogPdfStorageError(
      `Tệp PDF vượt quá giới hạn ${Math.round(CATALOG_PDF_MAX_FILE_SIZE / 1024 / 1024)} MB.`,
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  assertValidCatalogPdf(buffer);
  return buffer;
}

export const sanitizeCatalogPdfFileName = traceFn(log, "sanitizeCatalogPdfFileName", _sanitizeCatalogPdfFileName);
export const assertValidCatalogPdf = traceFn(log, "assertValidCatalogPdf", _assertValidCatalogPdf);
export const saveCatalogPdfFile = traceFn(log, "saveCatalogPdfFile", _saveCatalogPdfFile);
export const readCatalogPdfFile = traceFn(log, "readCatalogPdfFile", _readCatalogPdfFile);
export const deleteCatalogPdfFiles = traceFn(log, "deleteCatalogPdfFiles", _deleteCatalogPdfFiles);
export const decodeCatalogPdfBase64 = traceFn(log, "decodeCatalogPdfBase64", _decodeCatalogPdfBase64);
export const downloadCatalogPdfFromUrl = traceFn(log, "downloadCatalogPdfFromUrl", _downloadCatalogPdfFromUrl);
