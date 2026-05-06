export type ExcelWorkspaceStepId =
  | "setup"
  | "import"
  | "rows"
  | "research"
  | "export";

export const excelWorkspaceSteps: ExcelWorkspaceStepId[] = [
  "setup",
  "import",
  "rows",
  "research",
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
  if (input.importedItemCount > 0) {
    return {
      nextStep: input.openItemCount > 0 ? "research" : "export",
      maxStep: "export",
    };
  }

  if (input.hasWorkbook && input.hasMapping) {
    return { nextStep: "import", maxStep: "rows" };
  }

  if (input.hasWorkbook) {
    return { nextStep: "import", maxStep: "import" };
  }

  return { nextStep: "setup", maxStep: "rows" };
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
