import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { type db as appDb } from "~/server/db";
import {
  excelWorkspaceEvents,
  excelWorkspaceItems,
  excelWorkspaces,
  webProductCandidates,
} from "~/server/db/schema";
import {
  buildEnrichedWorkbookBase64,
  columnKeys,
  parseWorkbookBase64,
  rowsFromMapping,
  type ColumnMapping,
  type ParsedWorkbook,
} from "~/server/services/excel-workbook";
import {
  searchProductCandidates,
  type ExtractedProductSpec,
} from "~/server/services/product-web-search";

type AppDb = typeof appDb;
type DbExecutor = Pick<AppDb, "select" | "insert" | "update" | "delete">;

const statusSchema = z.enum([
  "draft",
  "imported",
  "mapped",
  "reviewed",
  "matched",
  "exported",
  "catalog_generated",
  "checked",
  "approved",
]);

const mappingSchema = z
  .object(
    Object.fromEntries(
      columnKeys.map((key) => [key, z.string().min(1).nullable().optional()]),
    ) as Record<
      (typeof columnKeys)[number],
      z.ZodOptional<z.ZodNullable<z.ZodString>>
    >,
  )
  .partial();

const rowPatchSchema = z.object({
  productName: z.string().min(1).optional(),
  specText: z.string().optional(),
  unit: z.string().optional(),
  quantity: z.number().nonnegative().nullable().optional(),
  targetPrice: z.number().nonnegative().nullable().optional(),
  currency: z.string().min(1).optional(),
  vendorHint: z.string().nullable().optional(),
  originHint: z.string().nullable().optional(),
  notes: z.string().optional(),
  searchKeywords: z.array(z.string()).optional(),
});

const specSchema = z.object({
  productName: z.string().min(1),
  brand: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  specSummary: z.string().default(""),
  unit: z.string().nullable().optional(),
  priceText: z.string().nullable().optional(),
  priceVnd: z.number().nullable().optional(),
  originCountry: z.string().nullable().optional(),
  vendorName: z.string().nullable().optional(),
  vendorDomain: z.string().default("manual"),
  sourceUrl: z.string().url(),
  imageUrl: z.string().url().nullable().optional(),
  evidenceText: z.string().default(""),
});

function parseWorkbookJson(value: Record<string, unknown>): ParsedWorkbook {
  if (!Array.isArray(value.sheets)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Không gian làm việc chưa có tệp Excel đã nhập.",
    });
  }

  return value as ParsedWorkbook;
}

async function getWorkspaceOrThrow(db: DbExecutor, id: number) {
  const [workspace] = await db
    .select()
    .from(excelWorkspaces)
    .where(eq(excelWorkspaces.id, id))
    .limit(1);

  if (!workspace) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Không tìm thấy không gian làm việc.",
    });
  }

  return workspace;
}

async function assertWorkspaceEditable(db: DbExecutor, id: number) {
  const workspace = await getWorkspaceOrThrow(db, id);
  if (workspace.status === "exported" || workspace.status === "approved") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Không gian làm việc đã xuất hoặc duyệt, không thể sửa trực tiếp.",
    });
  }
  return workspace;
}

async function getRowWithWorkspace(db: DbExecutor, id: number) {
  const [row] = await db
    .select({
      item: excelWorkspaceItems,
      workspace: excelWorkspaces,
    })
    .from(excelWorkspaceItems)
    .innerJoin(
      excelWorkspaces,
      eq(excelWorkspaceItems.workspaceId, excelWorkspaces.id),
    )
    .where(eq(excelWorkspaceItems.id, id))
    .limit(1);

  if (!row) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Không tìm thấy dòng sản phẩm.",
    });
  }

  if (
    row.workspace.status === "exported" ||
    row.workspace.status === "approved"
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Không gian làm việc đã xuất hoặc duyệt, không thể sửa trực tiếp.",
    });
  }

  return row;
}

async function writeEvent(
  db: DbExecutor,
  workspaceId: number,
  event: string,
  payload: Record<string, unknown> = {},
) {
  await db.insert(excelWorkspaceEvents).values({
    workspaceId,
    event,
    actor: "system",
    payloadJson: payload,
    at: new Date().toISOString(),
  });
}

async function refreshWorkspaceMatchedStatus(
  db: DbExecutor,
  workspaceId: number,
) {
  const [summary] = await db
    .select({
      total: sql<number>`count(*)`,
      open: sql<number>`count(*) filter (where ${excelWorkspaceItems.matchStatus} in ('unmatched', 'candidates_found'))`,
    })
    .from(excelWorkspaceItems)
    .where(eq(excelWorkspaceItems.workspaceId, workspaceId));

  if (Number(summary?.total ?? 0) > 0 && Number(summary?.open ?? 0) === 0) {
    await db
      .update(excelWorkspaces)
      .set({ status: "matched", updatedAt: new Date().toISOString() })
      .where(eq(excelWorkspaces.id, workspaceId));
  }
}

export const excelWorkspaceRouter = createTRPCRouter({
  listWorkspaces: publicProcedure
    .input(
      z
        .object({
          status: statusSchema.optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(excelWorkspaces)
        .where(
          input?.status ? eq(excelWorkspaces.status, input.status) : undefined,
        )
        .orderBy(desc(excelWorkspaces.updatedAt));
    }),

  createWorkspace: publicProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date().toISOString();
      return ctx.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(excelWorkspaces)
          .values({
            name: input.name,
            status: "draft",
            rowCount: 0,
            columnMappingJson: {},
            workbookJson: {},
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        if (!created) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Không tạo được không gian làm việc.",
          });
        }

        await writeEvent(tx, created.id, "created", input);
        return created;
      });
    }),

  getWorkspace: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const workspace = await getWorkspaceOrThrow(ctx.db, input.id);
      const [items, candidates, events] = await Promise.all([
        ctx.db
          .select()
          .from(excelWorkspaceItems)
          .where(eq(excelWorkspaceItems.workspaceId, input.id))
          .orderBy(asc(excelWorkspaceItems.sortOrder)),
        ctx.db
          .select()
          .from(webProductCandidates)
          .innerJoin(
            excelWorkspaceItems,
            eq(webProductCandidates.workspaceItemId, excelWorkspaceItems.id),
          )
          .where(eq(excelWorkspaceItems.workspaceId, input.id))
          .orderBy(
            asc(webProductCandidates.workspaceItemId),
            desc(webProductCandidates.confidenceScore),
          ),
        ctx.db
          .select()
          .from(excelWorkspaceEvents)
          .where(eq(excelWorkspaceEvents.workspaceId, input.id))
          .orderBy(desc(excelWorkspaceEvents.at)),
      ]);

      return {
        workspace,
        items,
        candidates: candidates.map((row) => row.web_product_candidates),
        events,
      };
    }),

  deleteWorkspace: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const workspace = await getWorkspaceOrThrow(ctx.db, input.id);
      if (workspace.status === "exported" || workspace.status === "approved") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Không xoá không gian làm việc đã xuất hoặc duyệt.",
        });
      }

      await ctx.db
        .delete(excelWorkspaces)
        .where(eq(excelWorkspaces.id, input.id));

      return { success: true };
    }),

  uploadWorkbook: publicProcedure
    .input(
      z.object({
        workspaceId: z.number().int().positive(),
        fileName: z.string().min(1),
        workbookBase64: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceEditable(ctx.db, input.workspaceId);

      let workbook: ParsedWorkbook;
      try {
        workbook = parseWorkbookBase64(input.fileName, input.workbookBase64);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Không đọc được tệp Excel.",
        });
      }

      const rowCount = workbook.sheets.reduce(
        (total, sheet) => total + sheet.rows.length,
        0,
      );
      const now = new Date().toISOString();

      await ctx.db.transaction(async (tx) => {
        await tx
          .delete(excelWorkspaceItems)
          .where(eq(excelWorkspaceItems.workspaceId, input.workspaceId));
        await tx
          .update(excelWorkspaces)
          .set({
            sourceFileName: input.fileName,
            sourceSheetName: workbook.sheets[0]?.name ?? null,
            rowCount,
            workbookJson: workbook as unknown as Record<string, unknown>,
            columnMappingJson:
              workbook.sheets[0]?.suggestedMapping ??
              ({} satisfies ColumnMapping),
            status: "imported",
            updatedAt: now,
          })
          .where(eq(excelWorkspaces.id, input.workspaceId));
        await writeEvent(tx, input.workspaceId, "workbook_uploaded", {
          fileName: input.fileName,
          sheets: workbook.sheets.map((sheet) => sheet.name),
          rowCount,
        });
      });

      return {
        sheets: workbook.sheets.map((sheet) => ({
          name: sheet.name,
          headerRowIndex: sheet.headerRowIndex,
          headers: sheet.headers,
          previewRows: sheet.previewRows,
          suggestedMapping: sheet.suggestedMapping,
          rowCount: sheet.rows.length,
        })),
      };
    }),

  previewWorkbookSheets: publicProcedure
    .input(z.object({ workspaceId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const workspace = await getWorkspaceOrThrow(ctx.db, input.workspaceId);
      const workbook = parseWorkbookJson(workspace.workbookJson);
      return workbook.sheets.map((sheet) => ({
        name: sheet.name,
        headerRowIndex: sheet.headerRowIndex,
        headers: sheet.headers,
        previewRows: sheet.previewRows,
        suggestedMapping: sheet.suggestedMapping,
        rowCount: sheet.rows.length,
      }));
    }),

  setColumnMapping: publicProcedure
    .input(
      z.object({
        workspaceId: z.number().int().positive(),
        sheetName: z.string().min(1),
        mapping: mappingSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceEditable(ctx.db, input.workspaceId);
      if (!input.mapping.productName) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cần ghép cột tên sản phẩm trước khi nhập dòng.",
        });
      }

      const workspace = await getWorkspaceOrThrow(ctx.db, input.workspaceId);
      const workbook = parseWorkbookJson(workspace.workbookJson);
      const sheet = workbook.sheets.find(
        (item) => item.name === input.sheetName,
      );
      if (!sheet) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy trang tính đã chọn.",
        });
      }

      const mapping = input.mapping as ColumnMapping;
      await ctx.db
        .update(excelWorkspaces)
        .set({
          sourceSheetName: input.sheetName,
          columnMappingJson: mapping,
          rowCount: sheet.rows.length,
          status: "mapped",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(excelWorkspaces.id, input.workspaceId));
      await writeEvent(ctx.db, input.workspaceId, "columns_mapped", {
        sheetName: input.sheetName,
        mapping,
      });

      return { success: true };
    }),

  importMappedRows: publicProcedure
    .input(z.object({ workspaceId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceEditable(ctx.db, input.workspaceId);
      const workspace = await getWorkspaceOrThrow(ctx.db, input.workspaceId);
      const workbook = parseWorkbookJson(workspace.workbookJson);
      const sheet = workbook.sheets.find(
        (item) => item.name === workspace.sourceSheetName,
      );
      if (!sheet) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Chưa chọn trang tính để nhập dòng.",
        });
      }

      const mapping = workspace.columnMappingJson as ColumnMapping;
      let rows;
      try {
        rows = rowsFromMapping(sheet, mapping);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Không nhập được dòng.",
        });
      }

      if (rows.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Không có dòng sản phẩm hợp lệ trong trang tính.",
        });
      }

      const now = new Date().toISOString();
      const created = await ctx.db.transaction(async (tx) => {
        await tx
          .delete(excelWorkspaceItems)
          .where(eq(excelWorkspaceItems.workspaceId, input.workspaceId));
        const inserted = await tx
          .insert(excelWorkspaceItems)
          .values(
            rows.map((row, index) => ({
              workspaceId: input.workspaceId,
              originalRowIndex: row.originalRowIndex,
              originalDataJson: row.originalDataJson,
              productName: row.productName,
              specText: row.specText,
              unit: row.unit,
              quantity: row.quantity,
              targetPrice: row.targetPrice,
              currency: row.currency,
              vendorHint: row.vendorHint,
              originHint: row.originHint,
              notes: row.notes,
              searchKeywords: row.searchKeywords,
              sortOrder: index,
              matchStatus: "unmatched" as const,
              enrichedSnapshotJson: {},
              createdAt: now,
              updatedAt: now,
            })),
          )
          .returning();
        await tx
          .update(excelWorkspaces)
          .set({
            rowCount: inserted.length,
            status: "mapped",
            updatedAt: now,
          })
          .where(eq(excelWorkspaces.id, input.workspaceId));
        await writeEvent(tx, input.workspaceId, "rows_imported", {
          count: inserted.length,
        });
        return inserted;
      });

      return created;
    }),

  updateImportedRow: publicProcedure
    .input(
      z.object({
        rowId: z.number().int().positive(),
        patch: rowPatchSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await getRowWithWorkspace(ctx.db, input.rowId);
      const resetsMatch =
        input.patch.productName != null ||
        input.patch.specText != null ||
        input.patch.unit != null ||
        input.patch.targetPrice != null ||
        input.patch.vendorHint != null ||
        input.patch.originHint != null ||
        input.patch.searchKeywords != null;

      const now = new Date().toISOString();
      const [updated] = await ctx.db
        .update(excelWorkspaceItems)
        .set({
          ...input.patch,
          vendorHint:
            input.patch.vendorHint === "" ? null : input.patch.vendorHint,
          originHint:
            input.patch.originHint === "" ? null : input.patch.originHint,
          matchStatus: resetsMatch ? "unmatched" : undefined,
          selectedCandidateId: resetsMatch ? null : undefined,
          enrichedSnapshotJson: resetsMatch ? {} : undefined,
          updatedAt: now,
        })
        .where(eq(excelWorkspaceItems.id, input.rowId))
        .returning();

      await ctx.db
        .update(excelWorkspaces)
        .set({ status: "reviewed", updatedAt: now })
        .where(eq(excelWorkspaces.id, row.workspace.id));

      return updated;
    }),

  searchWebCandidates: publicProcedure
    .input(z.object({ rowId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const row = await getRowWithWorkspace(ctx.db, input.rowId);
      const result = await searchProductCandidates({
        productName: row.item.productName,
        specText: row.item.specText,
        unit: row.item.unit,
        searchKeywords: row.item.searchKeywords,
        vendorHint: row.item.vendorHint,
        originHint: row.item.originHint,
        targetPrice: row.item.targetPrice,
        currency: row.item.currency,
      });

      const now = new Date().toISOString();
      const candidates = await ctx.db.transaction(async (tx) => {
        await tx
          .delete(webProductCandidates)
          .where(eq(webProductCandidates.workspaceItemId, row.item.id));

        await tx
          .update(excelWorkspaceItems)
          .set({
            selectedCandidateId: null,
            enrichedSnapshotJson: {},
            matchStatus:
              result.candidates.length > 0 ? "candidates_found" : "unmatched",
            updatedAt: now,
          })
          .where(eq(excelWorkspaceItems.id, row.item.id));

        if (result.candidates.length === 0) {
          return [];
        }

        return tx
          .insert(webProductCandidates)
          .values(
            result.candidates.map((candidate) => ({
              workspaceItemId: row.item.id,
              provider: candidate.provider,
              query: candidate.query,
              title: candidate.title,
              url: candidate.url,
              domain: candidate.domain,
              snippet: candidate.snippet,
              rawEvidence: candidate.rawEvidence,
              imageUrl: candidate.imageUrl,
              extractedSpecJson: candidate.extractedSpec,
              confidenceScore: candidate.confidenceScore,
              tavilyScore: candidate.tavilyScore,
              matchReasons: candidate.matchReasons,
              fetchedAt: now,
              createdAt: now,
            })),
          )
          .returning();
      });

      await writeEvent(ctx.db, row.workspace.id, "web_candidates_searched", {
        rowId: row.item.id,
        query: result.query,
        count: candidates.length,
      });

      return { query: result.query, candidates, warning: result.warning };
    }),

  selectWebCandidate: publicProcedure
    .input(
      z.object({
        rowId: z.number().int().positive(),
        candidateId: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await getRowWithWorkspace(ctx.db, input.rowId);
      const [candidate] = await ctx.db
        .select()
        .from(webProductCandidates)
        .where(
          and(
            eq(webProductCandidates.id, input.candidateId),
            eq(webProductCandidates.workspaceItemId, input.rowId),
          ),
        )
        .limit(1);

      if (!candidate) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy gợi ý.",
        });
      }

      await ctx.db.transaction(async (tx) => {
        await tx
          .update(webProductCandidates)
          .set({ isSelected: false })
          .where(eq(webProductCandidates.workspaceItemId, input.rowId));
        await tx
          .update(webProductCandidates)
          .set({ isSelected: true })
          .where(eq(webProductCandidates.id, input.candidateId));
        await tx
          .update(excelWorkspaceItems)
          .set({
            selectedCandidateId: candidate.id,
            enrichedSnapshotJson: candidate.extractedSpecJson,
            matchStatus: "matched",
            updatedAt: new Date().toISOString(),
          })
          .where(eq(excelWorkspaceItems.id, input.rowId));
        await refreshWorkspaceMatchedStatus(tx, row.workspace.id);
      });

      await writeEvent(ctx.db, row.workspace.id, "candidate_selected", {
        rowId: row.item.id,
        candidateId: candidate.id,
      });

      return { success: true };
    }),

  manualMatch: publicProcedure
    .input(
      z.object({
        rowId: z.number().int().positive(),
        spec: specSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await getRowWithWorkspace(ctx.db, input.rowId);
      const spec = input.spec as ExtractedProductSpec;
      const now = new Date().toISOString();

      const candidate = await ctx.db.transaction(async (tx) => {
        await tx
          .update(webProductCandidates)
          .set({ isSelected: false })
          .where(eq(webProductCandidates.workspaceItemId, input.rowId));
        const [created] = await tx
          .insert(webProductCandidates)
          .values({
            workspaceItemId: input.rowId,
            provider: "manual",
            query: "manual",
            title: spec.productName,
            url: spec.sourceUrl,
            domain: spec.vendorDomain || new URL(spec.sourceUrl).host,
            snippet: spec.specSummary,
            rawEvidence: spec.evidenceText,
            imageUrl: spec.imageUrl ?? null,
            extractedSpecJson: spec,
            confidenceScore: 100,
            tavilyScore: null,
            matchReasons: ["Người dùng nhập thủ công"],
            isSelected: true,
            fetchedAt: now,
            createdAt: now,
          })
          .returning();

        if (!created) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Không tạo được kết quả thủ công.",
          });
        }

        await tx
          .update(excelWorkspaceItems)
          .set({
            selectedCandidateId: created.id,
            enrichedSnapshotJson: spec,
            matchStatus: "manual",
            updatedAt: now,
          })
          .where(eq(excelWorkspaceItems.id, input.rowId));
        await refreshWorkspaceMatchedStatus(tx, row.workspace.id);

        return created;
      });

      await writeEvent(ctx.db, row.workspace.id, "candidate_manual", {
        rowId: row.item.id,
      });

      return candidate;
    }),

  clearSelectedCandidate: publicProcedure
    .input(z.object({ rowId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const row = await getRowWithWorkspace(ctx.db, input.rowId);
      await ctx.db.transaction(async (tx) => {
        await tx
          .update(webProductCandidates)
          .set({ isSelected: false })
          .where(eq(webProductCandidates.workspaceItemId, input.rowId));
        await tx
          .update(excelWorkspaceItems)
          .set({
            selectedCandidateId: null,
            enrichedSnapshotJson: {},
            matchStatus: "unmatched",
            updatedAt: new Date().toISOString(),
          })
          .where(eq(excelWorkspaceItems.id, input.rowId));
        await tx
          .update(excelWorkspaces)
          .set({ status: "reviewed", updatedAt: new Date().toISOString() })
          .where(eq(excelWorkspaces.id, row.workspace.id));
      });

      return { success: true };
    }),

  exportEnrichedExcel: publicProcedure
    .input(z.object({ workspaceId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const workspace = await getWorkspaceOrThrow(ctx.db, input.workspaceId);
      const items = await ctx.db
        .select()
        .from(excelWorkspaceItems)
        .where(eq(excelWorkspaceItems.workspaceId, input.workspaceId))
        .orderBy(asc(excelWorkspaceItems.sortOrder));

      if (items.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Không có dòng sản phẩm để xuất.",
        });
      }

      const openRows = items.filter((item) =>
        ["unmatched", "candidates_found"].includes(item.matchStatus),
      );
      if (openRows.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Còn ${openRows.length} dòng chưa chọn đúng sản phẩm.`,
        });
      }

      const selectedIds = items
        .map((item) => item.selectedCandidateId)
        .filter((id): id is number => typeof id === "number");
      const selectedCandidates =
        selectedIds.length > 0
          ? await ctx.db
              .select()
              .from(webProductCandidates)
              .where(inArray(webProductCandidates.id, selectedIds))
          : [];
      const candidateById = new Map(
        selectedCandidates.map((candidate) => [candidate.id, candidate]),
      );

      const workbookBase64 = buildEnrichedWorkbookBase64(
        items.map((item) => ({
          originalDataJson: item.originalDataJson,
          enrichedSnapshotJson: item.enrichedSnapshotJson,
          matchStatus: item.matchStatus,
          selectedCandidate: item.selectedCandidateId
            ? candidateById.get(item.selectedCandidateId)
            : null,
        })),
      );

      const stem =
        workspace.sourceFileName?.replace(/\.(xlsx|xls)$/i, "") ??
        workspace.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
      const fileName = `${stem || "workspace"}-enriched.xlsx`;
      const now = new Date().toISOString();
      await ctx.db
        .update(excelWorkspaces)
        .set({
          status: "exported",
          exportFileName: fileName,
          exportedAt: now,
          updatedAt: now,
        })
        .where(eq(excelWorkspaces.id, input.workspaceId));
      await writeEvent(ctx.db, input.workspaceId, "enriched_excel_exported", {
        fileName,
        rowCount: items.length,
      });

      return { fileName, workbookBase64 };
    }),

  transitionState: publicProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        to: statusSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const workspace = await getWorkspaceOrThrow(ctx.db, input.id);
      if (workspace.status === input.to) {
        return workspace;
      }

      const [summary] = await ctx.db
        .select({
          total: sql<number>`count(*)`,
          open: sql<number>`count(*) filter (where ${excelWorkspaceItems.matchStatus} in ('unmatched', 'candidates_found'))`,
        })
        .from(excelWorkspaceItems)
        .where(eq(excelWorkspaceItems.workspaceId, input.id));

      const total = Number(summary?.total ?? 0);
      const open = Number(summary?.open ?? 0);
      const allowed =
        (input.to === "reviewed" &&
          ["mapped", "reviewed", "matched"].includes(workspace.status)) ||
        (input.to === "matched" &&
          ["reviewed", "matched"].includes(workspace.status) &&
          total > 0 &&
          open === 0);

      if (!allowed) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            input.to === "matched"
              ? "Cần chọn hoặc nhập manual match cho tất cả dòng trước."
              : "Không thể chuyển trạng thái ở bước hiện tại.",
        });
      }

      const [updated] = await ctx.db
        .update(excelWorkspaces)
        .set({ status: input.to, updatedAt: new Date().toISOString() })
        .where(eq(excelWorkspaces.id, input.id))
        .returning();

      await writeEvent(ctx.db, input.id, "state_transitioned", {
        from: workspace.status,
        to: input.to,
      });

      return updated;
    }),
});
