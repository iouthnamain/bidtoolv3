import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";

import {
  deserializeRowDecision,
  serializeRowDecision,
  type RowDecision,
} from "~/lib/materials/review-decision";
import { db } from "~/server/db";
import { materialProfileSearchRuns } from "~/server/db/schema";
import type { excelWorkspaceItems } from "~/server/db/schema";

type WorkspaceItem = typeof excelWorkspaceItems.$inferSelect;
type SearchRun = typeof materialProfileSearchRuns.$inferSelect;

function emptyDecision(item: WorkspaceItem): RowDecision {
  return {
    materialId: item.materialId,
    acceptedFields: new Set(),
    overwriteFields: new Set(),
  };
}

export function materialProfileDecisionWithCurrentSearch(
  item: WorkspaceItem,
  run: SearchRun | null | undefined,
): RowDecision {
  const base =
    deserializeRowDecision(item.reviewDecisionJson) ?? emptyDecision(item);
  if (!run) return base;

  const search = deserializeRowDecision({
    materialId: base.materialId,
    acceptedFields: [],
    webLinkResults: run.webLinkResultsJson,
    webLinksStatus: run.webLinksStatus,
    aiSearchCandidates: run.aiSearchCandidatesJson,
    aiSearchStatus: run.aiSearchStatus,
  });
  const candidates = search?.aiSearchCandidates ?? [];
  const selectedKey = base.selectedSearchCandidateKey;
  const selectedAiIndex = selectedKey?.startsWith("ai:")
    ? Number(selectedKey.slice("ai:".length))
    : 0;
  const selectedAiResult = Number.isInteger(selectedAiIndex)
    ? candidates[selectedAiIndex]
    : undefined;

  return (
    deserializeRowDecision({
      ...serializeRowDecision(base),
      webLinkResults: search?.webLinkResults ?? [],
      webLinksStatus: search?.webLinksStatus ?? "idle",
      aiSearchCandidates: candidates,
      aiSearchResult: selectedAiResult ?? candidates[0],
      aiSearchStatus: search?.aiSearchStatus ?? "idle",
    }) ?? base
  );
}

export async function materialProfileDecisionsForItems(items: WorkspaceItem[]) {
  if (items.length === 0) return new Map<number, RowDecision>();
  const itemIds = [...new Set(items.map((item) => item.id))];
  const runs = await db
    .select()
    .from(materialProfileSearchRuns)
    .where(
      and(
        inArray(materialProfileSearchRuns.itemId, itemIds),
        eq(materialProfileSearchRuns.isCurrent, true),
      ),
    )
    .orderBy(desc(materialProfileSearchRuns.updatedAt));
  const runByItemId = new Map<number, SearchRun>();
  for (const run of runs) {
    if (!runByItemId.has(run.itemId)) runByItemId.set(run.itemId, run);
  }
  return new Map(
    items.map((item) => [
      item.id,
      materialProfileDecisionWithCurrentSearch(item, runByItemId.get(item.id)),
    ]),
  );
}

export async function materialProfileDecisionForItem(item: WorkspaceItem) {
  const decisions = await materialProfileDecisionsForItems([item]);
  return decisions.get(item.id) ?? emptyDecision(item);
}
