import { and, eq, inArray, isNull } from "drizzle-orm";

import {
  catalogDocumentTitleFromUrl,
  normalizeCatalogPdfUrl,
  type CatalogDocumentLinkSource,
  type CatalogDocumentSourceType,
} from "~/lib/materials/catalog-pdf";
import type { db as appDb } from "~/server/db";
import {
  materialCatalogDocumentLinks,
  materialCatalogDocuments,
} from "~/server/db/schema";
import { saveCatalogPdfFile } from "~/server/services/catalog-pdf-storage";

type AppDb = typeof appDb;

export type CatalogDocumentRow =
  typeof materialCatalogDocuments.$inferSelect;

export async function findCatalogDocumentByUrl(db: AppDb, url: string) {
  const normalized = normalizeCatalogPdfUrl(url);
  if (!normalized) {
    return null;
  }
  const [existing] = await db
    .select()
    .from(materialCatalogDocuments)
    .where(
      and(
        eq(materialCatalogDocuments.normalizedSourceUrl, normalized),
        isNull(materialCatalogDocuments.deletedAt),
      ),
    )
    .limit(1);
  return existing ?? null;
}

export async function getOrCreateCatalogDocumentByUrl(
  db: AppDb,
  url: string,
  options: {
    sourceType: CatalogDocumentSourceType;
    title?: string;
    supplier?: string | null;
    notes?: string;
  },
): Promise<{ document: CatalogDocumentRow; created: boolean }> {
  const trimmedUrl = url.trim();
  const existing = await findCatalogDocumentByUrl(db, trimmedUrl);
  if (existing) {
    return { document: existing, created: false };
  }

  const now = new Date().toISOString();
  const trimmedTitle = options.title?.trim();
  let title = catalogDocumentTitleFromUrl(trimmedUrl, "Catalog PDF");
  if (trimmedTitle) {
    title = trimmedTitle;
  }

  const [row] = await db
    .insert(materialCatalogDocuments)
    .values({
      title,
      supplier: options.supplier?.trim() ? options.supplier : null,
      sourceUrl: trimmedUrl,
      normalizedSourceUrl: normalizeCatalogPdfUrl(trimmedUrl),
      sourceType: options.sourceType,
      notes: options.notes ?? "",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!row) {
    throw new Error("Không thể tạo tài liệu catalog.");
  }
  return { document: row, created: true };
}

/** Idempotently link documents to a material. Returns number of new links. */
export async function linkCatalogDocumentsToMaterial(
  db: AppDb,
  documentIds: number[],
  materialId: number,
  linkSource: CatalogDocumentLinkSource,
) {
  if (documentIds.length === 0) {
    return 0;
  }
  const now = new Date().toISOString();
  const rows = await db
    .insert(materialCatalogDocumentLinks)
    .values(
      documentIds.map((documentId) => ({
        documentId,
        materialId,
        linkSource,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: materialCatalogDocumentLinks.id });
  return rows.length;
}

/**
 * Create-or-reuse documents for a list of PDF URLs and link them to a
 * material. Used by scrape import and CSV/XLSX import.
 */
export async function attachCatalogPdfUrlsToMaterial(
  db: AppDb,
  urls: string[],
  materialId: number,
  options: {
    sourceType: CatalogDocumentSourceType;
    linkSource: CatalogDocumentLinkSource;
    fallbackTitle?: string;
    supplier?: string | null;
  },
) {
  const documentIds: number[] = [];
  let createdDocuments = 0;
  for (const url of urls) {
    const normalized = normalizeCatalogPdfUrl(url);
    if (!normalized) {
      continue;
    }
    const { document, created } = await getOrCreateCatalogDocumentByUrl(
      db,
      url,
      {
        sourceType: options.sourceType,
        title: catalogDocumentTitleFromUrl(
          url,
          options.fallbackTitle ?? "Catalog PDF",
        ),
        supplier: options.supplier ?? null,
      },
    );
    documentIds.push(document.id);
    if (created) {
      createdDocuments += 1;
    }
  }

  const linked = await linkCatalogDocumentsToMaterial(
    db,
    documentIds,
    materialId,
    options.linkSource,
  );
  return { documentIds, createdDocuments, linked };
}

export async function listCatalogDocumentsForMaterial(
  db: AppDb,
  materialId: number,
) {
  return db
    .select({
      document: materialCatalogDocuments,
      linkSource: materialCatalogDocumentLinks.linkSource,
      linkedAt: materialCatalogDocumentLinks.createdAt,
    })
    .from(materialCatalogDocumentLinks)
    .innerJoin(
      materialCatalogDocuments,
      eq(materialCatalogDocumentLinks.documentId, materialCatalogDocuments.id),
    )
    .where(
      and(
        eq(materialCatalogDocumentLinks.materialId, materialId),
        isNull(materialCatalogDocuments.deletedAt),
      ),
    )
    .orderBy(materialCatalogDocumentLinks.createdAt);
}

export async function countCatalogDocumentLinks(
  db: AppDb,
  documentIds: number[],
) {
  if (documentIds.length === 0) {
    return new Map<number, number>();
  }
  const rows = await db
    .select({
      documentId: materialCatalogDocumentLinks.documentId,
      materialId: materialCatalogDocumentLinks.materialId,
    })
    .from(materialCatalogDocumentLinks)
    .where(inArray(materialCatalogDocumentLinks.documentId, documentIds));

  const counts = new Map<number, number>();
  for (const row of rows) {
    counts.set(row.documentId, (counts.get(row.documentId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Create a catalog document backed by a locally-stored file (no source URL) and
 * link it to a material. Unlike the URL helpers, this is for bytes we produced
 * ourselves (e.g. a generated catalog PDF): it inserts the row, writes the file
 * to disk via {@link saveCatalogPdfFile}, backfills the file columns, then links
 * it. `normalizedSourceUrl` stays "" so the row is excluded from the URL dedupe
 * index. Returns the created document id.
 */
export async function createLocalCatalogDocument(
  db: AppDb,
  input: {
    materialId: number;
    title: string;
    fileName: string;
    buffer: Buffer;
    sourceType?: CatalogDocumentSourceType;
    linkSource?: CatalogDocumentLinkSource;
    supplier?: string | null;
    notes?: string;
  },
): Promise<number> {
  const now = new Date().toISOString();
  const [row] = await db
    .insert(materialCatalogDocuments)
    .values({
      title: input.title.trim() || "Catalog PDF",
      supplier: input.supplier?.trim() ? input.supplier : null,
      sourceUrl: null,
      normalizedSourceUrl: "",
      sourceType: input.sourceType ?? "generated",
      notes: input.notes ?? "",
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: materialCatalogDocuments.id });

  if (!row) {
    throw new Error("Không thể tạo tài liệu catalog.");
  }

  const stored = await saveCatalogPdfFile(row.id, input.fileName, input.buffer);
  await db
    .update(materialCatalogDocuments)
    .set({
      localFilePath: stored.localFilePath,
      fileName: stored.fileName,
      fileSize: stored.fileSize,
      mimeType: stored.mimeType,
      checksum: stored.checksum,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(materialCatalogDocuments.id, row.id));

  await linkCatalogDocumentsToMaterial(
    db,
    [row.id],
    input.materialId,
    input.linkSource ?? "manual",
  );

  return row.id;
}
