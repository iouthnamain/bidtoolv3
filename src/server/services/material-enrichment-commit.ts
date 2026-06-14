import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { buildFillPlan } from "~/lib/materials/excel-enrich-fields";
import {
  ENRICHABLE_FIELDS,
  type EnrichableField,
  type MaterialEnrichmentFilterOptions,
  type MaterialEnrichmentResult,
} from "~/lib/materials/material-enrichment-types";
import {
  buildMaterialMetadata,
  normalizeMaterialMetadata,
  type MaterialFieldLockKey,
} from "~/lib/material-price-sources";
import type { db as appDb } from "~/server/db";
import {
  materialEnrichmentEvents,
  materialEnrichmentItems,
  materials,
} from "~/server/db/schema";
import { attachCatalogPdfUrlsToMaterial } from "~/server/services/catalog-documents";

type AppDb = typeof appDb;
type MaterialRow = typeof materials.$inferSelect;

export type MaterialUpdatePlanCell = {
  field: EnrichableField;
  before: string;
  after: string;
  action: "filled" | "kept" | "missing-both" | "overwritten";
  confidence: number;
  evidenceCount: number;
};

const FIELD_TO_LOCK_KEY: Record<EnrichableField, MaterialFieldLockKey> = {
  category: "category",
  specText: "specText",
  manufacturer: "manufacturer",
  originCountry: "originCountry",
  unit: "unit",
  sourceUrl: "sourceUrl",
};

function trimmedOrEmpty(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function materialFieldValue(material: MaterialRow, field: EnrichableField) {
  switch (field) {
    case "category":
      return material.category;
    case "specText":
      return material.specText;
    case "manufacturer":
      return material.manufacturer;
    case "originCountry":
      return material.originCountry;
    case "unit":
      return material.unit;
    case "sourceUrl":
      return material.sourceUrl;
    default:
      return null;
  }
}

function isFieldLocked(
  locks: Partial<Record<MaterialFieldLockKey, boolean>>,
  field: EnrichableField,
) {
  return locks[FIELD_TO_LOCK_KEY[field]] === true;
}

function applyLockedFillEmptyField(
  locks: Partial<Record<MaterialFieldLockKey, boolean>>,
  field: EnrichableField,
  existing: string | null | undefined,
  proposed: string | null | undefined,
) {
  if (isFieldLocked(locks, field)) {
    return existing ?? undefined;
  }
  const existingTrimmed = existing?.trim();
  if (existingTrimmed) {
    return existing ?? undefined;
  }
  const proposedTrimmed = proposed?.trim();
  return proposedTrimmed ? (proposed ?? undefined) : (existing ?? undefined);
}

export function buildMaterialUpdatePlan(
  result: MaterialEnrichmentResult,
  fieldLocks: Partial<Record<MaterialFieldLockKey, boolean>>,
  material: MaterialRow,
  options: MaterialEnrichmentFilterOptions,
): MaterialUpdatePlanCell[] {
  const currentFields = Object.fromEntries(
    ENRICHABLE_FIELDS.map((field) => [
      field,
      trimmedOrEmpty(materialFieldValue(material, field)),
    ]),
  ) as Partial<Record<EnrichableField, string>>;

  const proposedFields = Object.fromEntries(
    ENRICHABLE_FIELDS.map((field) => {
      const extracted = result.fields[field];
      return [field, trimmedOrEmpty(extracted?.matchedOption ?? extracted?.value)];
    }),
  ) as Partial<Record<EnrichableField, string>>;

  const fillPlan = buildFillPlan(currentFields, proposedFields);
  const planByField = new Map(fillPlan.map((cell) => [cell.field, cell]));

  return ENRICHABLE_FIELDS.flatMap((field) => {
    if (isFieldLocked(fieldLocks, field)) {
      const before = trimmedOrEmpty(materialFieldValue(material, field));
      if (!before) {
        return [];
      }
      return [
        {
          field,
          before,
          after: before,
          action: "kept" as const,
          confidence: result.fields[field]?.confidence ?? 0,
          evidenceCount: result.fields[field]?.evidence.length ?? 0,
        },
      ];
    }

    const cell = planByField.get(field);
    if (!cell) {
      return [];
    }

    if (
      (field === "category" || field === "manufacturer" || field === "originCountry" || field === "unit") &&
      cell.action === "filled" &&
      cell.after
    ) {
      const allowed =
        field === "category"
          ? options.categories
          : field === "manufacturer"
            ? options.manufacturers
            : field === "originCountry"
              ? options.origins
              : options.units;
      if (allowed.length > 0 && !allowed.includes(cell.after)) {
        return [];
      }
    }

    return [
      {
        field,
        before: cell.before,
        after: cell.after,
        action: cell.action,
        confidence: result.fields[field]?.confidence ?? 0,
        evidenceCount: result.fields[field]?.evidence.length ?? 0,
      },
    ];
  });
}

async function logEnrichmentEvent(
  db: AppDb,
  input: {
    jobId: string;
    itemId: number;
    materialId: number;
    field: string;
    beforeValue: string | null;
    afterValue: string | null;
    action: string;
    evidenceJson?: Record<string, unknown>;
  },
) {
  await db.insert(materialEnrichmentEvents).values({
    jobId: input.jobId,
    itemId: input.itemId,
    materialId: input.materialId,
    field: input.field,
    beforeValue: input.beforeValue,
    afterValue: input.afterValue,
    action: input.action,
    evidenceJson: input.evidenceJson ?? {},
  });
}

export async function commitEnrichmentItem(
  db: AppDb,
  itemId: number,
  options: { autoCommitHighConfidence?: boolean } = {},
) {
  const [item] = await db
    .select()
    .from(materialEnrichmentItems)
    .where(eq(materialEnrichmentItems.id, itemId))
    .limit(1);

  if (!item) {
    throw new Error("Không tìm thấy dòng enrichment.");
  }

  const [material] = await db
    .select()
    .from(materials)
    .where(and(eq(materials.id, item.materialId), isNull(materials.deletedAt)))
    .limit(1);

  if (!material) {
    throw new Error("Không tìm thấy vật tư để cập nhật.");
  }

  const result = item.resultJson as MaterialEnrichmentResult;
  const metadata = normalizeMaterialMetadata(material.metadataJson);
  const locks = metadata.fieldLocks ?? {};
  const update: Partial<typeof materials.$inferInsert> = {};
  const now = new Date().toISOString();

  for (const field of ENRICHABLE_FIELDS) {
    const extracted = result.fields[field];
    const proposed = extracted?.matchedOption ?? extracted?.value ?? null;
    const existing = materialFieldValue(material, field);
    const nextValue = applyLockedFillEmptyField(locks, field, existing, proposed);
    if (nextValue === undefined) {
      continue;
    }
    const before = trimmedOrEmpty(existing);
    const after = trimmedOrEmpty(nextValue);
    if (before === after) {
      continue;
    }

    switch (field) {
      case "category":
        update.category = after || null;
        break;
      case "specText":
        update.specText = after;
        break;
      case "manufacturer":
        update.manufacturer = after || null;
        break;
      case "originCountry":
        update.originCountry = after || null;
        break;
      case "unit":
        update.unit = after || material.unit;
        break;
      case "sourceUrl":
        update.sourceUrl = after || null;
        break;
      default:
        break;
    }

    await logEnrichmentEvent(db, {
      jobId: item.jobId,
      itemId: item.id,
      materialId: item.materialId,
      field,
      beforeValue: before || null,
      afterValue: after || null,
      action: before ? "overwrite_blocked" : "filled",
      evidenceJson: {
        confidence: extracted?.confidence ?? 0,
        evidence: extracted?.evidence ?? [],
        autoCommit: options.autoCommitHighConfidence ?? false,
      },
    });
  }

  if (Object.keys(update).length > 0) {
    await db
      .update(materials)
      .set({
        ...update,
        metadataJson: buildMaterialMetadata(metadata),
        updatedAt: now,
      })
      .where(eq(materials.id, material.id));
  }

  if (result.catalogPdfUrls.length > 0) {
    const attached = await attachCatalogPdfUrlsToMaterial(
      db,
      result.catalogPdfUrls,
      material.id,
      {
        sourceType: "detected",
        linkSource: "manual",
        supplier: result.fields.manufacturer?.matchedOption ?? result.fields.manufacturer?.value ?? material.manufacturer,
      },
    );
    if (attached.linked > 0) {
      await logEnrichmentEvent(db, {
        jobId: item.jobId,
        itemId: item.id,
        materialId: item.materialId,
        field: "catalogPdfUrls",
        beforeValue: null,
        afterValue: String(attached.linked),
        action: "attach_pdf",
        evidenceJson: { urls: result.catalogPdfUrls },
      });
    }
  }

  const [committed] = await db
    .update(materialEnrichmentItems)
    .set({
      status: "committed",
      committedAt: now,
      updatedAt: now,
    })
    .where(eq(materialEnrichmentItems.id, itemId))
    .returning();

  return committed;
}
