import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  not,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import {
  defaultSelectedSheetTemplateIds,
  defaultWorkspaceTemplateConfig,
  normalizeSelectedSheetTemplateIds,
  normalizeWorkspaceTemplateConfig,
  standardSheetTemplateIds,
} from "~/lib/excel-workspace-standard";
import { resolveExcelWorkspaceStepState } from "~/lib/excel-workspace-steps";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { type db as appDb } from "~/server/db";
import {
  excelWorkspaceEvents,
  excelWorkspaceItems,
  excelWorkspaces,
  materials,
  webProductCandidates,
} from "~/server/db/schema";
import {
  buildEnrichedWorkbookBase64,
  columnKeys,
  parseWorkbookBase64,
  rebuildSheetWithHeaderRow,
  rowsFromMapping,
  type ColumnMapping,
  type ParsedWorkbook,
} from "~/server/services/excel-workbook";
import {
  hasBlockingExportIssues,
  validateWorkspaceForStandardExport,
} from "~/server/services/excel-workspace-validator";
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
  materialId: z.number().int().positive().nullable().optional(),
  term: z.enum(["term_1", "term_2"]).optional(),
  qtyTotal: z.number().nonnegative().nullable().optional(),
  qtyInStock: z.number().nonnegative().nullable().optional(),
  depreciation: z.number().nonnegative().optional(),
  reusePct: z.number().int().min(0).max(100).optional(),
  inspectionQtyTerm1: z.number().nonnegative().nullable().optional(),
  inspectionQtyTerm2: z.number().nonnegative().nullable().optional(),
  unitPrice: z.number().nonnegative().nullable().optional(),
  includedInExport: z.boolean().optional(),
  searchKeywords: z.array(z.string()).optional(),
});

const workspaceRowInputSchema = z.object({
  productName: z.string().trim().min(1),
  specText: z.string().default(""),
  unit: z.string().trim().min(1),
  term: z.enum(["term_1", "term_2"]).default("term_1"),
  qtyTotal: z.number().nonnegative().nullable().default(null),
  qtyInStock: z.number().nonnegative().nullable().default(0),
  depreciation: z.number().nonnegative().default(1),
  reusePct: z.number().int().min(0).max(100).default(0),
  inspectionQtyTerm1: z.number().nonnegative().nullable().default(null),
  inspectionQtyTerm2: z.number().nonnegative().nullable().default(null),
  unitPrice: z.number().nonnegative().nullable().default(null),
  vendorHint: z.string().trim().nullable().optional(),
  originHint: z.string().trim().nullable().optional(),
  notes: z.string().default(""),
});

const materialInputSchema = z.object({
  code: z.string().trim().optional(),
  name: z.string().trim().min(1),
  unit: z.string().trim().min(1),
  category: z.string().trim().optional(),
  specText: z.string().trim().optional(),
  manufacturer: z.string().trim().optional(),
  originCountry: z.string().trim().optional(),
  defaultUnitPrice: z.number().nonnegative().nullable().optional(),
  currency: z.string().trim().min(1).default("VND"),
  sourceUrl: z.string().trim().optional(),
  defaultDepreciation: z.number().nonnegative().default(1),
  defaultReusePct: z.number().int().min(0).max(100).default(0),
});

const templateConfigSchema = z.object({
  organizationLine1: z.string(),
  organizationLine2: z.string(),
  departmentLine: z.string(),
  rightHeaderLine1: z.string(),
  rightHeaderLine2: z.string(),
  schoolYearLabel: z.string(),
  siteLabel: z.string(),
  thvtTitle: z.string(),
  purchaseRequestTitle: z.string(),
  inspectionTitle: z.string(),
  requestRecipients: z.array(z.string()),
  basisParagraphs: z.array(z.string()),
  signerLabels: z.array(z.string()),
});

const sheetTemplateIdSchema = z.enum(standardSheetTemplateIds);

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

const webSearchFilterSchema = z
  .object({
    keywords: z.array(z.string().trim().min(1)).max(12).default([]),
    origins: z.array(z.string().trim().min(1)).max(10).default([]),
    requirePrice: z.boolean().default(false),
    minConfidence: z
      .union([z.literal(0), z.literal(50), z.literal(70)])
      .default(0),
  })
  .partial()
  .optional();

function parseWorkbookJson(value: Record<string, unknown>): ParsedWorkbook {
  if (!Array.isArray(value.sheets)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Không gian làm việc chưa có tệp Excel đã nhập.",
    });
  }

  return value as ParsedWorkbook;
}

function parseColumnMapping(value: unknown): ColumnMapping {
  const result = mappingSchema.safeParse(value);
  if (!result.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cấu hình ánh xạ cột không hợp lệ.",
    });
  }
  return result.data as ColumnMapping;
}

function hasWorkbookData(workspace: typeof excelWorkspaces.$inferSelect) {
  return (
    !!workspace.sourceFileName && Array.isArray(workspace.workbookJson.sheets)
  );
}

function hasProductNameMapping(workspace: typeof excelWorkspaces.$inferSelect) {
  const result = mappingSchema.safeParse(workspace.columnMappingJson);
  if (!result.success) {
    return false;
  }
  return !!result.data.materialName?.trim();
}

function buildWorkspaceRouteMeta(input: {
  workspace: typeof excelWorkspaces.$inferSelect;
  importedItemCount: number;
  openItemCount: number;
}) {
  const { nextStep, maxStep } = resolveExcelWorkspaceStepState({
    hasWorkbook: hasWorkbookData(input.workspace),
    hasMapping: hasProductNameMapping(input.workspace),
    importedItemCount: input.importedItemCount,
    openItemCount: input.openItemCount,
  });

  return {
    importedItemCount: input.importedItemCount,
    matchedItemCount: Math.max(
      0,
      input.importedItemCount - input.openItemCount,
    ),
    openItemCount: input.openItemCount,
    nextStep,
    maxStep,
  };
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

async function getRowWithWorkspaceForRead(db: DbExecutor, id: number) {
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

  return row;
}

async function getRowWithWorkspace(db: DbExecutor, id: number) {
  const row = await getRowWithWorkspaceForRead(db, id);

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

type MaterialRow = typeof materials.$inferSelect;
type WorkspaceItemRow = typeof excelWorkspaceItems.$inferSelect;

function normalizeMatchText(value: string | null | undefined) {
  return (value ?? "").toLocaleLowerCase("vi-VN").replace(/\s+/g, " ").trim();
}

function matchTokens(value: string | null | undefined) {
  return Array.from(
    new Set(
      normalizeMatchText(value)
        .split(/[^\p{L}\p{N}]+/u)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2),
    ),
  );
}

function scoreMaterialCandidate(input: {
  item: WorkspaceItemRow;
  material: MaterialRow;
  keyword?: string;
}) {
  const targetTokens = Array.from(
    new Set([
      ...matchTokens(input.item.productName),
      ...matchTokens(input.item.specText),
      ...matchTokens(input.keyword),
    ]),
  );
  const haystack = normalizeMatchText(
    [
      input.material.code,
      input.material.name,
      input.material.unit,
      input.material.category,
      input.material.specText,
      input.material.manufacturer,
      input.material.originCountry,
    ]
      .filter(Boolean)
      .join(" "),
  );
  const matchedTokens = targetTokens.filter((token) =>
    haystack.includes(token),
  );
  const reasons: string[] = [];
  let score = 20;

  if (targetTokens.length > 0 && matchedTokens.length > 0) {
    score += Math.round((matchedTokens.length / targetTokens.length) * 45);
    reasons.push(`Khớp ${matchedTokens.length}/${targetTokens.length} từ khóa`);
  }

  if (
    input.item.unit &&
    normalizeMatchText(input.material.unit) ===
      normalizeMatchText(input.item.unit)
  ) {
    score += 20;
    reasons.push("Khớp đơn vị tính");
  }

  if (input.material.code) {
    score += 5;
    reasons.push("Có mã vật tư");
  }

  if (input.material.category) {
    score += 5;
    reasons.push("Có nhóm vật tư");
  }

  if (reasons.length === 0) {
    reasons.push("Cần kiểm tra thủ công");
  }

  return {
    confidenceScore: Math.max(0, Math.min(100, score)),
    matchReasons: reasons,
  };
}

function materialEvidence(material: MaterialRow) {
  return [
    `Nguồn nội bộ #${material.id}`,
    material.code ? `Mã: ${material.code}` : null,
    `ĐVT: ${material.unit}`,
    material.category ? `Nhóm: ${material.category}` : null,
    material.specText ? `Thông số: ${material.specText}` : null,
    material.manufacturer ? `NSX: ${material.manufacturer}` : null,
    material.originCountry ? `Xuất xứ: ${material.originCountry}` : null,
    material.defaultUnitPrice ? `Đơn giá: ${material.defaultUnitPrice}` : null,
    material.sourceUrl ? `Nguồn: ${material.sourceUrl}` : null,
    `Khấu hao mặc định: ${material.defaultDepreciation}`,
    `% sử dụng lại mặc định: ${material.defaultReusePct}`,
  ]
    .filter(Boolean)
    .join(" • ");
}

function materialSpec(material: MaterialRow): ExtractedProductSpec {
  const evidenceText = materialEvidence(material);
  return {
    productName: material.name,
    brand: null,
    model: material.code,
    specSummary: [
      material.code ? `Mã ${material.code}` : null,
      material.category ? `Nhóm ${material.category}` : null,
      material.specText || null,
      `ĐVT ${material.unit}`,
    ]
      .filter(Boolean)
      .join(" • "),
    unit: material.unit,
    priceText: material.defaultUnitPrice
      ? material.defaultUnitPrice.toLocaleString("vi-VN")
      : null,
    priceVnd: material.defaultUnitPrice,
    originCountry: material.originCountry,
    vendorName: material.manufacturer ?? "Danh mục nội bộ",
    vendorDomain: material.sourceUrl ? "Nguồn nội bộ" : "Danh mục nội bộ",
    sourceUrl: material.sourceUrl ?? `Material Master #${material.id}`,
    imageUrl: null,
    evidenceText,
  };
}

function materialCandidateValues(input: {
  item: WorkspaceItemRow;
  material: MaterialRow;
  now: string;
  confidenceScore: number;
  matchReasons: string[];
}) {
  const spec = materialSpec(input.material);
  return {
    workspaceItemId: input.item.id,
    provider: "material",
    query: input.item.productName,
    title: input.material.name,
    url: `material://materials/${input.material.id}`,
    domain: "Danh mục nội bộ",
    snippet: spec.specSummary,
    rawEvidence: spec.evidenceText,
    imageUrl: null,
    extractedSpecJson: spec,
    confidenceScore: input.confidenceScore,
    matchReasons: input.matchReasons,
    isSelected: true,
    fetchedAt: input.now,
    createdAt: input.now,
  };
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
      const workspaceRows = await ctx.db
        .select()
        .from(excelWorkspaces)
        .where(
          input?.status ? eq(excelWorkspaces.status, input.status) : undefined,
        )
        .orderBy(desc(excelWorkspaces.updatedAt));

      if (workspaceRows.length === 0) {
        return [];
      }

      const itemRows = await ctx.db
        .select({
          workspaceId: excelWorkspaceItems.workspaceId,
          matchStatus: excelWorkspaceItems.matchStatus,
        })
        .from(excelWorkspaceItems)
        .where(
          inArray(
            excelWorkspaceItems.workspaceId,
            workspaceRows.map((workspace) => workspace.id),
          ),
        );

      const countsByWorkspaceId = new Map<
        number,
        { importedItemCount: number; openItemCount: number }
      >();

      for (const item of itemRows) {
        const current = countsByWorkspaceId.get(item.workspaceId) ?? {
          importedItemCount: 0,
          openItemCount: 0,
        };

        current.importedItemCount += 1;
        if (
          item.matchStatus === "unmatched" ||
          item.matchStatus === "candidates_found"
        ) {
          current.openItemCount += 1;
        }

        countsByWorkspaceId.set(item.workspaceId, current);
      }

      return workspaceRows.map((workspace) => {
        const counts = countsByWorkspaceId.get(workspace.id) ?? {
          importedItemCount: 0,
          openItemCount: 0,
        };

        return {
          ...workspace,
          templateConfigJson: normalizeWorkspaceTemplateConfig(
            workspace.templateConfigJson,
          ),
          selectedSheetTemplateIds: normalizeSelectedSheetTemplateIds(
            workspace.selectedSheetTemplateIds,
          ),
          routeMeta: buildWorkspaceRouteMeta({
            workspace,
            importedItemCount: counts.importedItemCount,
            openItemCount: counts.openItemCount,
          }),
        };
      });
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
            templateConfigJson: defaultWorkspaceTemplateConfig,
            selectedSheetTemplateIds: defaultSelectedSheetTemplateIds,
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
      const openItemCount = items.filter(
        (item) =>
          item.matchStatus === "unmatched" ||
          item.matchStatus === "candidates_found",
      ).length;

      return {
        workspace: {
          ...workspace,
          templateConfigJson: normalizeWorkspaceTemplateConfig(
            workspace.templateConfigJson,
          ),
          selectedSheetTemplateIds: normalizeSelectedSheetTemplateIds(
            workspace.selectedSheetTemplateIds,
          ),
        },
        items,
        candidates: candidates.map((row) => row.web_product_candidates),
        events,
        routeMeta: buildWorkspaceRouteMeta({
          workspace,
          importedItemCount: items.length,
          openItemCount,
        }),
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
        workbook = await parseWorkbookBase64(
          input.fileName,
          input.workbookBase64,
        );
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
        warnings: workbook.warnings,
        sheets: workbook.sheets.map((sheet) => ({
          name: sheet.name,
          detectedHeaderRowIndex: sheet.detectedHeaderRowIndex,
          activeHeaderRowIndex: sheet.activeHeaderRowIndex,
          headerRowIndex: sheet.headerRowIndex,
          headers: sheet.headers,
          rawRows: sheet.rawRows.slice(0, 12),
          previewRows: sheet.previewRows,
          suggestedMapping: sheet.suggestedMapping,
          rowCount: sheet.rows.length,
          warnings: sheet.warnings,
        })),
      };
    }),

  previewWorkbookSheets: publicProcedure
    .input(z.object({ workspaceId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const workspace = await getWorkspaceOrThrow(ctx.db, input.workspaceId);
      if (!hasWorkbookData(workspace)) {
        return [];
      }
      const workbook = parseWorkbookJson(workspace.workbookJson);
      return workbook.sheets.map((sheet) => ({
        name: sheet.name,
        detectedHeaderRowIndex: sheet.detectedHeaderRowIndex,
        activeHeaderRowIndex: sheet.activeHeaderRowIndex,
        headerRowIndex: sheet.headerRowIndex,
        headers: sheet.headers,
        rawRows: sheet.rawRows.slice(0, 40),
        previewRows: sheet.previewRows,
        suggestedMapping: sheet.suggestedMapping,
        rowCount: sheet.rows.length,
        warnings: sheet.warnings,
      }));
    }),

  updateWorkspaceTemplateConfig: publicProcedure
    .input(
      z.object({
        workspaceId: z.number().int().positive(),
        config: templateConfigSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceEditable(ctx.db, input.workspaceId);
      const config = normalizeWorkspaceTemplateConfig(input.config);
      await ctx.db
        .update(excelWorkspaces)
        .set({
          templateConfigJson: config as unknown as Record<string, unknown>,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(excelWorkspaces.id, input.workspaceId));
      await writeEvent(ctx.db, input.workspaceId, "template_config_updated", {
        config,
      });
      return config;
    }),

  setSelectedSheetTemplates: publicProcedure
    .input(
      z.object({
        workspaceId: z.number().int().positive(),
        templateIds: z.array(sheetTemplateIdSchema),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceEditable(ctx.db, input.workspaceId);
      const templateIds = normalizeSelectedSheetTemplateIds(input.templateIds);
      await ctx.db
        .update(excelWorkspaces)
        .set({
          selectedSheetTemplateIds: templateIds,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(excelWorkspaces.id, input.workspaceId));
      await writeEvent(ctx.db, input.workspaceId, "sheet_templates_selected", {
        templateIds,
      });
      return templateIds;
    }),

  setSheetHeaderRow: publicProcedure
    .input(
      z.object({
        workspaceId: z.number().int().positive(),
        sheetName: z.string().min(1),
        headerRowIndex: z.number().int().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceEditable(ctx.db, input.workspaceId);
      const workspace = await getWorkspaceOrThrow(ctx.db, input.workspaceId);
      const workbook = parseWorkbookJson(workspace.workbookJson);
      const sheetIndex = workbook.sheets.findIndex(
        (sheet) => sheet.name === input.sheetName,
      );
      const sheet = workbook.sheets[sheetIndex];
      if (!sheet) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy trang tính đã chọn.",
        });
      }
      const rebuilt = rebuildSheetWithHeaderRow(sheet, input.headerRowIndex);
      const nextWorkbook: ParsedWorkbook = {
        ...workbook,
        sheets: workbook.sheets.map((item, index) =>
          index === sheetIndex ? rebuilt : item,
        ),
      };
      await ctx.db
        .update(excelWorkspaces)
        .set({
          workbookJson: nextWorkbook as unknown as Record<string, unknown>,
          sourceSheetName: input.sheetName,
          columnMappingJson: rebuilt.suggestedMapping,
          rowCount: rebuilt.rows.length,
          status: "imported",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(excelWorkspaces.id, input.workspaceId));
      await writeEvent(ctx.db, input.workspaceId, "sheet_header_row_selected", {
        sheetName: input.sheetName,
        headerRowIndex: input.headerRowIndex,
      });
      return {
        name: rebuilt.name,
        detectedHeaderRowIndex: rebuilt.detectedHeaderRowIndex,
        activeHeaderRowIndex: rebuilt.activeHeaderRowIndex,
        headerRowIndex: rebuilt.headerRowIndex,
        headers: rebuilt.headers,
        rawRows: rebuilt.rawRows.slice(0, 40),
        previewRows: rebuilt.previewRows,
        suggestedMapping: rebuilt.suggestedMapping,
        rowCount: rebuilt.rows.length,
        warnings: rebuilt.warnings,
      };
    }),

  setStandardColumnMapping: publicProcedure
    .input(
      z.object({
        workspaceId: z.number().int().positive(),
        sheetName: z.string().min(1),
        headerRowIndex: z.number().int().min(1),
        mapping: mappingSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceEditable(ctx.db, input.workspaceId);
      if (!input.mapping.materialName) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cần ghép cột tên vật tư trước khi nhập dòng.",
        });
      }
      const workspace = await getWorkspaceOrThrow(ctx.db, input.workspaceId);
      const workbook = parseWorkbookJson(workspace.workbookJson);
      const sheetIndex = workbook.sheets.findIndex(
        (sheet) => sheet.name === input.sheetName,
      );
      const sheet = workbook.sheets[sheetIndex];
      if (!sheet) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy trang tính đã chọn.",
        });
      }
      const rebuilt = rebuildSheetWithHeaderRow(sheet, input.headerRowIndex);
      const nextWorkbook: ParsedWorkbook = {
        ...workbook,
        sheets: workbook.sheets.map((item, index) =>
          index === sheetIndex ? rebuilt : item,
        ),
      };
      const mapping = parseColumnMapping(input.mapping);
      await ctx.db
        .update(excelWorkspaces)
        .set({
          sourceSheetName: input.sheetName,
          columnMappingJson: mapping,
          workbookJson: nextWorkbook as unknown as Record<string, unknown>,
          rowCount: rebuilt.rows.length,
          status: "mapped",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(excelWorkspaces.id, input.workspaceId));
      await writeEvent(ctx.db, input.workspaceId, "standard_columns_mapped", {
        sheetName: input.sheetName,
        headerRowIndex: input.headerRowIndex,
        mapping,
      });
      return { success: true };
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
      if (!input.mapping.materialName) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cần ghép cột tên vật tư trước khi nhập dòng.",
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

      const mapping = parseColumnMapping(input.mapping);
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

      const mapping = parseColumnMapping(workspace.columnMappingJson);
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
              term: row.term,
              qtyTotal: row.qtyTotal,
              qtyInStock: row.qtyInStock,
              depreciation: row.depreciation,
              reusePct: row.reusePct,
              inspectionQtyTerm1: row.inspectionQtyTerm1,
              inspectionQtyTerm2: row.inspectionQtyTerm2,
              unitPrice: row.unitPrice,
              includedInExport: true,
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

  importStandardRows: publicProcedure
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

      const mapping = parseColumnMapping(workspace.columnMappingJson);
      const rows = rowsFromMapping(sheet, mapping);
      if (rows.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Không có dòng vật tư hợp lệ trong trang tính.",
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
              term: row.term,
              qtyTotal: row.qtyTotal,
              qtyInStock: row.qtyInStock,
              depreciation: row.depreciation,
              reusePct: row.reusePct,
              inspectionQtyTerm1: row.inspectionQtyTerm1,
              inspectionQtyTerm2: row.inspectionQtyTerm2,
              unitPrice: row.unitPrice,
              includedInExport: true,
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
            status: "reviewed",
            updatedAt: now,
          })
          .where(eq(excelWorkspaces.id, input.workspaceId));
        await writeEvent(tx, input.workspaceId, "standard_rows_imported", {
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

  createWorkspaceRow: publicProcedure
    .input(
      z.object({
        workspaceId: z.number().int().positive(),
        row: workspaceRowInputSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceEditable(ctx.db, input.workspaceId);
      const [lastRow] = await ctx.db
        .select({ sortOrder: excelWorkspaceItems.sortOrder })
        .from(excelWorkspaceItems)
        .where(eq(excelWorkspaceItems.workspaceId, input.workspaceId))
        .orderBy(desc(excelWorkspaceItems.sortOrder))
        .limit(1);
      const now = new Date().toISOString();
      const [created] = await ctx.db
        .insert(excelWorkspaceItems)
        .values({
          workspaceId: input.workspaceId,
          originalRowIndex: 0,
          originalDataJson: {},
          productName: input.row.productName,
          specText: input.row.specText,
          unit: input.row.unit,
          quantity: input.row.qtyTotal,
          targetPrice: input.row.unitPrice,
          currency: "VND",
          vendorHint: input.row.vendorHint ?? null,
          originHint: input.row.originHint ?? null,
          notes: input.row.notes,
          term: input.row.term,
          qtyTotal: input.row.qtyTotal,
          qtyInStock: input.row.qtyInStock,
          depreciation: input.row.depreciation,
          reusePct: input.row.reusePct,
          inspectionQtyTerm1: input.row.inspectionQtyTerm1,
          inspectionQtyTerm2: input.row.inspectionQtyTerm2,
          unitPrice: input.row.unitPrice,
          includedInExport: true,
          searchKeywords: [
            input.row.productName,
            input.row.specText,
            input.row.unit,
          ]
            .join(" ")
            .split(/[,;/\n]/)
            .map((value) => value.trim())
            .filter(Boolean),
          sortOrder: (lastRow?.sortOrder ?? -1) + 1,
          matchStatus: "unmatched",
          enrichedSnapshotJson: {},
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      await ctx.db
        .update(excelWorkspaces)
        .set({ status: "reviewed", updatedAt: now })
        .where(eq(excelWorkspaces.id, input.workspaceId));
      await writeEvent(ctx.db, input.workspaceId, "workspace_row_created", {
        rowId: created?.id,
      });
      return created;
    }),

  updateWorkspaceRow: publicProcedure
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
        input.patch.unitPrice != null ||
        input.patch.vendorHint != null ||
        input.patch.originHint != null ||
        input.patch.searchKeywords != null;
      const now = new Date().toISOString();
      const [updated] = await ctx.db
        .update(excelWorkspaceItems)
        .set({
          ...input.patch,
          quantity:
            input.patch.qtyTotal !== undefined
              ? input.patch.qtyTotal
              : undefined,
          targetPrice:
            input.patch.unitPrice !== undefined
              ? input.patch.unitPrice
              : undefined,
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

  deleteWorkspaceRow: publicProcedure
    .input(z.object({ rowId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const row = await getRowWithWorkspace(ctx.db, input.rowId);
      await ctx.db
        .delete(excelWorkspaceItems)
        .where(eq(excelWorkspaceItems.id, input.rowId));
      await ctx.db
        .update(excelWorkspaces)
        .set({ status: "reviewed", updatedAt: new Date().toISOString() })
        .where(eq(excelWorkspaces.id, row.workspace.id));
      await writeEvent(ctx.db, row.workspace.id, "workspace_row_deleted", {
        rowId: input.rowId,
      });
      return { success: true };
    }),

  searchWebCandidates: publicProcedure
    .input(
      z.object({
        rowId: z.number().int().positive(),
        filters: webSearchFilterSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await getRowWithWorkspace(ctx.db, input.rowId);
      const [selectedCandidate] = row.item.selectedCandidateId
        ? await ctx.db
            .select()
            .from(webProductCandidates)
            .where(eq(webProductCandidates.id, row.item.selectedCandidateId))
            .limit(1)
        : [];
      const keepsSelectedCandidate =
        selectedCandidate?.provider === "manual" ||
        selectedCandidate?.provider === "material";
      const filters = input.filters ?? {};
      const filterKeywords = filters.keywords ?? [];
      const filterOrigins = filters.origins ?? [];
      const hasFilterSearchHints =
        filterKeywords.length > 0 ||
        filterOrigins.length > 0 ||
        !!filters.requirePrice ||
        (filters.minConfidence ?? 0) > 0;
      const result = await searchProductCandidates({
        productName: row.item.productName,
        specText: row.item.specText,
        unit: row.item.unit,
        searchKeywords: [
          ...row.item.searchKeywords,
          ...filterKeywords,
          ...(filters.requirePrice ? ["giá", "báo giá", "price"] : []),
        ],
        extraOriginHints: filterOrigins,
        requirePrice: filters.requirePrice,
        maxResults: hasFilterSearchHints ? 20 : undefined,
        vendorHint: row.item.vendorHint,
        originHint: row.item.originHint,
        targetPrice: row.item.targetPrice,
        currency: row.item.currency,
      });

      const now = new Date().toISOString();
      const candidates = await ctx.db.transaction(async (tx) => {
        await tx
          .delete(webProductCandidates)
          .where(
            and(
              eq(webProductCandidates.workspaceItemId, row.item.id),
              not(
                inArray(webProductCandidates.provider, ["manual", "material"]),
              ),
            ),
          );

        await tx
          .update(excelWorkspaceItems)
          .set(
            keepsSelectedCandidate
              ? {
                  updatedAt: now,
                }
              : {
                  selectedCandidateId: null,
                  enrichedSnapshotJson: {},
                  matchStatus:
                    result.candidates.length > 0
                      ? "candidates_found"
                      : "unmatched",
                  updatedAt: now,
                },
          )
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
        filters: hasFilterSearchHints
          ? {
              keywords: filterKeywords,
              origins: filterOrigins,
              requirePrice: !!filters.requirePrice,
              minConfidence: filters.minConfidence ?? 0,
            }
          : null,
      });

      return { query: result.query, candidates, warning: result.warning };
    }),

  searchMaterialCandidates: publicProcedure
    .input(
      z.object({
        rowId: z.number().int().positive(),
        keyword: z.string().trim().optional(),
        limit: z.number().int().min(1).max(30).default(12),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await getRowWithWorkspaceForRead(ctx.db, input.rowId);
      const keyword = input.keyword?.trim() ?? row.item.productName;
      const likeKeyword = `%${keyword}%`;
      const rows = await ctx.db
        .select()
        .from(materials)
        .where(
          and(
            isNull(materials.deletedAt),
            keyword
              ? or(
                  ilike(materials.name, likeKeyword),
                  ilike(materials.code, likeKeyword),
                  ilike(materials.unit, likeKeyword),
                  ilike(materials.category, likeKeyword),
                )
              : undefined,
          ),
        )
        .orderBy(desc(materials.updatedAt))
        .limit(input.limit);

      return rows
        .map((material) => {
          const scored = scoreMaterialCandidate({
            item: row.item,
            material,
            keyword,
          });
          return {
            materialId: material.id,
            code: material.code,
            title: material.name,
            unit: material.unit,
            category: material.category,
            defaultDepreciation: material.defaultDepreciation,
            defaultReusePct: material.defaultReusePct,
            confidenceScore: scored.confidenceScore,
            matchReasons: scored.matchReasons,
          };
        })
        .sort((a, b) => b.confidenceScore - a.confidenceScore);
    }),

  linkMaterialToRow: publicProcedure
    .input(
      z.object({
        rowId: z.number().int().positive(),
        materialId: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await getRowWithWorkspace(ctx.db, input.rowId);
      const [material] = await ctx.db
        .select()
        .from(materials)
        .where(
          and(eq(materials.id, input.materialId), isNull(materials.deletedAt)),
        )
        .limit(1);

      if (!material) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy sản phẩm / vật tư.",
        });
      }

      const scored = scoreMaterialCandidate({ item: row.item, material });
      const now = new Date().toISOString();
      const candidate = await ctx.db.transaction(async (tx) => {
        await tx
          .update(webProductCandidates)
          .set({ isSelected: false })
          .where(eq(webProductCandidates.workspaceItemId, input.rowId));
        const [created] = await tx
          .insert(webProductCandidates)
          .values(
            materialCandidateValues({
              item: row.item,
              material,
              now,
              confidenceScore: scored.confidenceScore,
              matchReasons: scored.matchReasons,
            }),
          )
          .returning();
        if (!created) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Không tạo được nguồn từ danh mục nội bộ.",
          });
        }
        await tx
          .update(excelWorkspaceItems)
          .set({
            materialId: material.id,
            productName: material.name,
            specText: material.specText || row.item.specText,
            unit: material.unit,
            targetPrice: material.defaultUnitPrice ?? row.item.targetPrice,
            unitPrice: material.defaultUnitPrice ?? row.item.unitPrice,
            vendorHint: material.manufacturer ?? row.item.vendorHint,
            originHint: material.originCountry ?? row.item.originHint,
            selectedCandidateId: created.id,
            enrichedSnapshotJson: materialSpec(material),
            matchStatus: "matched",
            updatedAt: now,
          })
          .where(eq(excelWorkspaceItems.id, input.rowId));
        await refreshWorkspaceMatchedStatus(tx, row.workspace.id);
        return created;
      });

      await writeEvent(ctx.db, row.workspace.id, "material_linked_to_row", {
        rowId: row.item.id,
        materialId: material.id,
        candidateId: candidate.id,
      });
      return candidate;
    }),

  createMaterialAndLinkRow: publicProcedure
    .input(
      z.object({
        rowId: z.number().int().positive(),
        material: materialInputSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await getRowWithWorkspace(ctx.db, input.rowId);
      const now = new Date().toISOString();
      const result = await ctx.db.transaction(async (tx) => {
        const [material] = await tx
          .insert(materials)
          .values({
            ...input.material,
            code: input.material.code ?? null,
            category: input.material.category ?? null,
            specText: input.material.specText ?? "",
            manufacturer: input.material.manufacturer ?? null,
            originCountry: input.material.originCountry ?? null,
            defaultUnitPrice: input.material.defaultUnitPrice ?? null,
            sourceUrl: input.material.sourceUrl ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (!material) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Không tạo được sản phẩm / vật tư.",
          });
        }
        const scored = scoreMaterialCandidate({ item: row.item, material });
        await tx
          .update(webProductCandidates)
          .set({ isSelected: false })
          .where(eq(webProductCandidates.workspaceItemId, input.rowId));
        const [candidate] = await tx
          .insert(webProductCandidates)
          .values(
            materialCandidateValues({
              item: row.item,
              material,
              now,
              confidenceScore: scored.confidenceScore,
              matchReasons: [
                "Người dùng thêm vào danh mục nội bộ",
                ...scored.matchReasons,
              ],
            }),
          )
          .returning();
        if (!candidate) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Không tạo được nguồn từ danh mục nội bộ.",
          });
        }
        await tx
          .update(excelWorkspaceItems)
          .set({
            materialId: material.id,
            productName: material.name,
            specText: material.specText || row.item.specText,
            unit: material.unit,
            targetPrice: material.defaultUnitPrice ?? row.item.targetPrice,
            unitPrice: material.defaultUnitPrice ?? row.item.unitPrice,
            vendorHint: material.manufacturer ?? row.item.vendorHint,
            originHint: material.originCountry ?? row.item.originHint,
            selectedCandidateId: candidate.id,
            enrichedSnapshotJson: materialSpec(material),
            matchStatus: "matched",
            updatedAt: now,
          })
          .where(eq(excelWorkspaceItems.id, input.rowId));
        await refreshWorkspaceMatchedStatus(tx, row.workspace.id);
        return { material, candidate };
      });
      await writeEvent(
        ctx.db,
        row.workspace.id,
        "material_created_and_linked",
        {
          rowId: row.item.id,
          materialId: result.material.id,
          candidateId: result.candidate.id,
        },
      );
      return result;
    }),

  selectMaterialCandidate: publicProcedure
    .input(
      z.object({
        rowId: z.number().int().positive(),
        materialId: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await getRowWithWorkspace(ctx.db, input.rowId);
      const [material] = await ctx.db
        .select()
        .from(materials)
        .where(
          and(eq(materials.id, input.materialId), isNull(materials.deletedAt)),
        )
        .limit(1);

      if (!material) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy sản phẩm / vật tư.",
        });
      }

      const scored = scoreMaterialCandidate({ item: row.item, material });
      const now = new Date().toISOString();
      const candidate = await ctx.db.transaction(async (tx) => {
        await tx
          .update(webProductCandidates)
          .set({ isSelected: false })
          .where(eq(webProductCandidates.workspaceItemId, input.rowId));

        const [created] = await tx
          .insert(webProductCandidates)
          .values(
            materialCandidateValues({
              item: row.item,
              material,
              now,
              confidenceScore: scored.confidenceScore,
              matchReasons: scored.matchReasons,
            }),
          )
          .returning();

        if (!created) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Không tạo được gợi ý từ danh mục nội bộ.",
          });
        }

        await tx
          .update(excelWorkspaceItems)
          .set({
            materialId: material.id,
            selectedCandidateId: created.id,
            enrichedSnapshotJson: materialSpec(material),
            matchStatus: "matched",
            updatedAt: now,
          })
          .where(eq(excelWorkspaceItems.id, input.rowId));
        await refreshWorkspaceMatchedStatus(tx, row.workspace.id);
        return created;
      });

      await writeEvent(
        ctx.db,
        row.workspace.id,
        "candidate_material_selected",
        {
          rowId: row.item.id,
          materialId: material.id,
          candidateId: candidate.id,
        },
      );

      return candidate;
    }),

  createMaterialAndMatch: publicProcedure
    .input(
      z.object({
        rowId: z.number().int().positive(),
        material: materialInputSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await getRowWithWorkspace(ctx.db, input.rowId);
      const now = new Date().toISOString();

      const result = await ctx.db.transaction(async (tx) => {
        const [material] = await tx
          .insert(materials)
          .values({
            ...input.material,
            code: input.material.code ?? null,
            category: input.material.category ?? null,
            specText: input.material.specText ?? "",
            manufacturer: input.material.manufacturer ?? null,
            originCountry: input.material.originCountry ?? null,
            defaultUnitPrice: input.material.defaultUnitPrice ?? null,
            sourceUrl: input.material.sourceUrl ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        if (!material) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Không tạo được sản phẩm / vật tư.",
          });
        }

        const scored = scoreMaterialCandidate({ item: row.item, material });
        await tx
          .update(webProductCandidates)
          .set({ isSelected: false })
          .where(eq(webProductCandidates.workspaceItemId, input.rowId));

        const [candidate] = await tx
          .insert(webProductCandidates)
          .values(
            materialCandidateValues({
              item: row.item,
              material,
              now,
              confidenceScore: scored.confidenceScore,
              matchReasons: [
                "Người dùng thêm vào danh mục nội bộ",
                ...scored.matchReasons,
              ],
            }),
          )
          .returning();

        if (!candidate) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Không tạo được gợi ý từ danh mục nội bộ.",
          });
        }

        await tx
          .update(excelWorkspaceItems)
          .set({
            materialId: material.id,
            selectedCandidateId: candidate.id,
            enrichedSnapshotJson: materialSpec(material),
            matchStatus: "matched",
            updatedAt: now,
          })
          .where(eq(excelWorkspaceItems.id, input.rowId));
        await refreshWorkspaceMatchedStatus(tx, row.workspace.id);

        return { material, candidate };
      });

      await writeEvent(ctx.db, row.workspace.id, "candidate_material_created", {
        rowId: row.item.id,
        materialId: result.material.id,
        candidateId: result.candidate.id,
      });

      return result;
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

  validateWorkspaceForExport: publicProcedure
    .input(z.object({ workspaceId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const workspace = await getWorkspaceOrThrow(ctx.db, input.workspaceId);
      const items = await ctx.db
        .select()
        .from(excelWorkspaceItems)
        .where(eq(excelWorkspaceItems.workspaceId, input.workspaceId))
        .orderBy(asc(excelWorkspaceItems.sortOrder));
      const issues = validateWorkspaceForStandardExport({ workspace, items });
      return {
        issues,
        blocking: hasBlockingExportIssues(issues),
      };
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

      const workbookBase64 = await buildEnrichedWorkbookBase64(
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
        workspace.sourceFileName?.replace(/\.xlsx$/i, "") ??
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
              ? "Cần chọn hoặc nhập kết quả thủ công cho tất cả dòng trước."
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

  deleteMany: publicProcedure
    .input(
      z.object({ ids: z.array(z.number().int().positive()).min(1).max(50) }),
    )
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.db
        .delete(excelWorkspaces)
        .where(inArray(excelWorkspaces.id, input.ids))
        .returning({ id: excelWorkspaces.id });
      return { count: deleted.length };
    }),
});
