export type MaterialProfileRestoredStep = 1 | 2 | 3 | 4;

export function restoredMaterialProfileStep({
  sheetCount,
  itemCount,
  unresolvedReviewCount,
  workspaceStatus,
}: {
  sheetCount: number;
  itemCount: number;
  unresolvedReviewCount: number;
  workspaceStatus?: string;
}): MaterialProfileRestoredStep {
  if (sheetCount === 0) return 1;
  if (itemCount === 0) return 2;
  if (
    workspaceStatus === "exported" ||
    workspaceStatus === "catalog_generated" ||
    workspaceStatus === "checked" ||
    workspaceStatus === "approved"
  ) {
    return 4;
  }
  return workspaceStatus === "matched" || unresolvedReviewCount > 0 ? 3 : 4;
}
