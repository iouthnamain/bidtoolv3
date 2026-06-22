import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveExcelResearchDir } from "~/server/services/app-settings";
import { createLogger, traceFn } from "~/server/lib/logger";
const log = createLogger("services-excel-research-storage");

export class ExcelResearchStorageError extends Error {}

export type ExcelResearchStorageKind =
  | "original"
  | "enriched"
  | "pdf"
  | "report";

const ARTIFACT_SUBDIRS: Record<ExcelResearchStorageKind, string> = {
  original: "original",
  enriched: "enriched",
  pdf: "pdfs",
  report: "reports",
};

const MIME_BY_KIND: Record<ExcelResearchStorageKind, string> = {
  original:
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  enriched:
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  report: "application/json",
};

async function storageRoot() {
  const configured = (await resolveExcelResearchDir())?.trim();
  return configured && configured.length > 0
    ? path.resolve(configured)
    : path.join(process.cwd(), "data", "excel-research");
}

async function _excelResearchJobRoot(jobId: string) {
  return path.join(await storageRoot(), jobId);
}

async function artifactDir(jobId: string, kind: ExcelResearchStorageKind) {
  return path.join(await excelResearchJobRoot(jobId), ARTIFACT_SUBDIRS[kind]);
}

function _sanitizeExcelResearchFileName(fileName: string) {
  const base = path.basename(fileName.trim() || "workbook.xlsx");
  const cleaned = base
    .replace(/[^\p{L}\p{N}._\- ]+/gu, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const withName = cleaned.replace(/^\.+/, "") || "workbook";
  return /\.xlsx$/i.test(withName) ? withName : `${withName}.xlsx`;
}

function _sanitizeArtifactFileName(fileName: string, fallback: string) {
  const base = path.basename(fileName.trim() || fallback);
  const cleaned = base
    .replace(/[^\p{L}\p{N}._\- ]+/gu, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned.replace(/^\.+/, "") || fallback;
}

function _decodeExcelResearchBase64(value: string) {
  const base64 = value.includes(",") ? (value.split(",").pop() ?? "") : value;
  const buffer = Buffer.from(base64, "base64");
  if (buffer.byteLength === 0) {
    throw new ExcelResearchStorageError("Không đọc được dữ liệu tệp Excel.");
  }
  return buffer;
}

async function resolveArtifactPath(localFilePath: string) {
  const root = await storageRoot();
  const absolute = path.resolve(root, localFilePath);
  if (!absolute.startsWith(root + path.sep) && absolute !== root) {
    throw new ExcelResearchStorageError("Đường dẫn tệp không hợp lệ.");
  }
  return absolute;
}

export type StoredExcelResearchArtifact = {
  localFilePath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  checksum: string;
};

function defaultFileName(kind: ExcelResearchStorageKind, fileName: string) {
  if (kind === "original" || kind === "enriched") {
    return sanitizeExcelResearchFileName(fileName);
  }
  if (kind === "pdf") {
    return sanitizeArtifactFileName(fileName, "catalog.pdf");
  }
  return sanitizeArtifactFileName(fileName, "report.json");
}

async function _saveExcelResearchFile(
  jobId: string,
  kind: ExcelResearchStorageKind,
  fileName: string,
  buffer: Buffer,
  mimeType?: string,
): Promise<StoredExcelResearchArtifact> {
  const safeFileName = defaultFileName(kind, fileName);
  const relativePath = path.join(jobId, ARTIFACT_SUBDIRS[kind], safeFileName);
  const absoluteDir = await artifactDir(jobId, kind);
  await mkdir(absoluteDir, { recursive: true });
  await writeFile(path.join(absoluteDir, safeFileName), buffer);

  return {
    localFilePath: relativePath,
    fileName: safeFileName,
    fileSize: buffer.byteLength,
    mimeType: mimeType ?? MIME_BY_KIND[kind],
    checksum: createHash("sha256").update(buffer).digest("hex"),
  };
}

async function _readExcelResearchFile(localFilePath: string) {
  return readFile(await resolveArtifactPath(localFilePath));
}

async function _readExcelResearchArtifact(localFilePath: string) {
  return readExcelResearchFile(localFilePath);
}

function _bufferToDataUrl(buffer: Buffer) {
  return `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${buffer.toString("base64")}`;
}

async function _saveOriginalWorkbook(
  jobId: string,
  fileName: string,
  buffer: Buffer,
) {
  return saveExcelResearchFile(jobId, "original", fileName, buffer);
}

async function _saveEnrichedWorkbook(
  jobId: string,
  fileName: string,
  buffer: Buffer,
) {
  return saveExcelResearchFile(jobId, "enriched", fileName, buffer);
}

async function _saveResearchPdf(
  jobId: string,
  fileName: string,
  buffer: Buffer,
) {
  return saveExcelResearchFile(jobId, "pdf", fileName, buffer);
}

async function _saveResearchReport(
  jobId: string,
  fileName: string,
  buffer: Buffer,
  mimeType = "application/json",
) {
  return saveExcelResearchFile(jobId, "report", fileName, buffer, mimeType);
}

async function _deleteExcelResearchJobFiles(jobId: string) {
  const absoluteDir = await excelResearchJobRoot(jobId);
  await rm(absoluteDir, { recursive: true, force: true });
}

export const excelResearchJobRoot = traceFn(log, "excelResearchJobRoot", _excelResearchJobRoot);
export const sanitizeExcelResearchFileName = traceFn(log, "sanitizeExcelResearchFileName", _sanitizeExcelResearchFileName);
export const sanitizeArtifactFileName = traceFn(log, "sanitizeArtifactFileName", _sanitizeArtifactFileName);
export const decodeExcelResearchBase64 = traceFn(log, "decodeExcelResearchBase64", _decodeExcelResearchBase64);
export const saveExcelResearchFile = traceFn(log, "saveExcelResearchFile", _saveExcelResearchFile);
export const readExcelResearchFile = traceFn(log, "readExcelResearchFile", _readExcelResearchFile);
export const readExcelResearchArtifact = traceFn(log, "readExcelResearchArtifact", _readExcelResearchArtifact);
export const bufferToDataUrl = traceFn(log, "bufferToDataUrl", _bufferToDataUrl);
export const saveOriginalWorkbook = traceFn(log, "saveOriginalWorkbook", _saveOriginalWorkbook);
export const saveEnrichedWorkbook = traceFn(log, "saveEnrichedWorkbook", _saveEnrichedWorkbook);
export const saveResearchPdf = traceFn(log, "saveResearchPdf", _saveResearchPdf);
export const saveResearchReport = traceFn(log, "saveResearchReport", _saveResearchReport);
export const deleteExcelResearchJobFiles = traceFn(log, "deleteExcelResearchJobFiles", _deleteExcelResearchJobFiles);
