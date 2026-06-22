import "server-only";

import { and, eq, isNull, ne, sql } from "drizzle-orm";

import { buildFillPlan, type FillableField } from "~/lib/materials/excel-enrich-fields";
import { resolveEnrichmentFieldProposal } from "~/lib/materials/material-enrichment-commit-decision";
import {
  ENRICHABLE_FIELDS,
  type EnrichableField,
  type MaterialEnrichmentFilterOptions,
  type MaterialEnrichmentJobOptions,
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
  materialEnrichmentJobs,
  materials,
} from "~/server/db/schema";
import {
  attachCatalogPdfUrlsToMaterial,
  createLocalCatalogDocument,
  listCatalogDocumentsForMaterial,
} from "~/server/services/catalog-documents";
import { generateCatalogPdf } from "~/server/services/catalog-pdf-generator";
import { parseOptionalNumber } from "~/server/services/excel-workbook";

type AppDb = typeof appDb;
/** Either the root db handle or a transaction handle (for atomic commits). */
type DbOrTx = AppDb | Parameters<Parameters<AppDb["transaction"]>[0]>[0];
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
  code: "code",
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
  code: "code",
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
 * Parse an LLM/string price into a positive integer VND value. Reuses the
 * thousands-vs-decimal heuristic from excel-workbook's parseOptionalNumber so
 * VN-formatted "1.250.000" → 1250000 while real decimals like "12,99"/"12.99"
 * parse to ~13 instead of being inflated 100×. Rounds to the integer VND the
 * column expects. Returns null when no sensible positive number can be derived,
 * so commit never zeroes out an existing price.
 */
export function parseEnrichmentPrice(value: string | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return null;
  }
  const parsed = parseOptionalNumber(trimmed);
  return parsed != null && Number.isFinite(parsed) && parsed > 0
    ? Math.round(parsed)
    : null;
}

function materialFieldValue(material: MaterialRow, field: EnrichableField) {
  switch (field) {
    case "code":
      return material.code;
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
  db: DbOrTx,
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
  // Run the whole commit (events + materials update + PDF attach + item status)
  // atomically. The terminal status update is guarded with `ne(status,
  // "committed")` so a manual commit racing the runner's autoCommit path can
  // never double-write events/materials for the same item.
  const txResult = await db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(materialEnrichmentItems)
      .where(eq(materialEnrichmentItems.id, itemId))
      .limit(1)
      .for("update");

    if (!item) {
      throw new Error("Không tìm thấy dòng enrichment.");
    }

    // Already committed (e.g. the other path won the race): no-op so we don't
    // re-emit events or re-write the material.
    if (item.status === "committed") {
      return {
        item,
        generate: false,
        material: null as MaterialRow | null,
        jobId: item.jobId,
        materialId: item.materialId,
      };
    }

    const [material] = await tx
      .select()
      .from(materials)
      .where(and(eq(materials.id, item.materialId), isNull(materials.deletedAt)))
      .limit(1);

    if (!material) {
      throw new Error("Không tìm thấy vật tư để cập nhật.");
    }

    const result = item.resultJson as MaterialEnrichmentResult;
    // The per-field commit decision (accept gating + inline edits) is read from
    // `result` inside resolveEnrichmentFieldProposal below.
    const metadata = normalizeMaterialMetadata(material.metadataJson);
    const locks = metadata.fieldLocks ?? {};
    const update: Partial<typeof materials.$inferInsert> = {};
    const now = new Date().toISOString();

    // Read the parent job's options so commit honours the `generatePdfIfMissing`
    // toggle regardless of which path (manual / autoCommit) triggered it.
    const [jobRow] = await tx
      .select({ optionsJson: materialEnrichmentJobs.optionsJson })
      .from(materialEnrichmentJobs)
      .where(eq(materialEnrichmentJobs.id, item.jobId))
      .limit(1);
    const jobOptions = (jobRow?.optionsJson ?? {}) as MaterialEnrichmentJobOptions;
    // `generatePdfIfMissing` only governs *generating* a PDF when none was
    // found (handled after the transaction). Discovered PDFs are always
    // attached — that has always been the behaviour and is independent of the
    // toggle.
    const generatePdfIfMissing = jobOptions.generatePdfIfMissing === true;

    for (const field of ENRICHABLE_FIELDS) {
      const proposed = resolveEnrichmentFieldProposal(result, field);
      // `undefined` means the field was gated out by the per-field decision.
      if (proposed === undefined) {
        continue;
      }
      const extracted = result.fields[field];
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
        case "code":
          // Fill-empty-only (enforced by applyLockedFillEmptyField above): this
          // branch only runs when the existing code was blank, so we never
          // overwrite an existing code and never collide on the unique index.
          update.code = after || null;
          break;
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

      await logEnrichmentEvent(tx, {
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
      await tx
        .update(materials)
        .set({
          ...update,
          metadataJson: buildMaterialMetadata(metadata),
          updatedAt: now,
        })
        .where(eq(materials.id, material.id));
    }

    let pdfWasDiscovered = false;
    if (result.catalogPdfUrls.length > 0) {
      const attached = await attachCatalogPdfUrlsToMaterial(
        // catalog-documents helpers type their handle as the root db; a tx
        // handle is runtime-compatible (same query builder), so cast for the
        // atomic path.
        tx as unknown as AppDb,
        result.catalogPdfUrls,
        material.id,
        {
          sourceType: "detected",
          linkSource: "manual",
          supplier: result.fields.manufacturer?.matchedOption ?? result.fields.manufacturer?.value ?? material.manufacturer,
        },
      );
      pdfWasDiscovered = attached.documentIds.length > 0;
      if (attached.linked > 0) {
        await logEnrichmentEvent(tx, {
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

    const [committed] = await tx
      .update(materialEnrichmentItems)
      .set({
        status: "committed",
        committedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(materialEnrichmentItems.id, itemId),
          ne(materialEnrichmentItems.status, "committed"),
        ),
      )
      .returning();

    // Decide whether a catalog PDF should be generated after this transaction
    // commits. We generate only when: the toggle is on, no PDF was discovered
    // via web search this run, and the material has no catalog PDF linked yet.
    // The render itself runs post-commit (it's slow and must not hold the row
    // lock or roll back a good field commit on failure).
    let shouldGeneratePdf = false;
    if (generatePdfIfMissing && !pdfWasDiscovered) {
      const existingDocs = await listCatalogDocumentsForMaterial(
        tx as unknown as AppDb,
        material.id,
      );
      shouldGeneratePdf = existingDocs.length === 0;
    }

    // Zero rows updated → another path committed between our lock release and
    // here (defensive; the row lock above already serializes commits). Return
    // the existing row so the caller still gets a committed snapshot.
    return {
      item: committed ?? item,
      // Only the path that actually performed the commit should generate.
      generate: shouldGeneratePdf && committed != null,
      material: { ...material, ...update },
      jobId: item.jobId,
      materialId: item.materialId,
    };
  });

  if (txResult.generate && txResult.material) {
    await maybeGenerateCatalogPdf(db, {
      material: txResult.material,
      materialId: txResult.materialId,
      jobId: txResult.jobId,
      itemId,
    });
  }

  return txResult.item;
}

/**
 * Render and attach a generated catalog PDF for a material. Best-effort: any
 * failure (browser launch, render, storage) is logged as a non-fatal event and
 * swallowed — the field enrichment is already committed and must not be undone
 * by a PDF problem.
 */
async function maybeGenerateCatalogPdf(
  db: AppDb,
  input: {
    material: MaterialRow;
    materialId: number;
    jobId: string;
    itemId: number;
  },
) {
  const { material } = input;
  try {
    const buffer = await generateCatalogPdf({
      code: material.code,
      name: material.name,
      unit: material.unit,
      category: material.category,
      specText: material.specText,
      manufacturer: material.manufacturer,
      originCountry: material.originCountry,
      defaultUnitPrice: material.defaultUnitPrice,
      sourceUrl: material.sourceUrl,
    });
    const documentId = await createLocalCatalogDocument(db, {
      materialId: input.materialId,
      title: `Catalog ${material.name}`.trim().slice(0, 200),
      fileName: `catalog-${input.materialId}.pdf`,
      buffer,
      sourceType: "generated",
      linkSource: "manual",
      supplier: material.manufacturer,
    });
    // Bump the parent job's pdfsGenerated counter atomically so the stat reflects
    // generated PDFs (it was previously never incremented). Best-effort: still
    // inside the try, so a counter failure stays non-fatal alongside the event log.
    await db
      .update(materialEnrichmentJobs)
      .set({
        pdfsGenerated: sql`${materialEnrichmentJobs.pdfsGenerated} + 1`,
      })
      .where(eq(materialEnrichmentJobs.id, input.jobId));
    await logEnrichmentEvent(db, {
      jobId: input.jobId,
      itemId: input.itemId,
      materialId: input.materialId,
      field: "catalogPdfUrls",
      beforeValue: null,
      afterValue: String(documentId),
      action: "generate_pdf",
      evidenceJson: { documentId },
    });
  } catch (error) {
    console.error(
      `[material-enrichment] catalog PDF generation failed for material ${input.materialId}:`,
      error,
    );
    await logEnrichmentEvent(db, {
      jobId: input.jobId,
      itemId: input.itemId,
      materialId: input.materialId,
      field: "catalogPdfUrls",
      beforeValue: null,
      afterValue: null,
      action: "generate_pdf_failed",
      evidenceJson: {
        error: error instanceof Error ? error.message : String(error),
      },
    }).catch(() => undefined);
  }
}
