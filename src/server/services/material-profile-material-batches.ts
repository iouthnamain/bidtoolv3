import "server-only";

import { randomUUID } from "node:crypto";

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  ne,
  notInArray,
  sql,
} from "drizzle-orm";

import {
  catalogDocumentTitleFromUrl,
  normalizeCatalogPdfUrl,
} from "~/lib/materials/catalog-pdf";
import type { FillableField } from "~/lib/materials/excel-enrich-fields";
import { simpleSimilarity } from "~/lib/materials/option-matcher";
import {
  serializeRowDecision,
  type RowDecision,
} from "~/lib/materials/review-decision";
import { sheetFieldsFromWorkspaceItem } from "~/lib/materials/workspace-review-row";
import { db } from "~/server/db";
import {
  excelWorkspaceItems,
  excelWorkspaces,
  excelResearchRowEvidence,
  materialCatalogDocumentLinks,
  materialCatalogDocuments,
  materialEnrichmentEvents,
  materialEnrichmentItems,
  materialProfileMaterialBatchRows,
  materialProfileMaterialBatches,
  materialProfilePromotionLedger,
  materialProfileScrapeJobs,
  materialWebCandidates,
  materials,
} from "~/server/db/schema";
import {
  materialProfileDecisionForItem,
  materialProfileDecisionsForItems,
} from "~/server/services/material-profile-review-decisions";

const MAX_BATCH_ITEMS = 500;
const HISTORY_LIMIT = 100;
const HISTORY_DAYS = 30;
const TARGET_THRESHOLD = 0.85;
const TARGET_MARGIN = 0.05;
const activeBatchCommits = new Set<string>();

type WorkspaceItem = typeof excelWorkspaceItems.$inferSelect;
type Material = typeof materials.$inferSelect;
type Batch = typeof materialProfileMaterialBatches.$inferSelect;
type BatchRow = typeof materialProfileMaterialBatchRows.$inferSelect;

export type ProfileMaterialProposal = {
  code: string;
  name: string;
  unit: string;
  category: string;
  specText: string;
  manufacturer: string;
  originCountry: string;
  defaultUnitPrice: number | null;
  currency: string;
  sourceUrl: string;
  imageUrl: string;
  catalogPdfUrls: string[];
  acceptedFields: FillableField[];
  acceptedProfileFields: Array<"name" | "imageUrl">;
  sourceScore?: number | null;
};

export class MaterialProfileMaterialBatchError extends Error {
  constructor(
    readonly code: "BAD_REQUEST" | "NOT_FOUND" | "CONFLICT",
    message: string,
  ) {
    super(message);
  }
}

function expiresAt(now: string) {
  return new Date(
    new Date(now).getTime() + HISTORY_DAYS * 86_400_000,
  ).toISOString();
}

function trimmed(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueUrls(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const validated = normalizeCatalogPdfUrl(value);
    if (!validated) return false;
    const parsed = new URL(validated);
    parsed.hash = "";
    parsed.searchParams.sort();
    const canonical = parsed.toString();
    if (seen.has(canonical)) return false;
    seen.add(canonical);
    return true;
  });
}

export function unionProfileCatalogUrls(...groups: string[][]) {
  return uniqueUrls(groups.flat());
}

export function isMaterialProfileUndoVersionCurrent(
  currentVersion: string | null | undefined,
  committedVersion: string | null | undefined,
) {
  return Boolean(
    currentVersion && committedVersion && currentVersion === committedVersion,
  );
}

function catalogLinkFingerprint(value: unknown) {
  if (!Array.isArray(value)) return null;
  return value
    .flatMap((entry) => {
      const link = snapshotRecord(snapshotRecord(entry)?.link);
      if (typeof link?.documentId !== "number") return [];
      return [
        `${link.documentId}:${typeof link.linkSource === "string" ? link.linkSource : ""}`,
      ];
    })
    .sort()
    .join("|");
}

export function isMaterialProfileCatalogSnapshotCurrent(
  currentSnapshot: unknown,
  committedSnapshot: unknown,
) {
  const current = catalogLinkFingerprint(currentSnapshot);
  const committed = catalogLinkFingerprint(committedSnapshot);
  return current != null && committed != null && current === committed;
}

function parsePrice(value: string | undefined, fallback: number | null) {
  if (!value?.trim()) return fallback;
  const normalized = value
    .replace(/\s/g, "")
    .replace(/[.,](?=\d{3}(?:\D|$))/g, "");
  const parsed = Number(normalized.replace(",", "."));
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

export function buildMaterialProfileProposal(
  item: WorkspaceItem,
  decision: RowDecision,
): ProfileMaterialProposal {
  const sheet = sheetFieldsFromWorkspaceItem(item);
  const value = (field: FillableField) => {
    const before = sheet[field]?.trim() ?? "";
    if (!decision.acceptedFields.has(field)) return before;
    return (
      decision.editedValues?.[field]?.trim() ??
      decision.webProposedFields?.[field]?.trim() ??
      before
    );
  };
  const selectedScrapeResult = decision.scrapeResults?.find(
    (result) =>
      result.sourceCandidateKey === decision.selectedSearchCandidateKey,
  );
  const proposedName = [
    selectedScrapeResult?.name,
    decision.aiSearchResult?.title,
    item.productName,
  ]
    .find((value) => Boolean(value?.trim()))
    ?.trim();
  const selectedName = decision.acceptedProfileFields?.has("name")
    ? decision.editedProfileValues?.name !== undefined
      ? trimmed(decision.editedProfileValues.name)
      : (proposedName ?? "")
    : item.productName.trim();
  const selectedImage = decision.acceptedProfileFields?.has("imageUrl")
    ? decision.editedProfileValues?.imageUrl !== undefined
      ? trimmed(decision.editedProfileValues.imageUrl)
      : (selectedScrapeResult?.imageUrl ?? "")
    : "";
  const selectedSourceScore =
    selectedScrapeResult?.sourceScore ??
    (decision.selectedSearchCandidateKey?.startsWith("web:")
      ? decision.webLinkResults?.find(
          (link) =>
            link.url ===
            decision.selectedSearchCandidateKey?.slice("web:".length),
        )?.rankScore
      : decision.selectedSearchCandidateKey?.startsWith("ai:")
        ? decision.aiSearchCandidates?.[
            Number(decision.selectedSearchCandidateKey.slice("ai:".length))
          ]?.rankScore
        : null);
  return {
    code: value("code"),
    name: selectedName,
    unit: value("unit"),
    category: value("category"),
    specText: value("specText"),
    manufacturer: value("manufacturer"),
    originCountry: value("originCountry"),
    defaultUnitPrice: parsePrice(
      value("defaultUnitPrice"),
      decision.acceptedFields.has("defaultUnitPrice") ? null : item.unitPrice,
    ),
    currency: value("currency") || item.currency.trim() || "VND",
    sourceUrl: value("sourceUrl"),
    imageUrl: selectedImage,
    catalogPdfUrls: uniqueUrls(decision.catalogPdfUrls ?? []),
    acceptedFields: [...decision.acceptedFields],
    acceptedProfileFields: [...(decision.acceptedProfileFields ?? new Set())],
    sourceScore: selectedSourceScore ?? null,
  };
}

export function incompleteProfileMaterialFields(
  proposal: ProfileMaterialProposal,
) {
  const missing: string[] = [];
  if (!proposal.code) missing.push("mã vật tư");
  if (!proposal.name) missing.push("tên vật tư");
  if (!proposal.unit) missing.push("ĐVT");
  if (!proposal.specText) missing.push("thông số");
  if (!proposal.manufacturer) missing.push("nhà sản xuất");
  if (!proposal.originCountry) missing.push("xuất xứ");
  if (proposal.defaultUnitPrice == null) missing.push("đơn giá");
  if (!proposal.sourceUrl) missing.push("URL nguồn");
  if (proposal.catalogPdfUrls.length === 0) missing.push("URL catalog");
  return missing;
}

function proposalForTarget(
  proposal: ProfileMaterialProposal,
  decision: RowDecision,
  target: Material | null | undefined,
  targetCatalogUrls: string[],
  retainUnselected = false,
): ProfileMaterialProposal {
  const useCatalogName =
    decision.selectedSource === "catalog" &&
    decision.acceptedProfileFields?.has("name") &&
    decision.editedProfileValues?.name === undefined;
  const useCatalogImage =
    decision.selectedSource === "catalog" &&
    decision.acceptedProfileFields?.has("imageUrl") &&
    decision.editedProfileValues?.imageUrl === undefined;
  const result: ProfileMaterialProposal = {
    ...proposal,
    name: useCatalogName && target ? target.name : proposal.name,
    imageUrl:
      useCatalogImage && target ? (target.imageUrl ?? "") : proposal.imageUrl,
    catalogPdfUrls: unionProfileCatalogUrls(
      proposal.catalogPdfUrls,
      targetCatalogUrls,
    ),
  };
  if (!retainUnselected || !target) return result;
  const accepted = decision.acceptedFields;
  return {
    ...result,
    code: accepted.has("code") ? result.code : (target.code ?? ""),
    name: decision.acceptedProfileFields?.has("name")
      ? result.name
      : target.name,
    unit: accepted.has("unit") ? result.unit : target.unit,
    category: accepted.has("category")
      ? result.category
      : (target.category ?? ""),
    specText: accepted.has("specText") ? result.specText : target.specText,
    manufacturer: accepted.has("manufacturer")
      ? result.manufacturer
      : (target.manufacturer ?? ""),
    originCountry: accepted.has("originCountry")
      ? result.originCountry
      : (target.originCountry ?? ""),
    defaultUnitPrice: accepted.has("defaultUnitPrice")
      ? result.defaultUnitPrice
      : target.defaultUnitPrice,
    currency: accepted.has("currency") ? result.currency : target.currency,
    sourceUrl: accepted.has("sourceUrl")
      ? result.sourceUrl
      : (target.sourceUrl ?? ""),
    imageUrl: decision.acceptedProfileFields?.has("imageUrl")
      ? result.imageUrl
      : (target.imageUrl ?? ""),
  };
}

export function profileMaterialTargetScore(
  proposal: Pick<ProfileMaterialProposal, "name" | "specText">,
  material: Pick<Material, "name" | "specText">,
) {
  const nameScore = simpleSimilarity(proposal.name, material.name);
  const specScore = simpleSimilarity(proposal.specText, material.specText);
  return nameScore * 0.7 + specScore * 0.3;
}

export function pickProfileTargetWinner<
  T extends {
    id: string;
    targetScore: number | null;
    originalRowIndex: number;
  },
>(rows: T[]) {
  return [...rows].sort(
    (left, right) =>
      (right.targetScore ?? 0) - (left.targetScore ?? 0) ||
      left.originalRowIndex - right.originalRowIndex,
  )[0];
}

async function requireWorkspace(workspaceId: number) {
  const [workspace] = await db
    .select({ id: excelWorkspaces.id })
    .from(excelWorkspaces)
    .where(eq(excelWorkspaces.id, workspaceId))
    .limit(1);
  if (!workspace) {
    throw new MaterialProfileMaterialBatchError(
      "NOT_FOUND",
      "Không tìm thấy hồ sơ vật tư.",
    );
  }
}

async function loadWorkspaceItems(workspaceId: number, itemIds: number[]) {
  const uniqueIds = [...new Set(itemIds)];
  if (uniqueIds.length === 0 || uniqueIds.length > MAX_BATCH_ITEMS) {
    throw new MaterialProfileMaterialBatchError(
      "BAD_REQUEST",
      `Chọn từ 1 đến ${MAX_BATCH_ITEMS} dòng để xem trước.`,
    );
  }
  const items = await db
    .select()
    .from(excelWorkspaceItems)
    .where(
      and(
        eq(excelWorkspaceItems.workspaceId, workspaceId),
        inArray(excelWorkspaceItems.id, uniqueIds),
      ),
    )
    .orderBy(asc(excelWorkspaceItems.sortOrder));
  if (items.length !== uniqueIds.length) {
    throw new MaterialProfileMaterialBatchError(
      "BAD_REQUEST",
      "Một hoặc nhiều dòng không thuộc hồ sơ vật tư này.",
    );
  }
  return items;
}

function targetResolution(
  item: WorkspaceItem,
  decision: RowDecision,
  proposal: ProfileMaterialProposal,
  activeMaterials: Material[],
) {
  const linkedMaterialId = decision.materialId ?? item.materialId;
  if (linkedMaterialId != null) {
    const linked = activeMaterials.find(
      (material) => material.id === linkedMaterialId,
    );
    if (linked)
      return { target: linked, score: 1, method: "linked", warning: null };
  }
  if (proposal.code) {
    const exact = activeMaterials.find(
      (material) =>
        material.code?.trim().toLowerCase() === proposal.code.toLowerCase(),
    );
    if (exact)
      return { target: exact, score: 1, method: "exact_code", warning: null };
  }
  const ranked = activeMaterials
    .map((material) => ({
      material,
      score: profileMaterialTargetScore(proposal, material),
    }))
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  const runnerUp = ranked[1];
  if (best && best.score >= TARGET_THRESHOLD) {
    if (runnerUp && best.score - runnerUp.score < TARGET_MARGIN) {
      return {
        target: null,
        score: best.score,
        method: "fuzzy_ambiguous",
        warning: "Nhiều vật tư đích có điểm gần nhau; hãy chọn đích thủ công.",
      };
    }
    return {
      target: best.material,
      score: best.score,
      method: "fuzzy",
      warning: null,
    };
  }
  return { target: null, score: null, method: "create", warning: null };
}

async function regroupBatch(batchId: string) {
  const rows = await db
    .select()
    .from(materialProfileMaterialBatchRows)
    .where(eq(materialProfileMaterialBatchRows.batchId, batchId))
    .orderBy(asc(materialProfileMaterialBatchRows.originalRowIndex));
  const byTarget = new Map<number, BatchRow[]>();
  for (const row of rows) {
    if (
      !row.included ||
      row.action === "blocked" ||
      row.targetMaterialId == null
    )
      continue;
    const group = byTarget.get(row.targetMaterialId) ?? [];
    group.push(row);
    byTarget.set(row.targetMaterialId, group);
  }
  const now = new Date().toISOString();
  for (const group of byTarget.values()) {
    const winner = pickProfileTargetWinner(group);
    if (!winner) continue;
    for (const row of group) {
      await db
        .update(materialProfileMaterialBatchRows)
        .set({
          action: row.id === winner.id ? "update" : "link_only",
          winnerRowId: row.id === winner.id ? null : winner.id,
          updatedAt: now,
        })
        .where(eq(materialProfileMaterialBatchRows.id, row.id));
    }
  }
  await updateBatchCounts(batchId);
}

async function updateBatchCounts(batchId: string) {
  const rows = await db
    .select({ action: materialProfileMaterialBatchRows.action })
    .from(materialProfileMaterialBatchRows)
    .where(eq(materialProfileMaterialBatchRows.batchId, batchId));
  const count = (action: string) =>
    rows.filter((row) => row.action === action).length;
  await db
    .update(materialProfileMaterialBatches)
    .set({
      total: rows.length,
      createCount: count("create"),
      updateCount: count("update"),
      linkOnlyCount: count("link_only"),
      excludedCount: count("excluded"),
      blockedCount: count("blocked"),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(materialProfileMaterialBatches.id, batchId));
}

export async function createMaterialProfileSavePreview(input: {
  workspaceId: number;
  itemIds: number[];
  sourceScrapeJobId?: string;
  single?: boolean;
}) {
  await requireWorkspace(input.workspaceId);
  if (input.sourceScrapeJobId) {
    const [sourceJob] = await db
      .select({ id: materialProfileScrapeJobs.id })
      .from(materialProfileScrapeJobs)
      .where(
        and(
          eq(materialProfileScrapeJobs.id, input.sourceScrapeJobId),
          eq(materialProfileScrapeJobs.workspaceId, input.workspaceId),
        ),
      )
      .limit(1);
    if (!sourceJob) {
      throw new MaterialProfileMaterialBatchError(
        "BAD_REQUEST",
        "Job scrape nguồn không thuộc hồ sơ vật tư này.",
      );
    }
  }
  const items = await loadWorkspaceItems(input.workspaceId, input.itemIds);
  const activeMaterials = await db
    .select()
    .from(materials)
    .where(isNull(materials.deletedAt));
  const catalogRows = await db
    .select({
      materialId: materialCatalogDocumentLinks.materialId,
      sourceUrl: materialCatalogDocuments.sourceUrl,
    })
    .from(materialCatalogDocumentLinks)
    .innerJoin(
      materialCatalogDocuments,
      eq(materialCatalogDocuments.id, materialCatalogDocumentLinks.documentId),
    )
    .where(isNull(materialCatalogDocuments.deletedAt));
  const catalogUrlsByMaterial = new Map<number, string[]>();
  for (const row of catalogRows) {
    const urls = catalogUrlsByMaterial.get(row.materialId) ?? [];
    if (row.sourceUrl) urls.push(row.sourceUrl);
    catalogUrlsByMaterial.set(row.materialId, urls);
  }
  const now = new Date().toISOString();
  const batchId = randomUUID();
  const decisions = await materialProfileDecisionsForItems(items);
  const rows = items.map((item) => {
    const decision = decisions.get(item.id);
    if (!decision) {
      throw new MaterialProfileMaterialBatchError(
        "BAD_REQUEST",
        `Không tải được quyết định duyệt của dòng ${item.originalRowIndex}.`,
      );
    }
    const baseProposal = buildMaterialProfileProposal(item, decision);
    const resolution = targetResolution(
      item,
      decision,
      baseProposal,
      activeMaterials,
    );
    const proposal = proposalForTarget(
      baseProposal,
      decision,
      resolution.target,
      resolution.target
        ? (catalogUrlsByMaterial.get(resolution.target.id) ?? [])
        : [],
      input.single === true,
    );
    const missing = incompleteProfileMaterialFields(proposal);
    const warnings = [...missing.map((field) => `Thiếu ${field}.`)];
    if (resolution.warning) warnings.push(resolution.warning);
    const codeCollision = proposal.code
      ? activeMaterials.find(
          (material) =>
            material.code?.trim().toLowerCase() ===
              proposal.code.toLowerCase() &&
            material.id !== resolution.target?.id,
        )
      : undefined;
    if (codeCollision) {
      warnings.push(
        `Mã ${proposal.code} đang thuộc vật tư #${codeCollision.id}.`,
      );
    }
    if (
      resolution.target &&
      (resolution.target.code !== proposal.code ||
        resolution.target.name !== proposal.name)
    ) {
      warnings.push("Đề xuất thay đổi mã hoặc tên nhận diện của vật tư đích.");
    }
    const blocked =
      missing.length > 0 ||
      resolution.method === "fuzzy_ambiguous" ||
      Boolean(codeCollision);
    return {
      id: randomUUID(),
      batchId,
      workspaceItemId: item.id,
      originalRowIndex: item.originalRowIndex,
      included: !blocked,
      action: blocked ? "blocked" : resolution.target ? "update" : "create",
      targetMaterialId: resolution.target?.id ?? null,
      targetScore: resolution.score,
      targetMethod: resolution.method,
      expectedTargetUpdatedAt: resolution.target?.updatedAt ?? null,
      proposedMaterialJson: proposal,
      previousWorkspaceItemStateJson: {
        materialId: item.materialId,
        matchStatus: item.matchStatus,
        reviewDecisionJson: item.reviewDecisionJson,
      },
      warningsJson: warnings,
      updatedAt: now,
    };
  });
  const createsByCode = new Map<string, typeof rows>();
  for (const row of rows) {
    if (row.action !== "create") continue;
    const proposal = row.proposedMaterialJson;
    const code = proposal.code.trim().toLocaleLowerCase("vi-VN");
    if (!code) continue;
    const group = createsByCode.get(code) ?? [];
    group.push(row);
    createsByCode.set(code, group);
  }
  for (const group of createsByCode.values()) {
    if (group.length < 2) continue;
    for (const row of group) {
      row.action = "blocked";
      row.included = false;
      row.warningsJson.push(
        "Nhiều dòng trong đợt lưu đề xuất cùng mã vật tư mới; hãy chọn vật tư đích thủ công.",
      );
    }
  }
  await db.transaction(async (tx) => {
    await tx.insert(materialProfileMaterialBatches).values({
      id: batchId,
      workspaceId: input.workspaceId,
      sourceScrapeJobId: input.sourceScrapeJobId ?? null,
      status: "draft",
      overwriteScope: input.single ? "selected" : "all",
      total: rows.length,
      message: "Bản xem trước đang chờ xác nhận.",
      expiresAt: expiresAt(now),
      updatedAt: now,
    });
    await tx.insert(materialProfileMaterialBatchRows).values(rows);
  });
  await regroupBatch(batchId);
  return getMaterialProfileSaveBatch(batchId, input.workspaceId);
}

async function requireBatch(batchId: string, workspaceId: number) {
  const [batch] = await db
    .select()
    .from(materialProfileMaterialBatches)
    .where(
      and(
        eq(materialProfileMaterialBatches.id, batchId),
        eq(materialProfileMaterialBatches.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!batch)
    throw new MaterialProfileMaterialBatchError(
      "NOT_FOUND",
      "Không tìm thấy đợt lưu vật tư.",
    );
  return batch;
}

export async function getMaterialProfileSaveBatch(
  batchId: string,
  workspaceId: number,
) {
  const batch = await requireBatch(batchId, workspaceId);
  const rows = await db
    .select()
    .from(materialProfileMaterialBatchRows)
    .where(eq(materialProfileMaterialBatchRows.batchId, batch.id))
    .orderBy(asc(materialProfileMaterialBatchRows.originalRowIndex));
  const targetIds = rows.flatMap((row) =>
    row.targetMaterialId == null ? [] : [row.targetMaterialId],
  );
  const targets = targetIds.length
    ? await db
        .select()
        .from(materials)
        .where(inArray(materials.id, [...new Set(targetIds)]))
    : [];
  const targetCatalogRows = targets.length
    ? await db
        .select({
          materialId: materialCatalogDocumentLinks.materialId,
          sourceUrl: materialCatalogDocuments.sourceUrl,
        })
        .from(materialCatalogDocumentLinks)
        .innerJoin(
          materialCatalogDocuments,
          eq(
            materialCatalogDocuments.id,
            materialCatalogDocumentLinks.documentId,
          ),
        )
        .where(
          and(
            inArray(
              materialCatalogDocumentLinks.materialId,
              targets.map((target) => target.id),
            ),
            isNull(materialCatalogDocuments.deletedAt),
          ),
        )
    : [];
  const catalogByTarget = new Map<number, string[]>();
  for (const link of targetCatalogRows) {
    if (!link.sourceUrl) continue;
    const urls = catalogByTarget.get(link.materialId) ?? [];
    urls.push(link.sourceUrl);
    catalogByTarget.set(link.materialId, urls);
  }
  const targetsById = new Map(targets.map((target) => [target.id, target]));
  const rowsWithRuntimeWarnings = rows.map((row) => {
    const target =
      row.targetMaterialId == null
        ? undefined
        : targetsById.get(row.targetMaterialId);
    if (
      target &&
      row.expectedTargetUpdatedAt &&
      target.updatedAt !== row.expectedTargetUpdatedAt
    ) {
      return {
        ...row,
        warningsJson: [
          ...row.warningsJson,
          "Vật tư đích đã thay đổi sau khi tạo bản xem trước; cần tạo lại bản xem trước.",
        ],
      };
    }
    return row;
  });
  return {
    batch,
    rows: rowsWithRuntimeWarnings,
    targets: targets.map((target) => ({
      ...target,
      catalogPdfUrls: unionProfileCatalogUrls(
        catalogByTarget.get(target.id) ?? [],
      ),
    })),
  };
}

export async function updateMaterialProfileSavePreviewRow(input: {
  workspaceId: number;
  batchId: string;
  rowId: string;
  included?: boolean;
  targetMaterialId?: number | null;
}) {
  await db.transaction(async (tx) => {
    const [batch] = await tx
      .select()
      .from(materialProfileMaterialBatches)
      .where(
        and(
          eq(materialProfileMaterialBatches.id, input.batchId),
          eq(materialProfileMaterialBatches.workspaceId, input.workspaceId),
        ),
      )
      .limit(1)
      .for("update");
    if (!batch) {
      throw new MaterialProfileMaterialBatchError(
        "NOT_FOUND",
        "Không tìm thấy đợt lưu vật tư.",
      );
    }
    if (batch.status !== "draft") {
      throw new MaterialProfileMaterialBatchError(
        "CONFLICT",
        "Chỉ chỉnh sửa được bản xem trước ở trạng thái nháp.",
      );
    }
    const [row] = await tx
      .select()
      .from(materialProfileMaterialBatchRows)
      .where(
        and(
          eq(materialProfileMaterialBatchRows.id, input.rowId),
          eq(materialProfileMaterialBatchRows.batchId, batch.id),
        ),
      )
      .limit(1);
    if (!row) {
      throw new MaterialProfileMaterialBatchError(
        "NOT_FOUND",
        "Không tìm thấy dòng xem trước.",
      );
    }
    const targetChanged = input.targetMaterialId !== undefined;
    const targetMaterialId = targetChanged
      ? input.targetMaterialId
      : row.targetMaterialId;
    let target: Material | null = null;
    if (targetMaterialId != null) {
      const [selectedTarget] = await tx
        .select()
        .from(materials)
        .where(
          and(eq(materials.id, targetMaterialId), isNull(materials.deletedAt)),
        )
        .limit(1);
      target = selectedTarget ?? null;
      if (!target) {
        throw new MaterialProfileMaterialBatchError(
          "BAD_REQUEST",
          "Vật tư đích không còn tồn tại.",
        );
      }
    }
    const [item] = await tx
      .select()
      .from(excelWorkspaceItems)
      .where(
        and(
          eq(excelWorkspaceItems.id, row.workspaceItemId),
          eq(excelWorkspaceItems.workspaceId, input.workspaceId),
        ),
      )
      .limit(1);
    if (!item) {
      throw new MaterialProfileMaterialBatchError(
        "NOT_FOUND",
        "Dòng hồ sơ không còn tồn tại.",
      );
    }
    const decision = await materialProfileDecisionForItem(item);
    const baseProposal = buildMaterialProfileProposal(item, decision);
    const targetCatalog = target
      ? await tx
          .select({
            link: materialCatalogDocumentLinks,
            document: materialCatalogDocuments,
          })
          .from(materialCatalogDocumentLinks)
          .innerJoin(
            materialCatalogDocuments,
            eq(
              materialCatalogDocuments.id,
              materialCatalogDocumentLinks.documentId,
            ),
          )
          .where(eq(materialCatalogDocumentLinks.materialId, target.id))
      : [];
    const proposal = proposalForTarget(
      baseProposal,
      decision,
      target,
      catalogUrlsFromSnapshot(targetCatalog),
      batch.overwriteScope === "selected",
    );
    const missing = incompleteProfileMaterialFields(proposal);
    const warnings = missing.map((field) => `Thiếu ${field}.`);
    if (
      !targetChanged &&
      row.targetMethod === "fuzzy_ambiguous" &&
      target == null
    ) {
      warnings.push(
        "Nhiều vật tư đích có điểm gần nhau; hãy chọn đích thủ công.",
      );
    }
    if (
      target &&
      (target.code !== proposal.code || target.name !== proposal.name)
    ) {
      warnings.push("Đề xuất thay đổi mã hoặc tên nhận diện của vật tư đích.");
    }
    let collision = false;
    if (proposal.code) {
      const conditions = [
        eq(sql`lower(${materials.code})`, proposal.code.toLowerCase()),
        isNull(materials.deletedAt),
      ];
      if (target) conditions.push(ne(materials.id, target.id));
      const [existing] = await tx
        .select({ id: materials.id })
        .from(materials)
        .where(and(...conditions))
        .limit(1);
      collision = Boolean(existing);
      if (collision) {
        warnings.push(
          target
            ? "Mã vật tư trùng với một vật tư khác ngoài đích đã chọn."
            : "Mã vật tư đã tồn tại; hãy chọn vật tư đó làm đích thay vì tạo mới.",
        );
      }
      if (!collision && !target) {
        const [sibling] = await tx
          .select({ id: materialProfileMaterialBatchRows.id })
          .from(materialProfileMaterialBatchRows)
          .where(
            and(
              eq(materialProfileMaterialBatchRows.batchId, batch.id),
              ne(materialProfileMaterialBatchRows.id, row.id),
              eq(materialProfileMaterialBatchRows.included, true),
              eq(materialProfileMaterialBatchRows.action, "create"),
              sql`lower(coalesce(${materialProfileMaterialBatchRows.proposedMaterialJson} ->> 'code', '')) = ${proposal.code.toLowerCase()}`,
            ),
          )
          .limit(1);
        collision = Boolean(sibling);
        if (collision) {
          warnings.push(
            "Một dòng khác trong đợt lưu đang tạo cùng mã vật tư; hãy chọn vật tư đích.",
          );
        }
      }
    }
    const ambiguous =
      !targetChanged &&
      row.targetMethod === "fuzzy_ambiguous" &&
      target == null;
    const blocked = missing.length > 0 || collision || ambiguous;
    const included =
      input.included ??
      (targetChanged && row.action === "blocked" ? true : row.included);
    const action = blocked
      ? "blocked"
      : included
        ? target
          ? "update"
          : "create"
        : "excluded";
    await tx
      .update(materialProfileMaterialBatchRows)
      .set({
        included: action === "blocked" ? false : included,
        action,
        targetMaterialId: target?.id ?? null,
        targetScore: targetChanged ? (target ? 1 : null) : row.targetScore,
        targetMethod: targetChanged
          ? target
            ? "manual"
            : "create"
          : row.targetMethod,
        expectedTargetUpdatedAt: targetChanged
          ? (target?.updatedAt ?? null)
          : row.expectedTargetUpdatedAt,
        warningsJson: warnings,
        errorJson: {},
        proposedMaterialJson: proposal,
        winnerRowId: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(materialProfileMaterialBatchRows.id, row.id));

    const batchRows = await tx
      .select()
      .from(materialProfileMaterialBatchRows)
      .where(eq(materialProfileMaterialBatchRows.batchId, batch.id))
      .orderBy(asc(materialProfileMaterialBatchRows.originalRowIndex));
    const byTarget = new Map<number, BatchRow[]>();
    for (const candidate of batchRows) {
      if (
        !candidate.included ||
        candidate.action === "blocked" ||
        candidate.targetMaterialId == null
      ) {
        continue;
      }
      const group = byTarget.get(candidate.targetMaterialId) ?? [];
      group.push(candidate);
      byTarget.set(candidate.targetMaterialId, group);
    }
    const regroupedAt = new Date().toISOString();
    for (const group of byTarget.values()) {
      const winner = pickProfileTargetWinner(group);
      if (!winner) continue;
      for (const candidate of group) {
        await tx
          .update(materialProfileMaterialBatchRows)
          .set({
            action: candidate.id === winner.id ? "update" : "link_only",
            winnerRowId: candidate.id === winner.id ? null : winner.id,
            updatedAt: regroupedAt,
          })
          .where(eq(materialProfileMaterialBatchRows.id, candidate.id));
      }
    }
    const finalRows = await tx
      .select({ action: materialProfileMaterialBatchRows.action })
      .from(materialProfileMaterialBatchRows)
      .where(eq(materialProfileMaterialBatchRows.batchId, batch.id));
    const count = (value: string) =>
      finalRows.filter((candidate) => candidate.action === value).length;
    await tx
      .update(materialProfileMaterialBatches)
      .set({
        total: finalRows.length,
        createCount: count("create"),
        updateCount: count("update"),
        linkOnlyCount: count("link_only"),
        excludedCount: count("excluded"),
        blockedCount: count("blocked"),
        updatedAt: regroupedAt,
      })
      .where(eq(materialProfileMaterialBatches.id, batch.id));
  });
  return getMaterialProfileSaveBatch(input.batchId, input.workspaceId);
}

type CatalogSnapshot = Array<{
  link: typeof materialCatalogDocumentLinks.$inferSelect;
  document: typeof materialCatalogDocuments.$inferSelect;
}>;

function catalogUrlsFromSnapshot(
  snapshot: CatalogSnapshot,
) {
  return snapshot.flatMap(({ document }) =>
    document.deletedAt || !document.sourceUrl ? [] : [document.sourceUrl],
  );
}

async function attachCatalogUrls(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  materialId: number,
  proposal: ProfileMaterialProposal,
) {
  const now = new Date().toISOString();
  for (const url of proposal.catalogPdfUrls) {
    const normalized = normalizeCatalogPdfUrl(url);
    if (!normalized) continue;
    let [document] = await tx
      .select()
      .from(materialCatalogDocuments)
      .where(
        and(
          eq(materialCatalogDocuments.normalizedSourceUrl, normalized),
          isNull(materialCatalogDocuments.deletedAt),
        ),
      )
      .limit(1);
    if (!document) {
      [document] = await tx
        .insert(materialCatalogDocuments)
        .values({
          title: catalogDocumentTitleFromUrl(
            url,
            proposal.name || "Catalog PDF",
          ),
          supplier: proposal.manufacturer || null,
          sourceUrl: url,
          normalizedSourceUrl: normalized,
          sourceType: "detected",
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning();
      if (!document) {
        [document] = await tx
          .select()
          .from(materialCatalogDocuments)
          .where(
            and(
              eq(materialCatalogDocuments.normalizedSourceUrl, normalized),
              isNull(materialCatalogDocuments.deletedAt),
            ),
          )
          .limit(1);
      }
    }
    if (document) {
      await tx
        .insert(materialCatalogDocumentLinks)
        .values({
          documentId: document.id,
          materialId,
          linkSource: "scrape",
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
    }
  }
}

function materialValues(
  proposal: ProfileMaterialProposal,
  workspaceId: number,
  itemId: number,
  now: string,
) {
  return {
    code: proposal.code,
    name: proposal.name,
    unit: proposal.unit,
    category: proposal.category || null,
    specText: proposal.specText,
    manufacturer: proposal.manufacturer || null,
    originCountry: proposal.originCountry || null,
    defaultUnitPrice: proposal.defaultUnitPrice,
    currency: proposal.currency,
    sourceUrl: proposal.sourceUrl || null,
    imageUrl: proposal.imageUrl || null,
    metadataJson: {
      materialProfile: { workspaceId, itemId, savedAt: now },
    },
    updatedAt: now,
  };
}

function selectedSingleUpdateValues(
  proposal: ProfileMaterialProposal,
  decision: RowDecision,
  workspaceId: number,
  itemId: number,
  now: string,
) {
  const full = materialValues(proposal, workspaceId, itemId, now);
  const patch: Partial<typeof full> = { updatedAt: now };
  const keys: Record<FillableField, keyof typeof full> = {
    code: "code",
    unit: "unit",
    category: "category",
    specText: "specText",
    manufacturer: "manufacturer",
    originCountry: "originCountry",
    defaultUnitPrice: "defaultUnitPrice",
    currency: "currency",
    sourceUrl: "sourceUrl",
  };
  for (const field of decision.acceptedFields) {
    const key = keys[field];
    Object.assign(patch, { [key]: full[key] });
  }
  if (decision.acceptedProfileFields?.has("name")) patch.name = full.name;
  if (decision.acceptedProfileFields?.has("imageUrl"))
    patch.imageUrl = full.imageUrl;
  return patch;
}

async function currentProposal(row: BatchRow) {
  const [item] = await db
    .select()
    .from(excelWorkspaceItems)
    .where(eq(excelWorkspaceItems.id, row.workspaceItemId))
    .limit(1);
  if (!item) throw new Error("Dòng hồ sơ không còn tồn tại.");
  const decision = await materialProfileDecisionForItem(item);
  return {
    item,
    decision,
    proposal: buildMaterialProfileProposal(item, decision),
  };
}

async function commitGroup(batch: Batch, rows: BatchRow[]) {
  const winner = rows.find(
    (row) => row.action === "update" || row.action === "create",
  );
  if (!winner) return;
  const baseByRowId = new Map(
    await Promise.all(
      rows.map(async (row) => {
        const current = await currentProposal(row);
        return [row.id, current] as const;
      }),
    ),
  );
  const now = new Date().toISOString();
  await db.transaction(
    async (tx) => {
      const [lockedBatch] = await tx
        .select({ status: materialProfileMaterialBatches.status })
        .from(materialProfileMaterialBatches)
        .where(eq(materialProfileMaterialBatches.id, batch.id))
        .limit(1)
        .for("update");
      if (lockedBatch?.status !== "running") {
        throw new Error("Đợt lưu đã bị hủy hoặc không còn chạy.");
      }
      let target: Material | null = null;
      if (winner.action === "update") {
        if (winner.targetMaterialId == null) {
          throw new Error("Vật tư đích không còn tồn tại.");
        }
        const [lockedTarget] = await tx
          .select()
          .from(materials)
          .where(
            and(
              eq(materials.id, winner.targetMaterialId),
              isNull(materials.deletedAt),
            ),
          )
          .limit(1)
          .for("update");
        target = lockedTarget ?? null;
        if (!target) throw new Error("Vật tư đích không còn tồn tại.");
        if (target.updatedAt !== winner.expectedTargetUpdatedAt) {
          throw new Error("Vật tư đích đã thay đổi sau khi tạo bản xem trước.");
        }
      }
      const beforeCatalog = target
        ? await tx
            .select({
              link: materialCatalogDocumentLinks,
              document: materialCatalogDocuments,
            })
            .from(materialCatalogDocumentLinks)
            .innerJoin(
              materialCatalogDocuments,
              eq(
                materialCatalogDocuments.id,
                materialCatalogDocumentLinks.documentId,
              ),
            )
            .where(eq(materialCatalogDocumentLinks.materialId, target.id))
        : [];
      const targetCatalogUrls = catalogUrlsFromSnapshot(beforeCatalog);
      const currentByRowId = new Map(
        rows.map((row) => {
          const current = baseByRowId.get(row.id);
          if (!current) throw new Error("Không tải được đề xuất dòng hồ sơ.");
          const proposal = proposalForTarget(
            current.proposal,
            current.decision,
            target,
            targetCatalogUrls,
            batch.overwriteScope === "selected",
          );
          const missing = incompleteProfileMaterialFields(proposal);
          if (missing.length) {
            throw new Error(
              `Dòng ${row.originalRowIndex} chưa đủ: ${missing.join(", ")}.`,
            );
          }
          return [row.id, { ...current, proposal }] as const;
        }),
      );
      const current = currentByRowId.get(winner.id);
      if (!current) throw new Error("Không tải được đề xuất vật tư thắng.");
      const preCommitMaterial = target;
      let savedTarget: Material | null = null;
      if (winner.action === "create") {
        const [created] = await tx
          .insert(materials)
          .values(
            materialValues(
              current.proposal,
              batch.workspaceId,
              winner.workspaceItemId,
              now,
            ),
          )
          .returning();
        savedTarget = created ?? null;
      } else if (target) {
        const existingMetadata =
          target.metadataJson && typeof target.metadataJson === "object"
            ? target.metadataJson
            : {};
        const [updated] = await tx
          .update(materials)
          .set({
            ...(batch.overwriteScope === "selected"
              ? selectedSingleUpdateValues(
                  current.proposal,
                  current.decision,
                  batch.workspaceId,
                  winner.workspaceItemId,
                  now,
                )
              : materialValues(
                  current.proposal,
                  batch.workspaceId,
                  winner.workspaceItemId,
                  now,
                )),
            metadataJson: {
              ...existingMetadata,
              materialProfile: {
                workspaceId: batch.workspaceId,
                itemId: winner.workspaceItemId,
                savedAt: now,
              },
            },
          })
          .where(
            and(
              eq(materials.id, target.id),
              eq(materials.updatedAt, winner.expectedTargetUpdatedAt!),
              isNull(materials.deletedAt),
            ),
          )
          .returning();
        savedTarget = updated ?? null;
        if (!savedTarget)
          throw new Error("Vật tư đích đã thay đổi sau khi tạo bản xem trước.");
      }
      if (!savedTarget) throw new Error("Không tạo được vật tư.");
      await attachCatalogUrls(tx, savedTarget.id, current.proposal);
      const postCommitCatalog = await tx
        .select({
          link: materialCatalogDocumentLinks,
          document: materialCatalogDocuments,
        })
        .from(materialCatalogDocumentLinks)
        .innerJoin(
          materialCatalogDocuments,
          eq(
            materialCatalogDocuments.id,
            materialCatalogDocumentLinks.documentId,
          ),
        )
        .where(eq(materialCatalogDocumentLinks.materialId, savedTarget.id));
      for (const row of rows) {
        const currentRow = currentByRowId.get(row.id);
        if (!currentRow) throw new Error("Không tải được đề xuất dòng hồ sơ.");
        const [item] = await tx
          .select()
          .from(excelWorkspaceItems)
          .where(eq(excelWorkspaceItems.id, row.workspaceItemId))
          .limit(1)
          .for("update");
        if (!item) throw new Error("Dòng hồ sơ không còn tồn tại.");
        if (item.updatedAt !== currentRow.item.updatedAt) {
          throw new Error(
            `Dòng ${row.originalRowIndex} đã thay đổi sau khi bắt đầu lưu.`,
          );
        }
        const finalDecision: RowDecision = {
          ...currentRow.decision,
          materialId: savedTarget.id,
        };
        const [savedItem] = await tx
          .update(excelWorkspaceItems)
          .set({
            materialId: savedTarget.id,
            matchStatus: "manual",
            reviewDecisionJson: serializeRowDecision(finalDecision),
            updatedAt: now,
          })
          .where(eq(excelWorkspaceItems.id, item.id))
          .returning({ updatedAt: excelWorkspaceItems.updatedAt });
        if (!savedItem) throw new Error("Không cập nhật được dòng hồ sơ.");
        await tx
          .update(materialProfileMaterialBatchRows)
          .set({
            proposedMaterialJson: currentRow.proposal,
            targetMaterialId: savedTarget.id,
            preCommitMaterialSnapshotJson: preCommitMaterial,
            preCommitCatalogLinksJson: beforeCatalog,
            postCommitVersion: savedTarget.updatedAt,
            postCommitCatalogLinksJson: postCommitCatalog,
            postCommitWorkspaceItemUpdatedAt: savedItem.updatedAt,
            previousWorkspaceItemStateJson: {
              materialId: item.materialId,
              matchStatus: item.matchStatus,
              reviewDecisionJson: item.reviewDecisionJson,
            },
            updatedAt: now,
          })
          .where(eq(materialProfileMaterialBatchRows.id, row.id));
      }
    },
    { isolationLevel: "repeatable read" },
  );
}

async function markGroupFailed(rows: BatchRow[], message: string) {
  const now = new Date().toISOString();
  await db
    .update(materialProfileMaterialBatchRows)
    .set({
      action: "blocked",
      included: false,
      errorJson: { message },
      updatedAt: now,
    })
    .where(
      inArray(
        materialProfileMaterialBatchRows.id,
        rows.map((row) => row.id),
      ),
    );
}

export async function commitMaterialProfileSaveBatch(
  batchId: string,
  workspaceId: number,
) {
  const batch = await requireBatch(batchId, workspaceId);
  if (batch.status !== "draft") {
    throw new MaterialProfileMaterialBatchError(
      "CONFLICT",
      "Đợt lưu này không còn ở trạng thái nháp.",
    );
  }
  const eligibleRows = await db
    .select()
    .from(materialProfileMaterialBatchRows)
    .where(
      and(
        eq(materialProfileMaterialBatchRows.batchId, batch.id),
        eq(materialProfileMaterialBatchRows.included, true),
        inArray(materialProfileMaterialBatchRows.action, [
          "create",
          "update",
          "link_only",
        ]),
      ),
    )
    .orderBy(asc(materialProfileMaterialBatchRows.originalRowIndex));
  if (
    !eligibleRows.some(
      (row) => row.action === "create" || row.action === "update",
    )
  ) {
    throw new MaterialProfileMaterialBatchError(
      "BAD_REQUEST",
      "Không có dòng hoàn chỉnh để lưu.",
    );
  }
  const now = new Date().toISOString();
  const [queued] = await db
    .update(materialProfileMaterialBatches)
    .set({
      status: "queued",
      startedAt: now,
      message: "Đang xếp hàng lưu vào /materials.",
      expiresAt: expiresAt(now),
      updatedAt: now,
    })
    .where(
      and(
        eq(materialProfileMaterialBatches.id, batch.id),
        eq(materialProfileMaterialBatches.status, "draft"),
      ),
    )
    .returning({ id: materialProfileMaterialBatches.id });
  if (!queued) {
    throw new MaterialProfileMaterialBatchError(
      "CONFLICT",
      "Đợt lưu đã được hủy hoặc bắt đầu ở một cửa sổ khác.",
    );
  }
  await processMaterialProfileSaveBatch(batch.id);
  return requireBatch(batch.id, workspaceId);
}

async function processMaterialProfileSaveBatch(batchId: string) {
  if (activeBatchCommits.has(batchId)) return;
  const [batch] = await db
    .select()
    .from(materialProfileMaterialBatches)
    .where(eq(materialProfileMaterialBatches.id, batchId))
    .limit(1);
  if (!batch || !["queued", "running"].includes(batch.status)) return;
  activeBatchCommits.add(batchId);
  const now = new Date().toISOString();
  const [claimed] = await db
    .update(materialProfileMaterialBatches)
    .set({
      status: "running",
      startedAt: batch.startedAt ?? now,
      message: "Đang lưu vào /materials.",
      expiresAt: expiresAt(now),
      updatedAt: now,
    })
    .where(
      and(
        eq(materialProfileMaterialBatches.id, batch.id),
        eq(materialProfileMaterialBatches.status, batch.status),
        eq(materialProfileMaterialBatches.updatedAt, batch.updatedAt),
      ),
    )
    .returning({ id: materialProfileMaterialBatches.id });
  if (!claimed) {
    activeBatchCommits.delete(batchId);
    return;
  }
  try {
    const rows = await db
      .select()
      .from(materialProfileMaterialBatchRows)
      .where(
        and(
          eq(materialProfileMaterialBatchRows.batchId, batch.id),
          eq(materialProfileMaterialBatchRows.included, true),
          isNull(materialProfileMaterialBatchRows.postCommitVersion),
          inArray(materialProfileMaterialBatchRows.action, [
            "create",
            "update",
            "link_only",
          ]),
        ),
      )
      .orderBy(asc(materialProfileMaterialBatchRows.originalRowIndex));
    const groups = new Map<string, BatchRow[]>();
    for (const row of rows) {
      const key =
        row.targetMaterialId == null
          ? `create:${row.id}`
          : `target:${row.targetMaterialId}`;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
    let processedNow = 0;
    let failedNow = 0;
    for (const group of groups.values()) {
      const [state] = await db
        .select({ status: materialProfileMaterialBatches.status })
        .from(materialProfileMaterialBatches)
        .where(eq(materialProfileMaterialBatches.id, batch.id))
        .limit(1);
      if (state?.status === "cancelled") break;
      try {
        await commitGroup(batch, group);
        processedNow += group.length;
      } catch (error) {
        const [stateAfterError] = await db
          .select({ status: materialProfileMaterialBatches.status })
          .from(materialProfileMaterialBatches)
          .where(eq(materialProfileMaterialBatches.id, batch.id))
          .limit(1);
        if (stateAfterError?.status === "cancelled") break;
        failedNow += group.length;
        await markGroupFailed(
          group,
          error instanceof Error
            ? error.message
            : "Không lưu được nhóm vật tư.",
        );
      }
    }
    const [totals] = await db
      .select({
        committed: sql<number>`count(*) filter (where ${materialProfileMaterialBatchRows.postCommitVersion} is not null)::int`,
        failed: sql<number>`count(*) filter (where ${materialProfileMaterialBatchRows.action} = 'blocked' and (${materialProfileMaterialBatchRows.errorJson} ->> 'message') is not null)::int`,
      })
      .from(materialProfileMaterialBatchRows)
      .where(eq(materialProfileMaterialBatchRows.batchId, batch.id));
    const processed = totals?.committed ?? processedNow;
    const failed = Math.max(totals?.failed ?? 0, failedNow);
    const [latestBatch] = await db
      .select({ status: materialProfileMaterialBatches.status })
      .from(materialProfileMaterialBatches)
      .where(eq(materialProfileMaterialBatches.id, batch.id))
      .limit(1);
    if (latestBatch?.status === "cancelled") {
      await db
        .update(materialProfileMaterialBatches)
        .set({
          processed,
          failed,
          message:
            processed > 0
              ? `Đã hủy sau khi lưu ${processed} dòng; có thể hoàn tác phần đã lưu.`
              : "Đã hủy đợt lưu.",
          expiresAt: expiresAt(new Date().toISOString()),
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(materialProfileMaterialBatches.id, batch.id),
            eq(materialProfileMaterialBatches.status, "cancelled"),
          ),
        );
      return;
    }
    const finishedAt = new Date().toISOString();
    await db
      .update(materialProfileMaterialBatches)
      .set({
        status:
          failed > 0 ? (processed > 0 ? "partial" : "failed") : "completed",
        processed,
        failed,
        message:
          failed > 0
            ? "Đã lưu một phần; xem lỗi theo dòng."
            : "Đã lưu vào /materials.",
        finishedAt,
        expiresAt: expiresAt(finishedAt),
        updatedAt: finishedAt,
      })
      .where(
        and(
          eq(materialProfileMaterialBatches.id, batch.id),
          eq(materialProfileMaterialBatches.status, "running"),
        ),
      );
    await updateBatchCounts(batch.id);
  } finally {
    activeBatchCommits.delete(batchId);
  }
}

export async function resumeMaterialProfileSaveBatches() {
  const batches = await db
    .select({ id: materialProfileMaterialBatches.id })
    .from(materialProfileMaterialBatches)
    .where(
      inArray(materialProfileMaterialBatches.status, ["queued", "running"]),
    );
  await Promise.all(
    batches.map((batch) => processMaterialProfileSaveBatch(batch.id)),
  );
}

export async function cancelMaterialProfileSaveBatch(
  batchId: string,
  workspaceId: number,
) {
  return db.transaction(async (tx) => {
    const [batch] = await tx
      .select()
      .from(materialProfileMaterialBatches)
      .where(
        and(
          eq(materialProfileMaterialBatches.id, batchId),
          eq(materialProfileMaterialBatches.workspaceId, workspaceId),
        ),
      )
      .limit(1)
      .for("update");
    if (!batch) {
      throw new MaterialProfileMaterialBatchError(
        "NOT_FOUND",
        "Không tìm thấy đợt lưu vật tư.",
      );
    }
    if (!["draft", "queued", "running"].includes(batch.status)) {
      throw new MaterialProfileMaterialBatchError(
        "CONFLICT",
        "Đợt lưu này không còn có thể hủy.",
      );
    }
    const [totals] = await tx
      .select({
        processed: sql<number>`count(*) filter (where ${materialProfileMaterialBatchRows.postCommitVersion} is not null)::int`,
      })
      .from(materialProfileMaterialBatchRows)
      .where(eq(materialProfileMaterialBatchRows.batchId, batch.id));
    const processed = totals?.processed ?? 0;
    const finishedAt = new Date().toISOString();
    const [cancelled] = await tx
      .update(materialProfileMaterialBatches)
      .set({
        status: "cancelled",
        processed,
        finishedAt,
        message:
          processed > 0
            ? `Đã hủy sau khi lưu ${processed} dòng; có thể hoàn tác phần đã lưu.`
            : "Đã hủy đợt lưu.",
        expiresAt: expiresAt(finishedAt),
        updatedAt: finishedAt,
      })
      .where(eq(materialProfileMaterialBatches.id, batch.id))
      .returning();
    if (!cancelled) {
      throw new MaterialProfileMaterialBatchError(
        "CONFLICT",
        "Đợt lưu đã hoàn tất hoặc bị hủy ở cửa sổ khác.",
      );
    }
    return cancelled;
  });
}

export async function listMaterialProfileSaveBatches(
  workspaceId: number,
  limit = HISTORY_LIMIT,
) {
  await requireWorkspace(workspaceId);
  return db
    .select()
    .from(materialProfileMaterialBatches)
    .where(eq(materialProfileMaterialBatches.workspaceId, workspaceId))
    .orderBy(desc(materialProfileMaterialBatches.updatedAt))
    .limit(Math.min(HISTORY_LIMIT, Math.max(1, limit)));
}

function snapshotRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

async function countCreatedMaterialExternalReferences(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  materialId: number,
  batchId: string,
  batchItemIds: number[],
) {
  const [
    [workspaceRefs],
    [promotionRefs],
    [researchRefs],
    [enrichmentRefs],
    [candidateRefs],
    [eventRefs],
    [otherBatchRefs],
  ] = await Promise.all([
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(excelWorkspaceItems)
      .where(
        and(
          eq(excelWorkspaceItems.materialId, materialId),
          ...(batchItemIds.length
            ? [notInArray(excelWorkspaceItems.id, batchItemIds)]
            : []),
        ),
      ),
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(materialProfilePromotionLedger)
      .where(eq(materialProfilePromotionLedger.materialId, materialId)),
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(excelResearchRowEvidence)
      .where(eq(excelResearchRowEvidence.materialId, materialId)),
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(materialEnrichmentItems)
      .where(eq(materialEnrichmentItems.materialId, materialId)),
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(materialWebCandidates)
      .where(eq(materialWebCandidates.materialId, materialId)),
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(materialEnrichmentEvents)
      .where(eq(materialEnrichmentEvents.materialId, materialId)),
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(materialProfileMaterialBatchRows)
      .where(
        and(
          eq(materialProfileMaterialBatchRows.targetMaterialId, materialId),
          ne(materialProfileMaterialBatchRows.batchId, batchId),
        ),
      ),
  ]);
  return [
    workspaceRefs,
    promotionRefs,
    researchRefs,
    enrichmentRefs,
    candidateRefs,
    eventRefs,
    otherBatchRefs,
  ].reduce((total, result) => total + (result?.count ?? 0), 0);
}

export async function undoMaterialProfileSaveBatch(
  batchId: string,
  workspaceId: number,
) {
  const batch = await requireBatch(batchId, workspaceId);
  if (
    !["completed", "partial"].includes(batch.status) &&
    !(batch.status === "cancelled" && batch.processed > 0)
  ) {
    throw new MaterialProfileMaterialBatchError(
      "CONFLICT",
      "Đợt lưu này không thể hoàn tác.",
    );
  }
  const rows = await db
    .select()
    .from(materialProfileMaterialBatchRows)
    .where(
      and(
        eq(materialProfileMaterialBatchRows.batchId, batch.id),
        eq(materialProfileMaterialBatchRows.included, true),
      ),
    );
  const groups = new Map<number, BatchRow[]>();
  for (const row of rows) {
    const state = snapshotRecord(row.previousWorkspaceItemStateJson);
    const currentMaterialId = row.targetMaterialId ?? undefined;
    if (!currentMaterialId || !row.postCommitVersion || !state) continue;
    const group = groups.get(currentMaterialId) ?? [];
    group.push(row);
    groups.set(currentMaterialId, group);
  }
  let restored = 0;
  const conflicts: string[] = [];
  for (const [materialId, group] of groups) {
    const [material] = await db
      .select()
      .from(materials)
      .where(eq(materials.id, materialId))
      .limit(1);
    const version = group[0]?.postCommitVersion;
    if (
      !version ||
      !material ||
      !isMaterialProfileUndoVersionCurrent(material.updatedAt, version)
    ) {
      conflicts.push(`Vật tư #${materialId} đã thay đổi sau đợt lưu.`);
      continue;
    }
    const snapshot = snapshotRecord(group[0]?.preCommitMaterialSnapshotJson);
    try {
      await db.transaction(async (tx) => {
        const [lockedMaterial] = await tx
          .select({ updatedAt: materials.updatedAt })
          .from(materials)
          .where(eq(materials.id, materialId))
          .limit(1)
          .for("update");
        if (
          !isMaterialProfileUndoVersionCurrent(
            lockedMaterial?.updatedAt,
            version,
          )
        ) {
          throw new Error(`Vật tư #${materialId} đã thay đổi sau đợt lưu.`);
        }
        for (const row of group) {
          const [lockedItem] = await tx
            .select({ updatedAt: excelWorkspaceItems.updatedAt })
            .from(excelWorkspaceItems)
            .where(eq(excelWorkspaceItems.id, row.workspaceItemId))
            .limit(1)
            .for("update");
          if (
            !lockedItem ||
            !isMaterialProfileUndoVersionCurrent(
              lockedItem?.updatedAt,
              row.postCommitWorkspaceItemUpdatedAt,
            )
          ) {
            throw new Error(
              `Dòng ${row.originalRowIndex} đã thay đổi sau đợt lưu.`,
            );
          }
        }
        const currentCatalog = await tx
          .select({
            link: materialCatalogDocumentLinks,
            document: materialCatalogDocuments,
          })
          .from(materialCatalogDocumentLinks)
          .innerJoin(
            materialCatalogDocuments,
            eq(
              materialCatalogDocuments.id,
              materialCatalogDocumentLinks.documentId,
            ),
          )
          .where(eq(materialCatalogDocumentLinks.materialId, materialId));
        if (
          !isMaterialProfileCatalogSnapshotCurrent(
            currentCatalog,
            group[0]?.postCommitCatalogLinksJson,
          )
        ) {
          throw new Error(
            `Liên kết catalog của vật tư #${materialId} đã thay đổi sau đợt lưu.`,
          );
        }
        for (const row of group) {
          const state =
            snapshotRecord(row.previousWorkspaceItemStateJson) ?? {};
          await tx
            .update(excelWorkspaceItems)
            .set({
              materialId:
                typeof state.materialId === "number" ? state.materialId : null,
              matchStatus:
                state.matchStatus === "matched" ||
                state.matchStatus === "manual" ||
                state.matchStatus === "candidates_found"
                  ? state.matchStatus
                  : "unmatched",
              reviewDecisionJson:
                snapshotRecord(state.reviewDecisionJson) ?? {},
              updatedAt: new Date().toISOString(),
            })
            .where(eq(excelWorkspaceItems.id, row.workspaceItemId));
        }
        if (snapshot) {
          await tx
            .update(materials)
            .set({
              code: typeof snapshot.code === "string" ? snapshot.code : null,
              name: trimmed(snapshot.name),
              unit: trimmed(snapshot.unit),
              category:
                typeof snapshot.category === "string"
                  ? snapshot.category
                  : null,
              specText: trimmed(snapshot.specText),
              manufacturer:
                typeof snapshot.manufacturer === "string"
                  ? snapshot.manufacturer
                  : null,
              originCountry:
                typeof snapshot.originCountry === "string"
                  ? snapshot.originCountry
                  : null,
              defaultUnitPrice:
                typeof snapshot.defaultUnitPrice === "number"
                  ? snapshot.defaultUnitPrice
                  : null,
              currency: trimmed(snapshot.currency) || "VND",
              sourceUrl:
                typeof snapshot.sourceUrl === "string"
                  ? snapshot.sourceUrl
                  : null,
              imageUrl:
                typeof snapshot.imageUrl === "string"
                  ? snapshot.imageUrl
                  : null,
              metadataJson: snapshotRecord(snapshot.metadataJson) ?? {},
              deletedAt:
                typeof snapshot.deletedAt === "string"
                  ? snapshot.deletedAt
                  : null,
              updatedAt: new Date().toISOString(),
            })
            .where(
              and(
                eq(materials.id, materialId),
                eq(materials.updatedAt, version),
              ),
            );
          await tx
            .delete(materialCatalogDocumentLinks)
            .where(eq(materialCatalogDocumentLinks.materialId, materialId));
          const links = Array.isArray(group[0]?.preCommitCatalogLinksJson)
            ? group[0].preCommitCatalogLinksJson
            : [];
          for (const raw of links) {
            const link = snapshotRecord(raw)?.link;
            const linkRecord = snapshotRecord(link);
            if (typeof linkRecord?.documentId === "number") {
              await tx
                .insert(materialCatalogDocumentLinks)
                .values({
                  documentId: linkRecord.documentId,
                  materialId,
                  linkSource:
                    linkRecord.linkSource === "manual" ||
                    linkRecord.linkSource === "import"
                      ? linkRecord.linkSource
                      : "scrape",
                  createdAt:
                    typeof linkRecord.createdAt === "string"
                      ? linkRecord.createdAt
                      : new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                })
                .onConflictDoNothing();
            }
          }
        } else {
          const referenceCount = await countCreatedMaterialExternalReferences(
            tx,
            materialId,
            batch.id,
            [],
          );
          if (referenceCount > 0)
            throw new Error("Vật tư mới đang được dòng khác tham chiếu.");
          await tx
            .delete(materialCatalogDocumentLinks)
            .where(eq(materialCatalogDocumentLinks.materialId, materialId));
          await tx
            .update(materials)
            .set({
              deletedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            })
            .where(
              and(
                eq(materials.id, materialId),
                eq(materials.updatedAt, version),
              ),
            );
        }
      });
      restored += group.length;
    } catch (error) {
      conflicts.push(
        error instanceof Error
          ? error.message
          : `Không hoàn tác được vật tư #${materialId}.`,
      );
    }
  }
  const now = new Date().toISOString();
  const [updated] = await db
    .update(materialProfileMaterialBatches)
    .set({
      status: conflicts.length ? "partial" : "undone",
      message: conflicts.length
        ? `Hoàn tác một phần (${restored} dòng).`
        : "Đã hoàn tác đợt lưu.",
      error: conflicts.join(" ") || null,
      updatedAt: now,
    })
    .where(eq(materialProfileMaterialBatches.id, batch.id))
    .returning();
  return { batch: updated, restored, conflicts };
}

export async function cleanupExpiredMaterialProfileBatches(
  now = new Date().toISOString(),
) {
  const expired = await db
    .select({ id: materialProfileMaterialBatches.id })
    .from(materialProfileMaterialBatches)
    .where(
      and(
        lt(materialProfileMaterialBatches.expiresAt, now),
        inArray(materialProfileMaterialBatches.status, [
          "draft",
          "completed",
          "partial",
          "failed",
          "cancelled",
          "undone",
        ]),
      ),
    );
  if (!expired.length) return 0;
  const ids = expired.map((batch) => batch.id);
  await db.transaction(async (tx) => {
    await tx
      .update(materialProfileMaterialBatchRows)
      .set({
        proposedMaterialJson: {},
        preCommitMaterialSnapshotJson: null,
        preCommitCatalogLinksJson: [],
        postCommitVersion: null,
        postCommitCatalogLinksJson: null,
        postCommitWorkspaceItemUpdatedAt: null,
        previousWorkspaceItemStateJson: {},
        updatedAt: now,
      })
      .where(inArray(materialProfileMaterialBatchRows.batchId, ids));
    await tx
      .update(materialProfileMaterialBatches)
      .set({
        status: "expired",
        message: "Lịch sử hoàn tác đã hết hạn sau 30 ngày.",
        updatedAt: now,
      })
      .where(inArray(materialProfileMaterialBatches.id, ids));
  });
  return ids.length;
}
