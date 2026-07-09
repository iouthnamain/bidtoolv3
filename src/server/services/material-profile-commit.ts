import "server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { isExportableDecision } from "~/lib/materials/enrich-gap-fill";
import type { FillableField } from "~/lib/materials/excel-enrich-fields";
import {
  deserializeRowDecision,
  seedDecisionFromItem,
  type RowDecision,
} from "~/lib/materials/review-decision";
import {
  buildMaterialMetadata,
  normalizeMaterialMetadata,
  type MaterialFieldLockKey,
} from "~/lib/material-price-sources";
import type { db as appDb } from "~/server/db";
import { excelWorkspaceItems, excelWorkspaces, materials } from "~/server/db/schema";
import { attachCatalogPdfUrlsToMaterial } from "~/server/services/catalog-documents";
import { parseEnrichmentPrice } from "~/server/services/material-enrichment-commit";
import { createLogger, traceFn } from "~/server/lib/logger";

const log = createLogger("services-material-profile-commit");

export class MaterialProfileCommitError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "BAD_REQUEST" | "CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "MaterialProfileCommitError";
  }
}

type AppDb = typeof appDb;
type DbOrTx = AppDb | Parameters<Parameters<AppDb["transaction"]>[0]>[0];
type WorkspaceItem = typeof excelWorkspaceItems.$inferSelect;
type MaterialRow = typeof materials.$inferSelect;

export const PROFILE_COMMIT_SOURCE = "profile_save" as const;

export type MaterialProfileCommitItemResult = {
  itemId: number;
  originalRowIndex: number;
  productName: string;
  status: "inserted" | "updated" | "linked" | "skipped" | "failed";
  materialId: number | null;
  message?: string;
};

export type MaterialProfileCommitSummary = {
  selectedCount: number;
  inserted: number;
  updated: number;
  linked: number;
  skipped: number;
  failed: number;
  results: MaterialProfileCommitItemResult[];
};

const LOCK_KEY_BY_FIELD: Partial<Record<FillableField, MaterialFieldLockKey>> = {
  code: "code",
  category: "category",
  specText: "specText",
  manufacturer: "manufacturer",
  originCountry: "originCountry",
  unit: "unit",
  defaultUnitPrice: "defaultUnitPrice",
  sourceUrl: "sourceUrl",
};

function trimmed(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function nameUnitKey(name: string, unit: string) {
  return `${name.trim().toLowerCase()}|${unit.trim().toLowerCase()}`;
}

function decisionFieldValue(
  decision: RowDecision,
  field: FillableField,
): string {
  const edited = decision.editedValues?.[field];
  if (typeof edited === "string" && edited.trim()) return edited.trim();
  const proposed = decision.webProposedFields?.[field];
  if (typeof proposed === "string" && proposed.trim()) return proposed.trim();
  return "";
}

function resolvedMaterialFields(
  item: WorkspaceItem,
  decision: RowDecision,
): {
  name: string;
  unit: string;
  code: string | null;
  category: string | null;
  specText: string;
  manufacturer: string | null;
  originCountry: string | null;
  defaultUnitPrice: number | null;
  currency: string;
  sourceUrl: string | null;
  catalogPdfUrls: string[];
} {
  const original =
    item.originalDataJson && typeof item.originalDataJson === "object"
      ? (item.originalDataJson as Record<string, unknown>)
      : {};

  const pick = (field: FillableField, fallback = "") => {
    if (decision.acceptedFields.has(field)) {
      const fromDecision = decisionFieldValue(decision, field);
      if (fromDecision) return fromDecision;
    }
    const fromOriginal = original[field];
    if (typeof fromOriginal === "string" && fromOriginal.trim()) {
      return fromOriginal.trim();
    }
    return fallback;
  };

  const name = trimmed(item.productName) || pick("code") || `Dòng ${item.originalRowIndex}`;
  const unit =
    pick("unit", trimmed(item.unit)) ||
    trimmed(item.unit) ||
    "cái";
  const priceRaw = pick(
    "defaultUnitPrice",
    item.unitPrice == null ? "" : String(item.unitPrice),
  );
  const parsedPrice = parseEnrichmentPrice(priceRaw);

  return {
    name,
    unit,
    code: pick("code") || null,
    category: pick("category") || null,
    specText: pick("specText", trimmed(item.specText)),
    manufacturer:
      pick("manufacturer", trimmed(item.vendorHint)) || null,
    originCountry:
      pick("originCountry", trimmed(item.originHint)) || null,
    defaultUnitPrice: parsedPrice,
    currency: pick("currency", trimmed(item.currency) || "VND") || "VND",
    sourceUrl: pick("sourceUrl") || null,
    catalogPdfUrls: [...new Set(decision.catalogPdfUrls ?? [])].filter(Boolean),
  };
}

function isLocked(
  locks: Partial<Record<MaterialFieldLockKey, boolean>>,
  field: FillableField,
) {
  const lockKey = LOCK_KEY_BY_FIELD[field];
  return lockKey != null && locks[lockKey] === true;
}

function applyFillEmpty(
  locks: Partial<Record<MaterialFieldLockKey, boolean>>,
  field: FillableField,
  existing: string | null | undefined,
  proposed: string | null | undefined,
) {
  if (isLocked(locks, field)) return existing ?? undefined;
  if (trimmed(existing)) return existing ?? undefined;
  const next = trimmed(proposed);
  return next ? next : (existing ?? undefined);
}

async function findMaterialByCode(db: DbOrTx, code: string) {
  const [row] = await db
    .select()
    .from(materials)
    .where(and(eq(materials.code, code.trim()), isNull(materials.deletedAt)))
    .limit(1);
  return row ?? null;
}

async function findMaterialByNameUnit(db: DbOrTx, name: string, unit: string) {
  const key = nameUnitKey(name, unit);
  const [nameKey, unitKey] = key.split("|") as [string, string];
  const [row] = await db
    .select()
    .from(materials)
    .where(
      and(
        sql`lower(btrim(${materials.name})) = ${nameKey}`,
        sql`lower(btrim(${materials.unit})) = ${unitKey}`,
        isNull(materials.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Pure helper: case-insensitive name+unit key used for catalog dedup (mirrors import). */
export function materialNameUnitDedupKey(name: string, unit: string) {
  return nameUnitKey(name, unit);
}

/** True when two name+unit pairs collide under import/commit dedup rules. */
export function materialNameUnitKeysMatch(
  leftName: string,
  leftUnit: string,
  rightName: string,
  rightUnit: string,
) {
  return nameUnitKey(leftName, leftUnit) === nameUnitKey(rightName, rightUnit);
}

async function updateMaterialFillEmpty(
  db: DbOrTx,
  material: MaterialRow,
  fields: ReturnType<typeof resolvedMaterialFields>,
) {
  const metadata = normalizeMaterialMetadata(material.metadataJson);
  const locks = metadata.fieldLocks ?? {};
  const update: Partial<typeof materials.$inferInsert> = {};
  const now = new Date().toISOString();

  const nextCode = applyFillEmpty(locks, "code", material.code, fields.code);
  if (nextCode !== undefined && trimmed(nextCode) !== trimmed(material.code)) {
    update.code = trimmed(nextCode) || null;
  }

  const nextCategory = applyFillEmpty(
    locks,
    "category",
    material.category,
    fields.category,
  );
  if (
    nextCategory !== undefined &&
    trimmed(nextCategory) !== trimmed(material.category)
  ) {
    update.category = trimmed(nextCategory) || null;
  }

  const nextSpec = applyFillEmpty(
    locks,
    "specText",
    material.specText,
    fields.specText,
  );
  if (
    nextSpec !== undefined &&
    trimmed(nextSpec) !== trimmed(material.specText)
  ) {
    update.specText = trimmed(nextSpec);
  }

  const nextManufacturer = applyFillEmpty(
    locks,
    "manufacturer",
    material.manufacturer,
    fields.manufacturer,
  );
  if (
    nextManufacturer !== undefined &&
    trimmed(nextManufacturer) !== trimmed(material.manufacturer)
  ) {
    update.manufacturer = trimmed(nextManufacturer) || null;
  }

  const nextOrigin = applyFillEmpty(
    locks,
    "originCountry",
    material.originCountry,
    fields.originCountry,
  );
  if (
    nextOrigin !== undefined &&
    trimmed(nextOrigin) !== trimmed(material.originCountry)
  ) {
    update.originCountry = trimmed(nextOrigin) || null;
  }

  const nextUnit = applyFillEmpty(locks, "unit", material.unit, fields.unit);
  if (nextUnit !== undefined && trimmed(nextUnit) && trimmed(nextUnit) !== trimmed(material.unit)) {
    update.unit = trimmed(nextUnit);
  }

  if (
    !isLocked(locks, "defaultUnitPrice") &&
    material.defaultUnitPrice == null &&
    fields.defaultUnitPrice != null
  ) {
    update.defaultUnitPrice = fields.defaultUnitPrice;
  }

  const nextSource = applyFillEmpty(
    locks,
    "sourceUrl",
    material.sourceUrl,
    fields.sourceUrl,
  );
  if (
    nextSource !== undefined &&
    trimmed(nextSource) !== trimmed(material.sourceUrl)
  ) {
    update.sourceUrl = trimmed(nextSource) || null;
  }

  if (Object.keys(update).length === 0) {
    return material;
  }

  const [updated] = await db
    .update(materials)
    .set({
      ...update,
      metadataJson: buildMaterialMetadata(metadata),
      updatedAt: now,
    })
    .where(eq(materials.id, material.id))
    .returning();
  return updated ?? material;
}

async function insertMaterial(
  db: DbOrTx,
  fields: ReturnType<typeof resolvedMaterialFields>,
) {
  const now = new Date().toISOString();
  const [created] = await db
    .insert(materials)
    .values({
      code: fields.code?.trim() ? fields.code.trim() : null,
      name: fields.name.trim(),
      unit: fields.unit.trim(),
      category: fields.category?.trim() ? fields.category.trim() : null,
      specText: fields.specText,
      manufacturer: fields.manufacturer?.trim()
        ? fields.manufacturer.trim()
        : null,
      originCountry: fields.originCountry?.trim()
        ? fields.originCountry.trim()
        : null,
      defaultUnitPrice: fields.defaultUnitPrice,
      currency: fields.currency || "VND",
      sourceUrl: fields.sourceUrl?.trim() ? fields.sourceUrl.trim() : null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!created) {
    throw new Error("Không tạo được vật tư mới.");
  }
  return created;
}

async function attachCatalogPdfsBestEffort(
  db: DbOrTx,
  materialId: number,
  urls: string[],
  fallbackTitle: string,
  supplier: string | null,
) {
  if (urls.length === 0) return;
  try {
    await attachCatalogPdfUrlsToMaterial(
      db as unknown as AppDb,
      urls,
      materialId,
      {
        sourceType: "manual_url",
        linkSource: "import",
        fallbackTitle,
        supplier,
      },
    );
  } catch (error) {
    log.warn("catalog_pdf_attach_failed", { materialId, error });
  }
}

async function commitOneItem(
  db: AppDb,
  item: WorkspaceItem,
): Promise<MaterialProfileCommitItemResult> {
  const base = {
    itemId: item.id,
    originalRowIndex: item.originalRowIndex,
    productName: item.productName,
  };

  try {
    const decision = seedDecisionFromItem(item);
    if (decision.skipped) {
      return {
        ...base,
        status: "skipped",
        materialId: item.materialId,
        message: "Dòng đã bỏ qua.",
      };
    }
    if (!isExportableDecision(decision)) {
      return {
        ...base,
        status: "skipped",
        materialId: item.materialId,
        message: "Dòng chưa đủ dữ liệu để lưu vào danh mục.",
      };
    }

    const fields = resolvedMaterialFields(item, decision);
    if (!fields.name.trim() || !fields.unit.trim()) {
      return {
        ...base,
        status: "failed",
        materialId: item.materialId,
        message: "Thiếu tên vật tư hoặc ĐVT.",
      };
    }

    const now = new Date().toISOString();
    const result = await db.transaction(async (tx) => {
      let material: MaterialRow | null = null;
      let status: MaterialProfileCommitItemResult["status"] = "updated";

      if (item.materialId != null) {
        const [existing] = await tx
          .select()
          .from(materials)
          .where(
            and(eq(materials.id, item.materialId), isNull(materials.deletedAt)),
          )
          .limit(1);
        if (existing) {
          material = await updateMaterialFillEmpty(tx, existing, fields);
          status = "updated";
        }
      }

      if (!material && fields.code?.trim()) {
        const byCode = await findMaterialByCode(tx, fields.code);
        if (byCode) {
          material = await updateMaterialFillEmpty(tx, byCode, fields);
          status = item.materialId === byCode.id ? "updated" : "linked";
        }
      }

      if (!material) {
        const byNameUnit = await findMaterialByNameUnit(
          tx,
          fields.name,
          fields.unit,
        );
        if (byNameUnit) {
          material = await updateMaterialFillEmpty(tx, byNameUnit, fields);
          status = item.materialId === byNameUnit.id ? "updated" : "linked";
        }
      }

      if (!material) {
        material = await insertMaterial(tx, fields);
        status = "inserted";
      }

      await attachCatalogPdfsBestEffort(
        tx,
        material.id,
        fields.catalogPdfUrls,
        fields.name,
        fields.manufacturer,
      );

      const [updatedItem] = await tx
        .update(excelWorkspaceItems)
        .set({
          materialId: material.id,
          matchStatus:
            item.matchStatus === "manual" ? "manual" : "matched",
          committedAt: now,
          commitSource: PROFILE_COMMIT_SOURCE,
          updatedAt: now,
        })
        .where(eq(excelWorkspaceItems.id, item.id))
        .returning();

      return {
        status,
        materialId: material.id,
        item: updatedItem,
      };
    });

    return {
      ...base,
      status: result.status,
      materialId: result.materialId,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Không lưu được dòng vào danh mục vật tư.";
    log.warn("commit_item_failed", { itemId: item.id, error });
    return {
      ...base,
      status: "failed",
      materialId: item.materialId,
      message,
    };
  }
}

async function _saveMaterialProfileItemsToMaterials(
  db: AppDb,
  input: {
    workspaceId: number;
    itemIds?: number[];
    /** When true (default), only includedInExport rows are considered. */
    includedOnly?: boolean;
  },
): Promise<MaterialProfileCommitSummary> {
  const [workspace] = await db
    .select({ id: excelWorkspaces.id })
    .from(excelWorkspaces)
    .where(eq(excelWorkspaces.id, input.workspaceId))
    .limit(1);
  if (!workspace) {
    throw new MaterialProfileCommitError(
      "NOT_FOUND",
      "Không tìm thấy hồ sơ vật tư.",
    );
  }

  const conditions = [eq(excelWorkspaceItems.workspaceId, input.workspaceId)];
  if (input.itemIds && input.itemIds.length > 0) {
    conditions.push(
      inArray(
        excelWorkspaceItems.id,
        [...new Set(input.itemIds)].filter((id) => id > 0),
      ),
    );
  } else if (input.includedOnly !== false) {
    conditions.push(eq(excelWorkspaceItems.includedInExport, true));
  }

  const items = await db
    .select()
    .from(excelWorkspaceItems)
    .where(and(...conditions))
    .orderBy(excelWorkspaceItems.sortOrder);

  if (items.length === 0) {
    throw new MaterialProfileCommitError(
      "BAD_REQUEST",
      "Không có dòng nào để lưu vào danh mục vật tư.",
    );
  }

  const results: MaterialProfileCommitItemResult[] = [];
  for (const item of items) {
    results.push(await commitOneItem(db, item));
  }

  const summary: MaterialProfileCommitSummary = {
    selectedCount: items.length,
    inserted: results.filter((r) => r.status === "inserted").length,
    updated: results.filter((r) => r.status === "updated").length,
    linked: results.filter((r) => r.status === "linked").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  };

  // Touch workspace updatedAt so hub lists refresh.
  await db
    .update(excelWorkspaces)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(excelWorkspaces.id, input.workspaceId));

  return summary;
}

/** Pure helper for tests: resolve fields that would be written for a decision. */
export function resolveProfileCommitFieldsForTest(
  item: WorkspaceItem,
  decisionJson: unknown,
) {
  const decision =
    deserializeRowDecision(decisionJson) ?? seedDecisionFromItem(item);
  return resolvedMaterialFields(item, decision);
}

export function nameUnitDedupKeyForTest(name: string, unit: string) {
  return materialNameUnitDedupKey(name, unit);
}

export const saveMaterialProfileItemsToMaterials = traceFn(
  log,
  "saveMaterialProfileItemsToMaterials",
  _saveMaterialProfileItemsToMaterials,
);
