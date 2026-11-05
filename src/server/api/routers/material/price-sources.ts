import { randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { requirePermission } from "~/server/api/trpc";
import {
  fetchPriceFromUrl,
  mergeMaterialMetadata,
  normalizeMaterialMetadata,
  type MaterialPriceSource,
} from "~/server/services/material-price-sources";
import {
  lockMaterialForUpdate,
  updateLockedMaterial,
} from "~/server/services/material-write";
import {
  getActiveMaterialById,
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
      return ctx.db.transaction(async (tx) => {
        const material = await lockMaterialForUpdate(tx, input.materialId);
        const metadata = normalizeMaterialMetadata(material.metadataJson);
        const source: MaterialPriceSource = {
          id: randomUUID(),
          label: input.source.label,
          url: input.source.url ?? "",
          mode: input.source.mode,
          fixedPrice: input.source.fixedPrice ?? null,
          lastPrice: null,
          lastPriceText: null,
          lastCheckedAt: null,
          currency: input.source.currency,
          note: input.source.note ?? "",
          isPrimary:
            input.source.isPrimary || metadata.priceSources.length === 0,
        };
        const priceSources = normalizePrimarySources(
          [...metadata.priceSources, source],
          source.isPrimary ? source.id : undefined,
        );
        const shouldApplyFixedPrice =
          source.isPrimary &&
          source.mode === "fixed" &&
          source.fixedPrice != null;
        const updated = await updateLockedMaterial(tx, material, {
          metadataJson: mergeMaterialMetadata(material.metadataJson, {
            priceSources,
          }),
          sourceUrl:
            source.isPrimary && source.url ? source.url : material.sourceUrl,
          ...(shouldApplyFixedPrice
            ? {
                defaultUnitPrice: source.fixedPrice,
                currency: source.currency,
              }
            : {}),
        });
        return { material: updated, source };
      });
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
      return ctx.db.transaction(async (tx) => {
        const material = await lockMaterialForUpdate(tx, input.materialId);
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
        const updated = await updateLockedMaterial(tx, material, {
          metadataJson: mergeMaterialMetadata(material.metadataJson, {
            priceSources,
          }),
          sourceUrl:
            primary?.url != null && primary.url.length > 0
              ? primary.url
              : material.sourceUrl,
        });
        return { material: updated, source: nextSource };
      });
    }),

  deletePriceSource: requirePermission("material:write")
    .input(
      z.object({
        materialId: z.number().int().positive(),
        sourceId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction(async (tx) => {
        const material = await lockMaterialForUpdate(tx, input.materialId);
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
        return updateLockedMaterial(tx, material, {
          metadataJson: mergeMaterialMetadata(material.metadataJson, {
            priceSources: normalizedSources,
          }),
          sourceUrl: nextSourceUrl,
        });
      });
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
      return ctx.db.transaction(async (tx) => {
        const current = await lockMaterialForUpdate(tx, input.materialId);
        const currentMetadata = normalizeMaterialMetadata(current.metadataJson);
        const currentSource = currentMetadata.priceSources.find(
          (item) => item.id === input.sourceId,
        );
        if (!currentSource) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Nguồn giá đã bị xóa trong lúc đang cập nhật.",
          });
        }
        if (currentSource.url !== source.url) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "URL nguồn giá đã thay đổi trong lúc đang cập nhật.",
          });
        }
        const nextSource: MaterialPriceSource = {
          ...currentSource,
          lastPrice: result.price,
          lastPriceText: result.priceText,
          lastCheckedAt: checkedAt,
        };
        const priceSources = currentMetadata.priceSources.map((item) =>
          item.id === nextSource.id ? nextSource : item,
        );
        const update: Record<string, unknown> = {
          metadataJson: mergeMaterialMetadata(current.metadataJson, {
            priceSources,
          }),
          sourceUrl: currentSource.isPrimary
            ? currentSource.url
            : current.sourceUrl,
        };
        if (input.updateDefaultPrice && result.price != null) {
          update.defaultUnitPrice = result.price;
        }
        const updated = await updateLockedMaterial(tx, current, update, {
          now: checkedAt,
        });
        return { material: updated, source: nextSource };
      });
    }),

  applyPriceSourcePrice: requirePermission("material:write")
    .input(
      z.object({
        materialId: z.number().int().positive(),
        sourceId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction(async (tx) => {
        const material = await lockMaterialForUpdate(tx, input.materialId);
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
        return updateLockedMaterial(tx, material, {
          defaultUnitPrice: price,
          currency: source.currency,
          sourceUrl: source.url.trim() ? source.url : material.sourceUrl,
        });
      });
    }),
};
