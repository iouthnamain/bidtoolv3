import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { buildFillPlan, type FillableField } from "~/lib/materials/excel-enrich-fields";
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
  price: "defaultUnitPrice",
  sourceUrl: "sourceUrl",
};

/**
 * The fill-plan model (FillableField) names the price column `defaultUnitPrice`
 * while the enrichment model uses `price`. Keep a single source of truth for
 * translating between the two when reusing buildFillPlan.
 */
const ENRICHABLE_TO_FILLABLE: Record<EnrichableField, FillableField> = {
  category: "category",
  specText: "specText",
  manufacturer: "manufacturer",
  originCountry: "originCountry",
  unit: "unit",
  price: "defaultUnitPrice",
  sourceUrl: "sourceUrl",
};

function trimmedOrEmpty(value: string | null | undefined) {
  return value?.trim() ?? "";
}

/**
 * Parse an LLM/string price into a positive integer value. Strips currency
 * symbols and thousands separators. Returns null when no sensible positive
 * number can be derived, so commit never zeroes out an existing price.
 */
export function parseEnrichmentPrice(value: string | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return null;
  }
  const numericText = trimmed.replace(/[^\d.,]/g, "");
  if (!numericText) {
    return null;
  }
  const digitsOnly = numericText.replace(/[.,]/g, "");
  const parsed = Number(digitsOnly);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
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
    case "price":
      return material.defaultUnitPrice != null
        ? String(material.defaultUnitPrice)
        : null;
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
      ENRICHABLE_TO_FILLABLE[field],
      trimmedOrEmpty(materialFieldValue(material, field)),
    ]),
  ) as Partial<Record<FillableField, string>>;

  const proposedFields = Object.fromEntries(
    ENRICHABLE_FIELDS.map((field) => {
      const extracted = result.fields[field];
      return [
        ENRICHABLE_TO_FILLABLE[field],
        trimmedOrEmpty(extracted?.matchedOption ?? extracted?.value),
      ];
    }),
  ) as Partial<Record<FillableField, string>>;

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

    const cell = planByField.get(ENRICHABLE_TO_FILLABLE[field]);
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
      case "price": {
        const parsedPrice = parseEnrichmentPrice(after);
        if (parsedPrice == null) {
          // Could not parse a sane number — skip the write and event log so we
          // never zero out or corrupt an existing price.
          continue;
        }
        update.defaultUnitPrice = parsedPrice;
        break;
      }
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
