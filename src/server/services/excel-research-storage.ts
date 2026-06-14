import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

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

function storageRoot() {
  const configured = process.env.BIDTOOL_EXCEL_RESEARCH_DIR?.trim();
  return configured && configured.length > 0
    ? path.resolve(configured)
    : path.join(process.cwd(), "data", "excel-research");
}

export function excelResearchJobRoot(jobId: string) {
  return path.join(storageRoot(), jobId);
}

function artifactDir(jobId: string, kind: ExcelResearchStorageKind) {
  return path.join(excelResearchJobRoot(jobId), ARTIFACT_SUBDIRS[kind]);
}

export function sanitizeExcelResearchFileName(fileName: string) {
  const base = path.basename(fileName.trim() || "workbook.xlsx");
  const cleaned = base
    .replace(/[^\p{L}\p{N}._\- ]+/gu, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const withName = cleaned.replace(/^\.+/, "") || "workbook";
  return /\.xlsx$/i.test(withName) ? withName : `${withName}.xlsx`;
}

export function sanitizeArtifactFileName(fileName: string, fallback: string) {
  const base = path.basename(fileName.trim() || fallback);
  const cleaned = base
    .replace(/[^\p{L}\p{N}._\- ]+/gu, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned.replace(/^\.+/, "") || fallback;
}

export function decodeExcelResearchBase64(value: string) {
  const base64 = value.includes(",") ? (value.split(",").pop() ?? "") : value;
  const buffer = Buffer.from(base64, "base64");
  if (buffer.byteLength === 0) {
    throw new ExcelResearchStorageError("Không đọc được dữ liệu tệp Excel.");
  }
  return buffer;
}

function resolveArtifactPath(localFilePath: string) {
  const root = storageRoot();
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

export async function saveExcelResearchFile(
  jobId: string,
  kind: ExcelResearchStorageKind,
  fileName: string,
  buffer: Buffer,
  mimeType?: string,
): Promise<StoredExcelResearchArtifact> {
  const safeFileName = defaultFileName(kind, fileName);
  const relativePath = path.join(jobId, ARTIFACT_SUBDIRS[kind], safeFileName);
  const absoluteDir = artifactDir(jobId, kind);
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

export async function readExcelResearchFile(localFilePath: string) {
  return readFile(resolveArtifactPath(localFilePath));
}

export async function readExcelResearchArtifact(localFilePath: string) {
  return readExcelResearchFile(localFilePath);
}

export function bufferToDataUrl(buffer: Buffer) {
  return `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${buffer.toString("base64")}`;
}

export async function saveOriginalWorkbook(
  jobId: string,
  fileName: string,
  buffer: Buffer,
) {
  return saveExcelResearchFile(jobId, "original", fileName, buffer);
}

export async function saveEnrichedWorkbook(
  jobId: string,
  fileName: string,
  buffer: Buffer,
) {
  return saveExcelResearchFile(jobId, "enriched", fileName, buffer);
}

export async function saveResearchPdf(
  jobId: string,
  fileName: string,
  buffer: Buffer,
) {
  return saveExcelResearchFile(jobId, "pdf", fileName, buffer);
}

export async function saveResearchReport(
  jobId: string,
  fileName: string,
  buffer: Buffer,
  mimeType = "application/json",
) {
  return saveExcelResearchFile(jobId, "report", fileName, buffer, mimeType);
}

export async function deleteExcelResearchJobFiles(jobId: string) {
  const absoluteDir = excelResearchJobRoot(jobId);
  await rm(absoluteDir, { recursive: true, force: true });
}
