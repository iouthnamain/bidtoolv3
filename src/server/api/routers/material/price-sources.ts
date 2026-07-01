import { randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { requirePermission } from "~/server/api/trpc";
import { materials } from "~/server/db/schema";
import {
  buildMaterialMetadata,
  fetchPriceFromUrl,
  normalizeMaterialMetadata,
  type MaterialPriceSource,
} from "~/server/services/material-price-sources";
import {
  getActiveMaterialById,
  requireUpdatedMaterial,
} from "~/server/api/routers/material/records";

const priceSourceBaseInput = z.object({
  label: z.string().trim().min(1),
  url: z.string().trim().optional().default(""),
  mode: z.enum(["linked", "fixed"]).default("linked"),
  fixedPrice: z.number().nonnegative().nullable().optional(),
  currency: z.string().trim().min(1).default("VND"),
  note: z.string().trim().optional().default(""),
  isPrimary: z.boolean().default(false),
});

const priceSourceInput = priceSourceBaseInput.superRefine((source, ctx) => {
  validatePriceSourceShape(source, ctx);
});

function validatePriceSourceShape(
  source: {
    mode: "linked" | "fixed";
    url?: string | null;
    fixedPrice?: number | null;
  },
  ctx: z.RefinementCtx,
) {
  if (source.mode === "linked" && !source.url?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["url"],
      message: "Nguồn theo link cần có URL.",
    });
  }

  if (source.mode === "fixed" && source.fixedPrice == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["fixedPrice"],
      message: "Nguồn giá cố định cần có giá.",
    });
  }
}

function assertValidPriceSource(source: MaterialPriceSource) {
  if (source.mode === "linked" && source.url.trim().length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Nguồn theo link cần có URL.",
    });
  }

  if (source.mode === "fixed" && source.fixedPrice == null) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Nguồn giá cố định cần có giá.",
    });
  }
}

function normalizePrimarySources(
  sources: MaterialPriceSource[],
  primaryId?: string,
) {
  if (sources.length === 0) {
    return sources;
  }

  const targetPrimaryId =
    primaryId ?? sources.find((source) => source.isPrimary)?.id;
  if (!targetPrimaryId) {
    return sources;
  }

  return sources.map((source) => ({
    ...source,
    isPrimary: source.id === targetPrimaryId,
  }));
}

export const priceSourceProcedures = {
  addPriceSource: requirePermission("material:write")
    .input(
      z.object({
        materialId: z.number().int().positive(),
        source: priceSourceInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const material = await getActiveMaterialById(ctx.db, input.materialId);
      const metadata = normalizeMaterialMetadata(material.metadataJson);
      const now = new Date().toISOString();
      const source: MaterialPriceSource = {
        id: randomUUID(),
        label: input.source.label,
        url: input.source.url ?? "",
        mode: input.source.mode,
        fixedPrice: input.source.fixedPrice ?? null,
        lastPrice: null,
        lastPriceText: null,
        currency: input.source.currency,
        lastCheckedAt: null,
        note: input.source.note ?? "",
        isPrimary: input.source.isPrimary || metadata.priceSources.length === 0,
      };
      const priceSources = normalizePrimarySources(
        [...metadata.priceSources, source],
        source.isPrimary ? source.id : undefined,
      );
      const shouldApplyFixedPrice =
        source.isPrimary &&
        source.mode === "fixed" &&
        source.fixedPrice != null;

      const [updated] = await ctx.db
        .update(materials)
        .set({
          metadataJson: {
            ...material.metadataJson,
            ...buildMaterialMetadata({ priceSources }),
          },
          sourceUrl:
            source.isPrimary && source.url ? source.url : material.sourceUrl,
          defaultUnitPrice: shouldApplyFixedPrice
            ? source.fixedPrice
            : material.defaultUnitPrice,
          currency: shouldApplyFixedPrice ? source.currency : material.currency,
          updatedAt: now,
        })
        .where(
          and(eq(materials.id, input.materialId), isNull(materials.deletedAt)),
        )
        .returning();

      return { material: requireUpdatedMaterial(updated), source };
    }),

  updatePriceSource: requirePermission("material:write")
    .input(
      z.object({
        materialId: z.number().int().positive(),
        sourceId: z.string().min(1),
        patch: priceSourceBaseInput.partial(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const material = await getActiveMaterialById(ctx.db, input.materialId);
      const metadata = normalizeMaterialMetadata(material.metadataJson);
      const existing = metadata.priceSources.find(
        (source) => source.id === input.sourceId,
      );
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy link giá.",
        });
      }

      const nextSource: MaterialPriceSource = {
        ...existing,
        ...input.patch,
        fixedPrice:
          input.patch.fixedPrice === undefined
            ? existing.fixedPrice
            : (input.patch.fixedPrice ?? null),
        note: input.patch.note ?? existing.note,
        url: input.patch.url ?? existing.url,
        label: input.patch.label ?? existing.label,
        currency: input.patch.currency ?? existing.currency,
        mode: input.patch.mode ?? existing.mode,
        isPrimary: input.patch.isPrimary ?? existing.isPrimary,
      };
      assertValidPriceSource(nextSource);
      const priceSources = normalizePrimarySources(
        metadata.priceSources.map((source) =>
          source.id === input.sourceId ? nextSource : source,
        ),
        nextSource.isPrimary ? nextSource.id : undefined,
      );
      const primary = priceSources.find((source) => source.isPrimary);

      const [updated] = await ctx.db
        .update(materials)
        .set({
          metadataJson: {
            ...material.metadataJson,
            ...buildMaterialMetadata({ priceSources }),
          },
          sourceUrl:
            primary?.url != null && primary.url.length > 0
              ? primary.url
              : material.sourceUrl,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(eq(materials.id, input.materialId), isNull(materials.deletedAt)),
        )
        .returning();

      return { material: requireUpdatedMaterial(updated), source: nextSource };
    }),

  deletePriceSource: requirePermission("material:write")
    .input(
      z.object({
        materialId: z.number().int().positive(),
        sourceId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const material = await getActiveMaterialById(ctx.db, input.materialId);
      const metadata = normalizeMaterialMetadata(material.metadataJson);
      const priceSources = metadata.priceSources.filter(
        (source) => source.id !== input.sourceId,
      );
      if (priceSources.length === metadata.priceSources.length) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy link giá.",
        });
      }

      const deletedSource = metadata.priceSources.find(
        (source) => source.id === input.sourceId,
      );
      const normalizedSources =
        priceSources.some((source) => source.isPrimary) ||
        priceSources.length === 0
          ? priceSources
          : priceSources.map((source, index) => ({
              ...source,
              isPrimary: index === 0,
            }));
      const primary = normalizedSources.find((source) => source.isPrimary);
      const deletedSourceUrl = deletedSource?.url.trim();
      const currentSourceUrl = material.sourceUrl?.trim();
      const shouldClearCurrentSourceUrl =
        deletedSourceUrl != null &&
        deletedSourceUrl.length > 0 &&
        currentSourceUrl === deletedSourceUrl;
      const nextSourceUrl =
        shouldClearCurrentSourceUrl && primary?.url.trim()
          ? primary.url
          : shouldClearCurrentSourceUrl
            ? null
            : material.sourceUrl;

      const [updated] = await ctx.db
        .update(materials)
        .set({
          metadataJson: {
            ...material.metadataJson,
            ...buildMaterialMetadata({ priceSources: normalizedSources }),
          },
          sourceUrl: nextSourceUrl,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(eq(materials.id, input.materialId), isNull(materials.deletedAt)),
        )
        .returning();

      return requireUpdatedMaterial(updated);
    }),

  refreshPriceSource: requirePermission("material:write")
    .input(
      z.object({
        materialId: z.number().int().positive(),
        sourceId: z.string().min(1),
        updateDefaultPrice: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const material = await getActiveMaterialById(ctx.db, input.materialId);
      const metadata = normalizeMaterialMetadata(material.metadataJson);
      const source = metadata.priceSources.find(
        (item) => item.id === input.sourceId,
      );
      if (!source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy link giá.",
        });
      }
      if (source.mode !== "linked" || !source.url) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Nguồn giá này không phải link có thể cập nhật.",
        });
      }

      let result: Awaited<ReturnType<typeof fetchPriceFromUrl>>;
      try {
        result = await fetchPriceFromUrl(source.url);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Không thể đọc giá từ link sản phẩm.",
        });
      }
      const checkedAt = new Date().toISOString();
      const nextSource: MaterialPriceSource = {
        ...source,
        lastPrice: result.price,
        lastPriceText: result.priceText,
        lastCheckedAt: checkedAt,
      };
      const priceSources = metadata.priceSources.map((item) =>
        item.id === source.id ? nextSource : item,
      );
      const nextDefaultPrice =
        input.updateDefaultPrice && result.price != null
          ? result.price
          : material.defaultUnitPrice;

      const [updated] = await ctx.db
        .update(materials)
        .set({
          metadataJson: {
            ...material.metadataJson,
            ...buildMaterialMetadata({ priceSources }),
          },
          defaultUnitPrice: nextDefaultPrice,
          sourceUrl: source.isPrimary ? source.url : material.sourceUrl,
          updatedAt: checkedAt,
        })
        .where(
          and(eq(materials.id, input.materialId), isNull(materials.deletedAt)),
        )
        .returning();

      return { material: requireUpdatedMaterial(updated), source: nextSource };
    }),

  applyPriceSourcePrice: requirePermission("material:write")
    .input(
      z.object({
        materialId: z.number().int().positive(),
        sourceId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const material = await getActiveMaterialById(ctx.db, input.materialId);
      const metadata = normalizeMaterialMetadata(material.metadataJson);
      const source = metadata.priceSources.find(
        (item) => item.id === input.sourceId,
      );
      if (!source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy link giá.",
        });
      }

      const price =
        source.mode === "fixed" ? source.fixedPrice : source.lastPrice;
      if (price == null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Nguồn giá chưa có giá để áp dụng.",
        });
      }

      const [updated] = await ctx.db
        .update(materials)
        .set({
          defaultUnitPrice: price,
          currency: source.currency,
          sourceUrl: source.url.trim() ? source.url : material.sourceUrl,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(eq(materials.id, input.materialId), isNull(materials.deletedAt)),
        )
        .returning();

      return requireUpdatedMaterial(updated);
    }),
};
