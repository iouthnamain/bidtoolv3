import {
  buildFillPlan,
  candidateToFields,
  type FillableField,
  type FillPlanCell,
} from "~/lib/materials/excel-enrich-fields";
import type { EnrichCandidate } from "~/app/_components/enrich/product-candidate-card";

export function planForCandidate(
  sheetFields: Partial<Record<FillableField, string>>,
  candidate: EnrichCandidate | null,
): { plan: FillPlanCell[]; fillable: Set<FillableField> } {
  if (!candidate) return { plan: [], fillable: new Set() };
  const materialFields = candidateToFields(candidate);
  const plan = buildFillPlan(sheetFields, materialFields);
  const fillable = new Set<FillableField>(
    plan
      .filter((cell) => cell.action === "filled")
      .map((cell) => cell.field),
  );
  return { plan, fillable };
}
