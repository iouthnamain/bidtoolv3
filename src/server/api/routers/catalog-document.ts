import { TRPCError } from "@trpc/server";
import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import {
  catalogPdfFileNameFromUrl,
  normalizeCatalogPdfUrl,
} from "~/lib/materials/catalog-pdf";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import {
  materialCatalogDocumentLinks,
  materialCatalogDocuments,
  materials,
} from "~/server/db/schema";
import {
  countCatalogDocumentLinks,
  findCatalogDocumentByUrl,
  linkCatalogDocumentsToMaterial,
  listCatalogDocumentsForMaterial,
} from "~/server/services/catalog-documents";
import {
  CatalogPdfStorageError,
  decodeCatalogPdfBase64,
  downloadCatalogPdfFromUrl,
  saveCatalogPdfFile,
} from "~/server/services/catalog-pdf-storage";
import type { db as appDb } from "~/server/db";

type AppDb = typeof appDb;

const documentMetadataInput = z.object({
  title: z.string().trim().min(1),
  supplier: z.string().trim().optional(),
  sourceUrl: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  tags: z.array(z.string().trim().min(1)).max(20).optional(),
});

const documentIdInput = z.object({ id: z.number().int().positive() });

function storageErrorToTrpc(error: unknown): never {
  if (error instanceof CatalogPdfStorageError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  throw error;
}

async function getActiveDocumentById(db: AppDb, id: number) {
  const [document] = await db
    .select()
    .from(materialCatalogDocuments)
    .where(
      and(
        eq(materialCatalogDocuments.id, id),
        isNull(materialCatalogDocuments.deletedAt),
      ),
    )
    .limit(1);
  if (!document) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Không tìm thấy tài liệu catalog.",
    });
  }
  return document;
}

async function assertSourceUrlAvailable(
  db: AppDb,
  sourceUrl: string | undefined,
  excludeId?: number,
) {
  const normalized = normalizeCatalogPdfUrl(sourceUrl);
  if (!normalized) {
    return;
  }
  const existing = await findCatalogDocumentByUrl(db, sourceUrl ?? "");
  if (existing && existing.id !== excludeId) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `URL này đã có tài liệu "${existing.title}" (#${existing.id}).`,
    });
  }
}

export const catalogDocumentRouter = createTRPCRouter({
  list: publicProcedure
    .input(
      z.object({
        keyword: z.string().trim().optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const keyword = input.keyword?.trim();
      const conditions = [isNull(materialCatalogDocuments.deletedAt)];
      if (keyword) {
        const pattern = `%${keyword}%`;
        conditions.push(
          or(
            ilike(materialCatalogDocuments.title, pattern),
            ilike(materialCatalogDocuments.supplier, pattern),
            ilike(materialCatalogDocuments.sourceUrl, pattern),
            ilike(materialCatalogDocuments.notes, pattern),
          )!,
        );
      }

      const documents = await ctx.db
        .select()
        .from(materialCatalogDocuments)
        .where(and(...conditions))
        .orderBy(desc(materialCatalogDocuments.updatedAt))
        .limit(input.limit)
        .offset(input.offset);

      const linkCounts = await countCatalogDocumentLinks(
        ctx.db,
        documents.map((document) => document.id),
      );

      return documents.map((document) => ({
        ...document,
        linkedMaterialCount: linkCounts.get(document.id) ?? 0,
      }));
    }),

  getById: publicProcedure.input(documentIdInput).query(async ({ ctx, input }) => {
    const document = await getActiveDocumentById(ctx.db, input.id);
    const linkedMaterials = await ctx.db
      .select({
        id: materials.id,
        code: materials.code,
        name: materials.name,
        unit: materials.unit,
        linkSource: materialCatalogDocumentLinks.linkSource,
        linkedAt: materialCatalogDocumentLinks.createdAt,
      })
      .from(materialCatalogDocumentLinks)
      .innerJoin(
        materials,
        eq(materialCatalogDocumentLinks.materialId, materials.id),
      )
      .where(
        and(
          eq(materialCatalogDocumentLinks.documentId, input.id),
          isNull(materials.deletedAt),
        ),
      )
      .orderBy(materialCatalogDocumentLinks.createdAt);

    return { ...document, linkedMaterials };
  }),

  listByMaterial: publicProcedure
    .input(z.object({ materialId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const rows = await listCatalogDocumentsForMaterial(
        ctx.db,
        input.materialId,
      );
      return rows.map((row) => ({
        ...row.document,
        linkSource: row.linkSource,
        linkedAt: row.linkedAt,
      }));
    }),

  create: publicProcedure
    .input(
      documentMetadataInput.extend({
        materialIds: z.array(z.number().int().positive()).max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertSourceUrlAvailable(ctx.db, input.sourceUrl);
      const now = new Date().toISOString();
      const [document] = await ctx.db
        .insert(materialCatalogDocuments)
        .values({
          title: input.title,
          supplier: input.supplier?.trim() ? input.supplier : null,
          sourceUrl: input.sourceUrl?.trim() ? input.sourceUrl : null,
          normalizedSourceUrl: normalizeCatalogPdfUrl(input.sourceUrl),
          sourceType: "manual_url",
          notes: input.notes ?? "",
          tagsJson: input.tags ?? [],
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!document) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Không thể tạo tài liệu catalog.",
        });
      }

      if (input.materialIds && input.materialIds.length > 0) {
        for (const materialId of input.materialIds) {
          await linkCatalogDocumentsToMaterial(
            ctx.db,
            [document.id],
            materialId,
            "manual",
          );
        }
      }
      return document;
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        patch: documentMetadataInput.partial(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await getActiveDocumentById(ctx.db, input.id);
      if (input.patch.sourceUrl !== undefined) {
        await assertSourceUrlAvailable(ctx.db, input.patch.sourceUrl, input.id);
      }

      const [document] = await ctx.db
        .update(materialCatalogDocuments)
        .set({
          ...(input.patch.title !== undefined
            ? { title: input.patch.title }
            : {}),
          ...(input.patch.supplier !== undefined
            ? { supplier: input.patch.supplier.trim() || null }
            : {}),
          ...(input.patch.sourceUrl !== undefined
            ? {
                sourceUrl: input.patch.sourceUrl.trim() || null,
                normalizedSourceUrl: normalizeCatalogPdfUrl(
                  input.patch.sourceUrl,
                ),
              }
            : {}),
          ...(input.patch.notes !== undefined
            ? { notes: input.patch.notes }
            : {}),
          ...(input.patch.tags !== undefined
            ? { tagsJson: input.patch.tags }
            : {}),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(materialCatalogDocuments.id, input.id))
        .returning();
      return document;
    }),

  delete: publicProcedure
    .input(documentIdInput)
    .mutation(async ({ ctx, input }) => {
      await getActiveDocumentById(ctx.db, input.id);
      const now = new Date().toISOString();
      await ctx.db
        .update(materialCatalogDocuments)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(materialCatalogDocuments.id, input.id));
      await ctx.db
        .delete(materialCatalogDocumentLinks)
        .where(eq(materialCatalogDocumentLinks.documentId, input.id));
      return { id: input.id };
    }),

  uploadPdf: publicProcedure
    .input(
      documentMetadataInput.extend({
        fileName: z.string().trim().min(1),
        fileBase64: z.string().min(1),
        materialIds: z.array(z.number().int().positive()).max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertSourceUrlAvailable(ctx.db, input.sourceUrl);

      let buffer: Buffer;
      try {
        buffer = decodeCatalogPdfBase64(input.fileBase64);
      } catch (error) {
        storageErrorToTrpc(error);
      }

      const now = new Date().toISOString();
      const [document] = await ctx.db
        .insert(materialCatalogDocuments)
        .values({
          title: input.title,
          supplier: input.supplier?.trim() ? input.supplier : null,
          sourceUrl: input.sourceUrl?.trim() ? input.sourceUrl : null,
          normalizedSourceUrl: normalizeCatalogPdfUrl(input.sourceUrl),
          sourceType: "uploaded",
          notes: input.notes ?? "",
          tagsJson: input.tags ?? [],
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!document) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Không thể tạo tài liệu catalog.",
        });
      }

      let stored;
      try {
        stored = await saveCatalogPdfFile(document.id, input.fileName, buffer);
      } catch (error) {
        await ctx.db
          .delete(materialCatalogDocuments)
          .where(eq(materialCatalogDocuments.id, document.id));
        storageErrorToTrpc(error);
      }

      const [updated] = await ctx.db
        .update(materialCatalogDocuments)
        .set({
          localFilePath: stored.localFilePath,
          fileName: stored.fileName,
          fileSize: stored.fileSize,
          mimeType: stored.mimeType,
          checksum: stored.checksum,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(materialCatalogDocuments.id, document.id))
        .returning();

      if (input.materialIds && input.materialIds.length > 0) {
        for (const materialId of input.materialIds) {
          await linkCatalogDocumentsToMaterial(
            ctx.db,
            [document.id],
            materialId,
            "manual",
          );
        }
      }
      return updated ?? document;
    }),

  downloadToLocal: publicProcedure
    .input(documentIdInput)
    .mutation(async ({ ctx, input }) => {
      const document = await getActiveDocumentById(ctx.db, input.id);
      const sourceUrl = document.sourceUrl?.trim();
      if (!sourceUrl) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Tài liệu không có URL nguồn để tải.",
        });
      }

      let stored;
      try {
        const buffer = await downloadCatalogPdfFromUrl(sourceUrl);
        stored = await saveCatalogPdfFile(
          document.id,
          document.fileName ?? catalogPdfFileNameFromUrl(sourceUrl),
          buffer,
        );
      } catch (error) {
        storageErrorToTrpc(error);
      }

      const [updated] = await ctx.db
        .update(materialCatalogDocuments)
        .set({
          localFilePath: stored.localFilePath,
          fileName: stored.fileName,
          fileSize: stored.fileSize,
          mimeType: stored.mimeType,
          checksum: stored.checksum,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(materialCatalogDocuments.id, document.id))
        .returning();
      return updated;
    }),

  attachToMaterials: publicProcedure
    .input(
      z.object({
        documentId: z.number().int().positive(),
        materialIds: z.array(z.number().int().positive()).min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await getActiveDocumentById(ctx.db, input.documentId);
      const activeMaterials = await ctx.db
        .select({ id: materials.id })
        .from(materials)
        .where(
          and(
            inArray(materials.id, input.materialIds),
            isNull(materials.deletedAt),
          ),
        );

      let linked = 0;
      for (const material of activeMaterials) {
        linked += await linkCatalogDocumentsToMaterial(
          ctx.db,
          [input.documentId],
          material.id,
          "manual",
        );
      }
      return { linked, requested: input.materialIds.length };
    }),

  detachFromMaterial: publicProcedure
    .input(
      z.object({
        documentId: z.number().int().positive(),
        materialId: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(materialCatalogDocumentLinks)
        .where(
          and(
            eq(materialCatalogDocumentLinks.documentId, input.documentId),
            eq(materialCatalogDocumentLinks.materialId, input.materialId),
          ),
        );
      return { documentId: input.documentId, materialId: input.materialId };
    }),

  summary: publicProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select({
        total: sql<number>`count(*)::int`,
        withLocalFile: sql<number>`count(*) filter (where ${materialCatalogDocuments.localFilePath} is not null)::int`,
      })
      .from(materialCatalogDocuments)
      .where(isNull(materialCatalogDocuments.deletedAt));
    return { total: row?.total ?? 0, withLocalFile: row?.withLocalFile ?? 0 };
  }),
});
