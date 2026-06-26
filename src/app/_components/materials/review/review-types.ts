import type { EnrichCandidate } from "~/app/_components/enrich/product-candidate-card";
import type {
  FillableField,
  FillPlanCell,
} from "~/lib/materials/excel-enrich-fields";
import type { SnapshotStatus } from "~/lib/materials/review-decision";

export type ReviewRowStatus = SnapshotStatus;

export type ReviewSearchMode = "default" | "profileSplit";

export type ReviewRow = {
  key: number;
  originalRowIndex: number;
  name: string;
  status: ReviewRowStatus;
  sheetFields: Partial<Record<FillableField, string>>;
  candidates: EnrichCandidate[];
  topCandidate: EnrichCandidate | null;
  fillPlan: FillPlanCell[];
};

export type ReviewSummary = {
  totalRows: number;
  auto: number;
  review: number;
  unmatched: number;
};
