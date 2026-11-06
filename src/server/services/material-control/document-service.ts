import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq } from "drizzle-orm";

import {
  materialControlDocuments,
  materialControlProjects,
} from "~/server/db/schema";
import type { db as appDb } from "~/server/db";
import { resolveStorageDirectory } from "~/server/services/data-root";

type AppDb = typeof appDb;

export const MATERIAL_CONTROL_MAX_FILE_SIZE = 50 * 1024 * 1024;

export const materialControlDocumentCategories = [
  "general",
  "requirement",
  "purchase",
  "shipment",
  "installation",
  "export",
] as const;

export type MaterialControlDocumentCategory =
  (typeof materialControlDocumentCategories)[number];

export class MaterialControlDocumentError extends TRPCError {
  constructor(
    code: "BAD_REQUEST" | "NOT_FOUND" | "CONFLICT" | "INTERNAL_SERVER_ERROR",
    message: string,
  ) {
    super({ code, message });
    this.name = "MaterialControlDocumentError";
  }
}

type DocumentRow = typeof materialControlDocuments.$inferSelect;

export type MaterialControlDocumentView = Readonly<{
  id: number;
  projectId: number;
  category: MaterialControlDocumentCategory;
  fileName: string;
  originalFileName: string;
  relativePath: string;
  mimeType: string;
  fileSize: number;
  checksum: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}>;

export type UploadMaterialControlDocumentInput = Readonly<{
  projectId: number;
  category?: MaterialControlDocumentCategory;
  fileName: string;
  fileBase64: string;
  mimeType?: string;
  notes?: string;
}>;

function storageRoot() {
  return resolveStorageDirectory(
    "material-control",
    process.env.BIDTOOL_MATERIAL_CONTROL_DIR,
  );
}

function safeFileName(fileName: string) {
  const base = path.basename(
    fileName.replaceAll("\\", "/").trim() || "document",
  );
  const cleaned = base
    .replace(/[^\p{L}\p{N}._\- ]+/gu, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned.replace(/^\.+/, "") || "document";
}

function decodeBase64(value: string) {
  const payload = value.includes(",") ? (value.split(",").pop() ?? "") : value;
  const normalized = payload.trim();
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new MaterialControlDocumentError(
      "BAD_REQUEST",
      "Không đọc được dữ liệu tệp.",
    );
  }
  const buffer = Buffer.from(normalized, "base64");
  if (buffer.byteLength === 0) {
    throw new MaterialControlDocumentError(
      "BAD_REQUEST",
      "Tệp tải lên không được để trống.",
    );
  }
  if (buffer.byteLength > MATERIAL_CONTROL_MAX_FILE_SIZE) {
    throw new MaterialControlDocumentError(
      "BAD_REQUEST",
      `Tệp vượt quá giới hạn ${Math.round(MATERIAL_CONTROL_MAX_FILE_SIZE / 1024 / 1024)} MB.`,
    );
  }
  return buffer;
}

function normalizeMimeType(value: string | undefined) {
  const mimeType = value?.trim().toLowerCase();
  if (
    !mimeType ||
    !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(mimeType)
  ) {
    return "application/octet-stream";
  }
  return mimeType;
}

function relativeFilePath(
  projectId: number,
  fileKey: string,
  fileName: string,
) {
  return path.posix.join(String(projectId), "attachments", fileKey, fileName);
}

function absolutePath(relativePath: string) {
  const root = path.resolve(storageRoot());
  const absolute = path.resolve(root, relativePath);
  if (!absolute.startsWith(`${root}${path.sep}`)) {
    throw new MaterialControlDocumentError(
      "BAD_REQUEST",
      "Đường dẫn tệp không hợp lệ.",
    );
  }
  return absolute;
}

export async function storeMaterialControlDocumentFile(
  relativePath: string,
  buffer: Buffer,
) {
  if (buffer.byteLength > MATERIAL_CONTROL_MAX_FILE_SIZE) {
    throw new MaterialControlDocumentError(
      "BAD_REQUEST",
      `Tệp vượt quá giới hạn ${Math.round(MATERIAL_CONTROL_MAX_FILE_SIZE / 1024 / 1024)} MB.`,
    );
  }
  const absolute = absolutePath(relativePath);
  const directory = path.dirname(absolute);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.upload-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, buffer, { flag: "wx" });
    await rename(temporary, absolute);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function readMaterialControlDocumentFile(relativePath: string) {
  return readFile(absolutePath(relativePath));
}

export async function deleteMaterialControlDocumentFile(relativePath: string) {
  await rm(absolutePath(relativePath), { force: true });
}

function documentView(row: DocumentRow): MaterialControlDocumentView {
  return {
    id: row.id,
    projectId: row.projectId,
    category: row.category,
    fileName: row.fileName,
    originalFileName: row.originalFileName,
    relativePath: row.relativePath,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    checksum: row.checksum,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function assertProject(database: AppDb, projectId: number) {
  const [project] = await database
    .select({ id: materialControlProjects.id })
    .from(materialControlProjects)
    .where(eq(materialControlProjects.id, projectId))
    .limit(1);
  if (!project) {
    throw new MaterialControlDocumentError(
      "NOT_FOUND",
      "Không tìm thấy dự án vật tư.",
    );
  }
}

async function documentById(database: AppDb, id: number) {
  const [document] = await database
    .select()
    .from(materialControlDocuments)
    .where(eq(materialControlDocuments.id, id))
    .limit(1);
  if (!document) {
    throw new MaterialControlDocumentError(
      "NOT_FOUND",
      "Không tìm thấy tài liệu dự án.",
    );
  }
  return document;
}

export async function uploadMaterialControlDocument(
  input: UploadMaterialControlDocumentInput,
  database: AppDb,
) {
  await assertProject(database, input.projectId);
  const originalFileName = input.fileName.trim();
  if (!originalFileName) {
    throw new MaterialControlDocumentError(
      "BAD_REQUEST",
      "Tên tệp không được để trống.",
    );
  }
  const buffer = decodeBase64(input.fileBase64);
  const fileName = safeFileName(originalFileName);
  const fileKey = randomUUID();
  const relativePath = relativeFilePath(input.projectId, fileKey, fileName);
  const now = new Date().toISOString();
  await storeMaterialControlDocumentFile(relativePath, buffer);

  try {
    const [row] = await database
      .insert(materialControlDocuments)
      .values({
        projectId: input.projectId,
        category: input.category ?? "general",
        fileName,
        originalFileName,
        relativePath,
        mimeType: normalizeMimeType(input.mimeType),
        fileSize: buffer.byteLength,
        checksum: createHash("sha256").update(buffer).digest("hex"),
        notes: input.notes?.trim() ?? "",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) {
      throw new MaterialControlDocumentError(
        "INTERNAL_SERVER_ERROR",
        "Không thể lưu tài liệu dự án.",
      );
    }
    return documentView(row);
  } catch (error) {
    await deleteMaterialControlDocumentFile(relativePath).catch(
      () => undefined,
    );
    throw error;
  }
}

export async function listMaterialControlDocuments(
  input: { projectId: number; category?: MaterialControlDocumentCategory },
  database: AppDb,
) {
  await assertProject(database, input.projectId);
  const rows = await database
    .select()
    .from(materialControlDocuments)
    .where(
      and(
        eq(materialControlDocuments.projectId, input.projectId),
        input.category
          ? eq(materialControlDocuments.category, input.category)
          : undefined,
      ),
    )
    .orderBy(
      desc(materialControlDocuments.createdAt),
      asc(materialControlDocuments.id),
    );
  return rows.map(documentView);
}

export async function getMaterialControlDocument(id: number, database: AppDb) {
  return documentView(await documentById(database, id));
}

export async function readMaterialControlDocument(id: number, database: AppDb) {
  const document = await documentById(database, id);
  const buffer = await readMaterialControlDocumentFile(
    document.relativePath,
  ).catch(() => {
    throw new MaterialControlDocumentError(
      "NOT_FOUND",
      "Không tìm thấy tệp tài liệu trên ổ đĩa.",
    );
  });
  return {
    document: documentView(document),
    contentBase64: buffer.toString("base64"),
  };
}

export async function deleteMaterialControlDocument(
  id: number,
  database: AppDb,
) {
  const document = await documentById(database, id);
  await database
    .delete(materialControlDocuments)
    .where(eq(materialControlDocuments.id, id));
  await deleteMaterialControlDocumentFile(document.relativePath).catch(
    () => undefined,
  );
  return { id };
}

export const __documentServiceInternals = {
  decodeBase64,
  safeFileName,
  normalizeMimeType,
  relativeFilePath,
  absolutePath,
  storageRoot,
};
