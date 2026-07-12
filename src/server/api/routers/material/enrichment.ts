import { TRPCError } from "@trpc/server";
import { and, asc, ilike, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { protectedProcedure, requirePermission } from "~/server/api/trpc";
import { materials } from "~/server/db/schema";
import {
  FILLABLE_FIELDS,
  ENRICH_THRESHOLDS,
  MAX_ENRICH_ROWS,
  extractRowFields,
  matchRows,
  writeEnrichedWorkbook,
} from "~/server/services/excel-enrich";
import { buildSearchQueries } from "~/server/services/excel-research/query-builder";
import { buildProfileSearchQueryWaves } from "~/server/services/excel-research/query-builder";
import {
  parseWorkbookBase64,
  rebuildSheetWithHeaderRow,
  type ColumnMapping,
  type ParsedWorkbookSheet,
} from "~/server/services/excel-workbook";
import { enrichProfileRowSearch } from "~/server/services/enrich-profile-row-search";
import { searchProfileRowWebLinks } from "~/server/services/enrich-profile-row-search";
import { rerankAmbiguousMaterialLinks } from "~/server/services/material-search-ai-reranker";
import {
  enrichRowFromWeb,
  enrichRowFromWebResults,
} from "~/server/services/enrich-web-row";
import {
  resolveSearchDomainPolicy,
  resolveSearchQueryControls,
} from "~/server/services/app-settings";
import {
  rankSearchResults,
  searchWebForProduct,
} from "~/server/services/material-web-search";
import { selectWorkbookSheet } from "~/server/api/routers/material/workbook";

const enrichWebRowInput = z.object({
  name: z.string().trim().min(1).max(500),
  code: z.string().trim().max(200).optional(),
  manufacturer: z.string().trim().max(300).optional(),
  specText: z.string().trim().max(2_000).optional(),
  unit: z.string().trim().max(100).optional(),
  category: z.string().trim().max(300).optional(),
  originCountry: z.string().trim().max(200).optional(),
});

const webSearchResultInput = z.object({
  title: z.string().trim().min(1).max(500),
  url: z.string().trim().url().max(2_048),
  domain: z.string().trim().max(253),
  snippet: z.string().max(4_000),
  query: z.string().max(1_000).optional(),
  rankScore: z.number().optional(),
});

const materialAssessmentInput = z.object({
  score: z.number().min(0).max(1),
  tier: z.enum(["primary", "weak", "rejected"]),
  dimensions: z.object({
    identity: z.number(),
    specification: z.number(),
    sourceTrust: z.number(),
    retrievalConsensus: z.number(),
  }),
  reasons: z.array(z.string().max(500)).max(16),
  conflicts: z.array(z.string().max(500)).max(16),
  hardRejects: z.array(
    z.enum([
      "unsafe",
      "operator_rejected",
      "identifier_conflict",
      "dimension_conflict",
      "product_family_conflict",
      "identity_missing",
    ]),
  ),
  aiOverrideEligible: z.boolean(),
});

const guardedCandidateInput = webSearchResultInput.extend({
  baseRankScore: z.number().optional(),
  rrfScore: z.number().optional(),
  matchedQueries: z
    .array(
      z.object({
        query: z.string().max(1_000),
        intent: z.string().max(100),
        rank: z.number().int().positive(),
      }),
    )
    .max(16)
    .optional(),
  assessment: materialAssessmentInput.optional(),
  fetchStatus: z.enum(["verified", "unverified", "failed"]).optional(),
});

export const materialEnrichmentProcedures = {
  enrichPreviewXlsx: protectedProcedure
    .input(
      z.object({
        fileName: z.string().min(1).default("materials.xlsx"),
        workbookBase64: z.string().min(1),
        sheetName: z.string().optional(),
        headerRowIndex: z.number().int().min(1).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const workbook = await parseWorkbookBase64(
        input.fileName,
        input.workbookBase64,
      );
      const selectedSheet = selectWorkbookSheet(workbook, input.sheetName);
      if (!selectedSheet) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Không tìm thấy trang tính hợp lệ.",
        });
      }

      return {
        selectedSheetName: selectedSheet.name,
        warnings: workbook.warnings,
        sheets: workbook.sheets.map((sheet) => {
          const active =
            sheet.name === selectedSheet.name && input.headerRowIndex
              ? rebuildSheetWithHeaderRow(sheet, input.headerRowIndex)
              : sheet;
          return {
            name: active.name,
            detectedHeaderRowIndex: active.detectedHeaderRowIndex,
            activeHeaderRowIndex: active.activeHeaderRowIndex,
            rowCount: active.rows.length,
            headers: active.headers.slice(0, 60),
            suggestedMapping: active.suggestedMapping,
            warnings: active.warnings,
            previewRows: active.previewRows.slice(0, 12).map((values, i) => ({
              key: i,
              values,
            })),
          };
        }),
      };
    }),

  enrichMatchRows: protectedProcedure
    .input(
      z.object({
        fileName: z.string().min(1).default("materials.xlsx"),
        workbookBase64: z.string().min(1),
        sheetName: z.string().optional(),
        headerRowIndex: z.number().int().min(1).optional(),
        mapping: z.record(z.string(), z.string().nullable()),
        minSimilarity: z.number().min(0).max(1).default(0.1),
        limit: z.number().int().min(1).max(20).default(8),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const workbook = await parseWorkbookBase64(
        input.fileName,
        input.workbookBase64,
      );
      const baseSheet = selectWorkbookSheet(workbook, input.sheetName);
      if (!baseSheet) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Không tìm thấy trang tính hợp lệ.",
        });
      }
      const sheet: ParsedWorkbookSheet = input.headerRowIndex
        ? rebuildSheetWithHeaderRow(baseSheet, input.headerRowIndex)
        : baseSheet;

      let rows;
      try {
        rows = extractRowFields(sheet, input.mapping as ColumnMapping);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Không đọc được dòng dữ liệu.",
        });
      }

      const truncated = rows.length > MAX_ENRICH_ROWS;
      const limitedRows = truncated ? rows.slice(0, MAX_ENRICH_ROWS) : rows;

      const results = await matchRows(ctx.db, limitedRows, {
        minSimilarity: input.minSimilarity,
        limit: input.limit,
      });

      const rowByIndex = new Map(
        limitedRows.map((row) => [row.originalRowIndex, row]),
      );
      const resultsWithRow = results.map((result) => {
        const source = rowByIndex.get(result.originalRowIndex);
        return {
          ...result,
          name: source?.name ?? "",
          sheetFields: source?.fields ?? {},
        };
      });

      const summary = results.reduce(
        (acc, r) => {
          acc[r.status] += 1;
          acc.fieldsToFill += r.fillPlan.filter(
            (cell) => cell.action === "filled",
          ).length;
          return acc;
        },
        { auto: 0, review: 0, unmatched: 0, fieldsToFill: 0 },
      );

      return {
        sheetName: sheet.name,
        thresholds: ENRICH_THRESHOLDS,
        totalRows: rows.length,
        matchedRows: limitedRows.length,
        truncated,
        summary,
        results: resultsWithRow,
      };
    }),

  enrichSearchMaterials: protectedProcedure
    .input(
      z.object({
        query: z.string().trim().min(1),
        limit: z.number().int().min(1).max(20).default(8),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(materials)
        .where(
          and(
            isNull(materials.deletedAt),
            ilike(materials.name, `%${input.query}%`),
          ),
        )
        .orderBy(asc(materials.name))
        .limit(input.limit);

      return {
        candidates: rows.map((row) => ({
          materialId: row.id,
          name: row.name,
          code: row.code,
          unit: row.unit,
          category: row.category,
          manufacturer: row.manufacturer,
          originCountry: row.originCountry,
          defaultUnitPrice: row.defaultUnitPrice,
          currency: row.currency,
          imageUrl: row.imageUrl,
          sourceUrl: row.sourceUrl,
          specSnippet: (row.specText ?? "").slice(0, 120),
          score: 0,
          breakdown: null,
        })),
      };
    }),

  enrichWebSearchRowLinks: protectedProcedure
    .input(enrichWebRowInput)
    .mutation(async ({ input }) => {
      const [domainPolicy, queryControls] = await Promise.all([
        resolveSearchDomainPolicy(),
        resolveSearchQueryControls(),
      ]);
      const queries = buildSearchQueries(
        {
          name: input.name,
          manufacturer: input.manufacturer,
          code: input.code,
          specText: input.specText,
          unit: input.unit,
          category: input.category,
          originCountry: input.originCountry,
        },
        {
          context: "interactive",
          domainPolicy,
          queryControls,
        },
      ).map((query) => query.query);

      if (queries.length === 0) {
        return { results: [], warnings: [] };
      }

      const response = await searchWebForProduct(queries, undefined, {
        feature: "interactive",
      });
      const results = rankSearchResults(
        response.results,
        {
          manufacturer: input.manufacturer ?? null,
          name: input.name,
          code: input.code ?? null,
          sourceUrl: null,
        },
        response.domainPolicy ?? domainPolicy,
      ).slice(0, 8);

      return { results, warnings: response.warnings };
    }),

  enrichProfileSearchRow: protectedProcedure
    .input(enrichWebRowInput)
    .mutation(async ({ input }) => {
      return enrichProfileRowSearch(input);
    }),

  enrichProfileSearchRowLinks: protectedProcedure
    .input(enrichWebRowInput)
    .mutation(({ input }) => searchProfileRowWebLinks(input)),

  enrichProfileRerankLinks: protectedProcedure
    .input(
      z.object({
        row: enrichWebRowInput,
        candidates: z.array(guardedCandidateInput).min(1).max(5),
      }),
    )
    .mutation(async ({ input }) => {
      // Re-run the guarded retrieval server-side and only accept URLs that are
      // still present; client-provided snippets/assessments are not trusted.
      const fresh = await searchProfileRowWebLinks(input.row);
      const requested = new Set(
        input.candidates.map((candidate) => candidate.url),
      );
      return rerankAmbiguousMaterialLinks({
        identity:
          fresh.identity ?? buildProfileSearchQueryWaves(input.row).identity,
        candidates: fresh.webLinkResults.filter((candidate) =>
          requested.has(candidate.url),
        ),
      });
    }),

  enrichAiSearchRow: protectedProcedure
    .input(
      enrichWebRowInput.extend({
        webResults: z.array(webSearchResultInput).min(1).max(12),
      }),
    )
    .mutation(async ({ input }) => {
      const result = await enrichRowFromWebResults(input);
      return result;
    }),

  enrichWebSearchRow: protectedProcedure
    .input(enrichWebRowInput)
    .mutation(async ({ input }) => {
      const result = await enrichRowFromWeb(input);
      return result;
    }),

  enrichExportXlsx: requirePermission("material:write")
    .input(
      z.object({
        fileName: z.string().min(1).default("materials.xlsx"),
        workbookBase64: z.string().min(1),
        sheetName: z.string().min(1),
        headerRowIndex: z.number().int().min(1),
        mapping: z.record(z.string(), z.string().nullable()),
        mode: z.enum(["preserve", "clean"]).default("preserve"),
        decisions: z
          .array(
            z.object({
              originalRowIndex: z.number().int().min(1),
              materialId: z.number().int().positive().nullable(),
              fields: z.array(z.enum(FILLABLE_FIELDS)),
              overwriteFields: z.array(z.enum(FILLABLE_FIELDS)).optional(),
              valueOverrides: z
                .record(z.enum(FILLABLE_FIELDS), z.string())
                .optional(),
            }),
          )
          .max(MAX_ENRICH_ROWS),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const materialIds = Array.from(
        new Set(
          input.decisions
            .map((d) => d.materialId)
            .filter((id): id is number => id != null),
        ),
      );

      const materialRows = materialIds.length
        ? await ctx.db
            .select()
            .from(materials)
            .where(
              and(
                inArray(materials.id, materialIds),
                isNull(materials.deletedAt),
              ),
            )
        : [];
      const materialsById = new Map(materialRows.map((row) => [row.id, row]));

      const buffer = await writeEnrichedWorkbook({
        workbookBase64: input.workbookBase64,
        sheetName: input.sheetName,
        mapping: input.mapping as ColumnMapping,
        headerRowIndex: input.headerRowIndex,
        decisions: input.decisions.map((d) => ({
          originalRowIndex: d.originalRowIndex,
          materialId: d.materialId,
          fields: d.fields,
          overwriteFields: d.overwriteFields,
          valueOverrides: d.valueOverrides,
        })),
        materialsById,
        mode: input.mode,
      });

      const baseName = input.fileName.replace(/\.xlsx$/i, "");
      return {
        fileName: `${baseName}-enriched.xlsx`,
        workbookBase64: buffer.toString("base64"),
      };
    }),
};
