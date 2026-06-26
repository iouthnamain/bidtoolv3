import type { ReviewRowStatus } from "~/app/_components/materials/review/review-types";

export const STATUS_META: Record<
  ReviewRowStatus,
  { label: string; tone: "success" | "warning" | "neutral" }
> = {
  auto: { label: "Tự động", tone: "success" },
  review: { label: "Cần duyệt", tone: "warning" },
  unmatched: { label: "Chưa khớp", tone: "neutral" },
};
