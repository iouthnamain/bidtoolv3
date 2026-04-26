export type ExcelWorkspaceStepId =
  | "import"
  | "map"
  | "review"
  | "find"
  | "export";

export const excelWorkspaceSteps: ExcelWorkspaceStepId[] = [
  "import",
  "map",
  "review",
  "find",
  "export",
];

type ExcelWorkspaceRouteState = {
  hasWorkbook: boolean;
  hasMapping: boolean;
  importedItemCount: number;
  openItemCount: number;
};

export function resolveExcelWorkspaceStepState(
  input: ExcelWorkspaceRouteState,
): {
  nextStep: ExcelWorkspaceStepId;
  maxStep: ExcelWorkspaceStepId;
} {
  if (!input.hasWorkbook) {
    return { nextStep: "import", maxStep: "import" };
  }

  if (!input.hasMapping) {
    return { nextStep: "map", maxStep: "map" };
  }

  if (input.importedItemCount === 0) {
    return { nextStep: "map", maxStep: "map" };
  }

  if (input.openItemCount > 0) {
    return { nextStep: "find", maxStep: "find" };
  }

  return { nextStep: "export", maxStep: "export" };
}

export function isExcelWorkspaceStepAccessible(
  requestedStep: ExcelWorkspaceStepId,
  maxStep: ExcelWorkspaceStepId,
): boolean {
  return (
    excelWorkspaceSteps.indexOf(requestedStep) <=
    excelWorkspaceSteps.indexOf(maxStep)
  );
}
